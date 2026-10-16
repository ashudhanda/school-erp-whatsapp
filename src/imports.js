import {Worker} from 'node:worker_threads';
import {db} from './db.js';
import {UserError,rows,one,run,newToken,roll,write} from './services.js';
import {assertAdmin,phone} from './schoolAdmin.js';

// Canonical student columns every import maps onto. FIELDS order also defines
// the fixed column order used when a parsed spreadsheet is normalized.
export const FIELDS=['name','admission_no','class','section','roll_no','parent_name','parent_phone','fees_due'];

/**
 * Hand-written RFC-4180-ish CSV parser. Used instead of a dependency so the
 * import path has no supply-chain risk; every bound it enforces (cell length,
 * row count, column count) doubles as a DoS guard against hostile files.
 * Rules: leading BOM stripped; quoted cells support "" escapes; rows are
 * skipped when completely empty; text after a closing quote throws.
 * @param {string} source - the CSV text (UTF-8, BOM tolerated)
 * @returns {string[][]} rows of cells; the first row is the header
 * @throws {UserError} on unclosed quotes, overlong cells, or >1000 rows / >50 columns
 */
export function parseCsv(source) {
  const input=String(source).replace(/^\uFEFF/,'');const result=[];let row=[],cell='',quoted=false,closed=false;
  for(let i=0;i<input.length;i++) {
    const c=input[i];
    if(quoted) {if(c==='"'&&input[i+1]==='"'){cell+='"';i++;}else if(c==='"'){quoted=false;closed=true;}else cell+=c;}
    else if(c==='"'&&!cell&&!closed)quoted=true;
    else if(c===','){row.push(cell);cell='';closed=false;}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&input[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))result.push(row);row=[];cell='';closed=false;}
    else {if(closed&&!/\s/.test(c))throw new UserError('Unexpected text after a quoted CSV cell.');if(!closed)cell+=c;}
    if(cell.length>4000)throw new UserError('CSV cell is too long.');
  }
  if(quoted)throw new UserError('CSV has an unclosed quote.');row.push(cell);if(row.some(Boolean))result.push(row);
  if(result.length>1001||result.some(r=>r.length>50))throw new UserError('Maximum 1,000 data rows and 50 columns per import.');
  return result;
}

/**
 * Static safety scan of an uploaded .xlsx BEFORE it is parsed: verifies it is
 * really a ZIP (end-of-central-directory record), rejects oversized archives,
 * and walks the central directory to reject zip-bombs (compression ratio
 * >250x), path traversal (.. or leading /), VBA macros, and external links.
 * Runs in the main thread; the actual parse happens in an isolated worker.
 * @param {Buffer} buffer - the uploaded file bytes (max 2 MB, checked first)
 * @throws {UserError} on invalid, unsafe, or oversized archives
 */
export function checkXlsxZip(buffer) {
  if(buffer.length>2*1024*1024||buffer.length<22)throw new UserError('Maximum XLSX file size is 2 MB.');
  let end=-1;for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0)throw new UserError('Invalid XLSX ZIP directory.');
  const count=buffer.readUInt16LE(end+10),offset=buffer.readUInt32LE(end+16);if(count>2000||count===65535||offset===0xffffffff||buffer.readUInt16LE(end+4)!==0)throw new UserError('Unsupported or oversized XLSX archive.');
  let pos=offset,total=0,hasWorkbook=false;
  for(let n=0;n<count;n++) {
    if(pos+46>buffer.length||buffer.readUInt32LE(pos)!==0x02014b50)throw new UserError('Invalid XLSX directory.');
    const flags=buffer.readUInt16LE(pos+8),compressed=buffer.readUInt32LE(pos+20),expanded=buffer.readUInt32LE(pos+24),nameLength=buffer.readUInt16LE(pos+28),extra=buffer.readUInt16LE(pos+30),comment=buffer.readUInt16LE(pos+32);
    const name=buffer.subarray(pos+46,pos+46+nameLength).toString();total+=expanded;
    if(flags&1||expanded>10*1024*1024||total>20*1024*1024||expanded/Math.max(1,compressed)>250||name.includes('..')||name.startsWith('/')||/vbaProject\.bin|externalLinks\//i.test(name))throw new UserError('Unsafe or excessively expanded XLSX file.');
    if(name==='xl/workbook.xml')hasWorkbook=true;pos+=46+nameLength+extra+comment;
  }
  if(!hasWorkbook)throw new UserError('This is not an XLSX workbook.');
}

/**
 * Normalize an uploaded CSV or XLSX file into sheets of string grids. CSV is
 * parsed inline (it must be valid UTF-8); XLSX is parsed in a sandboxed worker
 * thread with a capped heap and an 8-second timeout, so a malicious workbook
 * can crash the worker, never the server.
 * @param {Buffer} buffer - the uploaded file bytes
 * @param {string} name - original filename (extension decides the parser)
 * @returns {Promise<{name: string, rows: string[][]}[]>} sheets as string grids
 * @throws {UserError} on wrong encoding, unsupported format, or unsafe/timed-out workbooks
 */
export async function readSpreadsheet(buffer,name) {
  if(buffer.length>2*1024*1024)throw new UserError('Maximum upload size is 2 MB.');
  if(/\.csv$/i.test(name)) {
    let content;try{content=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{throw new UserError('Save CSV as UTF-8.');}
    return [{name:'CSV',rows:parseCsv(content)}];
  }
  if(!/\.xlsx$/i.test(name))throw new UserError('Upload CSV or XLSX, not XLS or XLSM.');checkXlsxZip(buffer);
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./spreadsheetWorker.js',import.meta.url),{workerData:buffer,resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:32}});
    const timer=setTimeout(()=>{worker.terminate();reject(new UserError('Workbook took too long to read. Split it into smaller files.'));},8000);
    worker.once('message',data=>{clearTimeout(timer);worker.terminate();data.error?reject(new UserError(data.error)):resolve(data.sheets);});
    worker.once('error',()=>{clearTimeout(timer);reject(new UserError('Workbook could not be read safely.'));});
    worker.once('exit',code=>{if(code!==0){clearTimeout(timer);reject(new UserError('Workbook reader stopped.'));}});
  });
}
/**
 * Guess which spreadsheet column maps to which student field by matching the
 * header row against known aliases (case-insensitive, trimmed). Returns -1
 * for fields the header doesn't mention; the panel then asks the admin to map
 * them manually. Name/class/section/roll_no/admission_no are required and are
 * re-validated by validateImport.
 * @param {string[]} headers - the spreadsheet header row
 * @returns {Object<string, number>} field name -> column index (-1 if unmapped)
 */
export function guessMapping(headers) {
  const aliases={name:['name','student name','student_name'],admission_no:['admission no','admission number','admission_no','student id'],class:['class','grade'],section:['section'],roll_no:['roll','roll no','roll number','roll_no'],parent_name:['parent name','parent_name','guardian name'],parent_phone:['parent phone','parent_phone','phone','guardian phone'],fees_due:['fees due','fees_due','dues']};
  return Object.fromEntries(FIELDS.map(field=>[field,headers.findIndex(h=>aliases[field].includes(String(h).trim().toLowerCase()))]));
}
/**
 * Validate every data row of a student import WITHOUT writing anything.
 * Pure check phase of the two-phase import (stage → commit): required columns
 * must be mapped and unique; each row needs a name + admission number, an
 * existing class/section, a unique roll number within the section, and a sane
 * fee amount. Rows are never silently dropped — failures are collected per row
 * with their spreadsheet row number so the admin can fix the file.
 * @param {number} schoolId - the school being imported into
 * @param {string[][]} grid - the spreadsheet (first row is the header)
 * @param {Object<string, number>} mapping - field name -> column index
 * @param {boolean} [update=false] - when true, rows may update existing students by admission number
 * @param {*} [cx=db] - database connection (a transaction during commit)
 * @returns {Promise<{valid: object[], errors: {row: number, message: string}[], update: boolean}>}
 */
export async function validateImport(schoolId,grid,mapping,update=false,cx=db) {
  if(!grid.length||grid.length>1001)throw new UserError('Import must contain 1–1,000 data rows and a header.');
  const required=['name','admission_no','class','section','roll_no'];for(const f of required)if(!Number.isInteger(Number(mapping[f]))||Number(mapping[f])<0||Number(mapping[f])>=grid[0].length)throw new UserError('Map the '+f+' column.');
  const mapped=FIELDS.filter(f=>Number(mapping[f])>=0).map(f=>Number(mapping[f]));if(new Set(mapped).size!==mapped.length)throw new UserError('Each source column may be mapped only once.');
  const classes=await rows('SELECT s.id,s.class_id,s.name AS section_name,c.name AS class_name FROM sections s JOIN classes c ON c.id=s.class_id AND c.school_id=s.school_id WHERE s.school_id=? AND s.active=1 AND c.active=1',[schoolId],cx);
  const students=await rows('SELECT id,admission_no,section_id,roll_no,fees_due FROM students WHERE school_id=?',[schoolId],cx);
  const admissions=new Map(students.map(s=>[s.admission_no,s])),occupied=new Map(students.filter(s=>s.roll_no&&s.section_id).map(s=>[s.section_id+':'+roll(s.roll_no),s.admission_no]));
  const seenAdmissions=new Set(),seenRolls=new Set(),valid=[],errors=[];
  for(let i=1;i<grid.length;i++) {
    try {
      const r=Object.fromEntries(FIELDS.map(f=>[f,Number(mapping[f])>=0?String(grid[i][Number(mapping[f])]??'').trim():'']));
      if(!r.name||!r.admission_no||r.name.length>100||r.admission_no.length>60)throw new UserError('Name and admission number are required (maximum 100 / 60 characters).');
      const section=classes.find(c=>c.class_name===r.class&&c.section_name===r.section);if(!section)throw new UserError('Create class "'+r.class+'" / section "'+r.section+'" first.');
      r.roll_no=roll(r.roll_no);r.section_id=Number(section.id);r.class_id=Number(section.class_id);
      const existing=admissions.get(r.admission_no);if(existing&&!update)throw new UserError('Admission number already exists. Enable update mode to change it.');
      if(seenAdmissions.has(r.admission_no))throw new UserError('Admission number is duplicated in this file.');seenAdmissions.add(r.admission_no);
      const rollKey=r.section_id+':'+r.roll_no;if(seenRolls.has(rollKey)||occupied.has(rollKey)&&occupied.get(rollKey)!==r.admission_no)throw new UserError('Roll number is already used in this section.');seenRolls.add(rollKey);
      r.parent_phone=phone(r.parent_phone,true);if(r.parent_name.length>100)throw new UserError('Parent name is too long.');
      r.fees_due=r.fees_due===''?Number(existing?.fees_due||0):Number(r.fees_due);if(!Number.isFinite(r.fees_due)||r.fees_due<0||r.fees_due>100000000)throw new UserError('Invalid fee amount.');
      r.id=existing?Number(existing.id):null;r.row=i+1;valid.push(r);
    }catch(e){errors.push({row:i+1,message:e instanceof UserError?e.message:'Invalid row.'});}
  }
  return {valid,errors,update};
}
/**
 * Phase 1 of the import: validate the grid, then stash the preview in the
 * import_jobs table under a random job token (10-minute expiry). Nothing is
 * written to student tables yet — the admin sees the preview and must confirm.
 * @param {number} schoolId - the school being imported into
 * @param {{staff_id: number}} user - the admin performing the import (must be a school admin)
 * @param {string[][]} grid - the spreadsheet grid
 * @param {Object<string, number>} mapping - field name -> column index
 * @param {boolean} update - update mode flag carried through to commit
 * @returns {Promise<{valid: object[], errors: object[], update: boolean, job: string}>} preview + job token
 */
export async function stageImport(schoolId,user,grid,mapping,update) {
  assertAdmin(user,schoolId);const preview=await validateImport(schoolId,grid,mapping,update),job=newToken();
  await run('INSERT INTO import_jobs(id,school_id,staff_id,payload,expires_at) VALUES(?,?,?,?,?)',[job,schoolId,user.staff_id,JSON.stringify({grid,mapping,update}),Date.now()+600000]);
  return {...preview,job};
}
/**
 * Phase 2 of the import: re-load the staged job, re-validate INSIDE the
 * write transaction (the database may have changed since the preview), then
 * apply everything atomically. Students with a pending leave request can only
 * be moved sections after that leave is resolved. Parent phones are linked to
 * parents and to students idempotently. The job is marked committed and its
 * payload wiped (payloads can contain PII).
 * @param {number} schoolId - the school being imported into
 * @param {{staff_id: number}} user - the admin confirming the import
 * @param {string} jobId - the job token returned by stageImport
 * @returns {Promise<{imported: number}>} how many students were written
 * @throws {UserError} when the preview expired, belongs to another admin, or any row is now invalid
 */
export async function commitImport(schoolId,user,jobId) {
  assertAdmin(user,schoolId);
  return write(schoolId,user.staff_id,jobId,'student_import',async tx=>{
    const job=await one("SELECT * FROM import_jobs WHERE id=? AND school_id=? AND staff_id=? AND status='preview' AND expires_at>?",[jobId,schoolId,user.staff_id,Date.now()],tx);if(!job)throw new UserError('Import preview expired or belongs to another admin.',403);
    const {grid,mapping,update}=JSON.parse(job.payload),preview=await validateImport(schoolId,grid,mapping,update,tx);if(preview.errors.length)throw new UserError('Fix every validation error before importing.');
    const ops=[];
    for(const r of preview.valid) {
      if(r.id) {
        const pending=await one("SELECT id FROM leaves WHERE school_id=? AND student_id=? AND status='pending' AND section_id!=?",[schoolId,r.id,r.section_id],tx);if(pending)throw new UserError('Resolve pending leave before transferring admission '+r.admission_no+'.');
        ops.push({sql:'UPDATE students SET name=?,class_id=?,section_id=?,roll_no=?,fees_due=? WHERE id=? AND school_id=?',args:[r.name,r.class_id,r.section_id,r.roll_no,r.fees_due,r.id,schoolId]});
      } else ops.push({sql:'INSERT INTO students(school_id,name,admission_no,class_id,section_id,roll_no,fees_due) VALUES(?,?,?,?,?,?,?)',args:[schoolId,r.name,r.admission_no,r.class_id,r.section_id,r.roll_no,r.fees_due]});
      if(r.parent_phone) {
        ops.push({sql:'INSERT OR IGNORE INTO parents(school_id,name,wa_id) VALUES(?,?,?)',args:[schoolId,r.parent_name||'Parent',r.parent_phone]});
        ops.push({sql:'INSERT OR IGNORE INTO parent_student(school_id,parent_id,student_id) SELECT ?,p.id,s.id FROM parents p JOIN students s ON s.school_id=p.school_id WHERE p.school_id=? AND p.wa_id=? AND s.admission_no=?',args:[schoolId,schoolId,r.parent_phone,r.admission_no]});
      }
    }
    for(let i=0;i<ops.length;i+=100)await tx.batch(ops.slice(i,i+100));
    await run("UPDATE import_jobs SET status='committed',payload='{}' WHERE id=?",[jobId],tx);return {imported:preview.valid.length};
  });
}
