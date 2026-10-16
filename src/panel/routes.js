import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import {db,todayIST,audit} from '../db.js';
import * as s from '../services.js';
import * as admin from '../schoolAdmin.js';
import * as ui from './ui.js';
import {verifyPassword} from './password.js';
import {createSession,destroySession,sessionCookieHeader,clearCookieHeader,loginFailed,loginLocked,loginSucceeded,requireAuth,checkCsrf} from './auth.js';
import {readSpreadsheet,guessMapping,FIELDS,stageImport,validateImport,commitImport} from '../imports.js';
import {MEDIA_LIMIT} from '../media.js';
import * as keys from '../ai/keyPool.js';

export const panelRouter=express.Router();
const router=panelRouter;
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:2*1024*1024,files:1,fields:100,fieldSize:30000,parts:105}});
const sq=c=>'?school='+encodeURIComponent(c.schoolId||'');
const redirect=(res,c,path,message='Saved.')=>res.redirect('/panel/'+path+sq(c)+'&message='+encodeURIComponent(message));
const activeOptions=[['1','Active'],['0','Inactive']];
const labels={attendance:'Attendance',marks:'Marks',fees:'Fees',homework:'Homework',datesheet:'Date sheets',leave:'Leave requests',notices:'Notices',events:'Events & holidays',tests:'Upcoming tests',timings:'School timings',holidays:'Holidays',admission:'Admissions'};
const permissionLabels={attendance:'Mark attendance',marks:'Upload marks',marks_edit:'Edit own past marks',homework:'Post homework',tests:'Announce tests'};
const token=req=>String(req.body._token||'');
const detail=(title,body)=>`<details><summary>${ui.esc(title)}</summary>${body}</details>`;
const pager=(c,path,page,more,extra='')=>`<div class="filters">${page>0?ui.link(c,path,'Previous',extra+'&page='+(page-1)):''}${more?ui.link(c,path,'Next',extra+'&page='+(page+1)):''}</div>`;
const filterForm=(c,path,fields)=>`<form method="get" action="/panel/${path}" class="filters">${ui.hidden('school',c.schoolId)}${fields}<button>Apply filters</button></form>`;
const requireService=async(c,name)=>s.feature(c.schoolId,name);
async function context(req) {
  const user=req.user;
  let schoolId=user.role==='superadmin'?String(req.body?.school||req.query.school||''):user.school_id;
  if(user.role==='superadmin'&&!schoolId)schoolId=(await s.one('SELECT id FROM schools ORDER BY active DESC,name LIMIT 1'))?.id||'';
  const school=schoolId?await s.one('SELECT * FROM schools WHERE id=?',[schoolId]):null;
  if(schoolId&&!school)throw new s.UserError('School does not exist.',404);
  if(user.role!=='superadmin'&&!school?.active)throw new s.UserError('School is inactive.',403);
  return {user,csrf:req.csrfToken,schoolId,school,path:req.path.replace(/^\//,''),flash:s.text(req.query.message,240)};
}
async function structure(c) {return s.rows('SELECT s.*,c.name AS class_name FROM sections s JOIN classes c ON c.id=s.class_id AND c.school_id=s.school_id WHERE s.school_id=? ORDER BY c.name,s.name',[c.schoolId]);}
const sectionOptions=secs=>secs.map(sec=>[String(sec.id),sec.class_name+' / '+sec.name]);
// Login CSRF: GET /login sets a 48-hex-char (24-byte) HttpOnly SameSite=Strict cookie
// named panel_login; POST /login must echo it back as _login_csrf. The regex reads the
// cookie manually from the raw header (no cookie-parser dependency), so it must tolerate
// missing/empty cookie strings and adjacent cookies on either side.
function loginCsrf(req) {return /(?:^|;\s*)panel_login=([a-f0-9]{48})(?:;|$)/.exec(req.headers.cookie||'')?.[1];}
router.use((req,res,next)=>{res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','same-origin');res.set('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'none'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");next();});
router.get('/login',(req,res)=>{
  const csrf=crypto.randomBytes(24).toString('hex');res.set('Set-Cookie','panel_login='+csrf+'; HttpOnly; SameSite=Strict; Path=/panel; Max-Age=600'+(req.secure||process.env.NODE_ENV==='production'?'; Secure':''));res.send(ui.loginPage(csrf));
});
router.post('/login',wrap(async(req,res)=>{
  const csrf=loginCsrf(req);if(!csrf||csrf!==req.body._login_csrf)return res.status(403).send('Login form expired. Reload the sign-in page.');
  const email=s.text(req.body.email,160).toLowerCase(),key=email+'|'+req.ip;
  if(loginLocked(key)||loginLocked('ip:'+req.ip))return res.status(429).send(ui.loginPage(csrf,'Too many attempts. Try again in 10 minutes.'));
  const user=await s.one('SELECT * FROM staff_users WHERE email=?',[email]);
  if(!user?.active||!['admin','superadmin'].includes(user.role)||!verifyPassword(req.body.password,user.password_hash)) {loginFailed(key);loginFailed('ip:'+req.ip);return res.status(401).send(ui.loginPage(csrf,'Email, password or panel access is invalid.'));}
  if(user.role==='admin'&&!await s.one('SELECT id FROM schools WHERE id=? AND active=1',[user.school_id]))return res.status(403).send(ui.loginPage(csrf,'This school is inactive.'));
  const session=await createSession(user.id);loginSucceeded(key);res.set('Set-Cookie',[sessionCookieHeader(req,session.token),'panel_login=; HttpOnly; SameSite=Strict; Path=/panel; Max-Age=0']);res.redirect('/panel/');
}));
router.use(requireAuth);
router.use((req,res,next)=>{
  if(req.method!=='POST')return next();
  if(req.headers.origin) {let origin;try{origin=new URL(req.headers.origin);}catch{return res.status(403).send('Invalid origin.');}if(origin.host!==req.get('host'))return res.status(403).send('Cross-site requests are not allowed.');}
  if(req.is('multipart/form-data'))return upload.single('file')(req,res,err=>err?next(err):checkCsrf(req,res,next));
  return checkCsrf(req,res,next);
});
router.use(wrap(async(req,res,next)=>{req.panel=await context(req);next();}));
router.post('/logout',wrap(async(req,res)=>{await destroySession(req.user.token);res.set('Set-Cookie',clearCookieHeader());res.redirect('/panel/login');}));
router.get('/',wrap(async(req,res)=>{
  const c=req.panel;if(!c.school)return redirect(res,c,'schools','Create your first school.');
  const stats=await s.one("SELECT SUM(status='present') AS present,SUM(status='absent') AS absent,SUM(status='leave') AS leave FROM attendance WHERE school_id=? AND day=?",[c.schoolId,todayIST()]);
  const pending=await s.one("SELECT COUNT(*) AS n FROM leaves WHERE school_id=? AND status='pending'",[c.schoolId]);
  const hw=await s.rows('SELECT h.subject,h.text,t.name AS teacher,c.name AS class_name,se.name AS section_name FROM homework h JOIN teachers t ON t.id=h.teacher_id AND t.school_id=h.school_id JOIN sections se ON se.id=h.section_id AND se.school_id=h.school_id JOIN classes c ON c.id=se.class_id AND c.school_id=se.school_id WHERE h.school_id=? AND h.day=? ORDER BY h.id DESC LIMIT 15',[c.schoolId,todayIST()]);
  const setup=await s.one("SELECT COUNT(*) AS n FROM students WHERE school_id=? AND active=1 AND (section_id IS NULL OR roll_no='')",[c.schoolId]);
  const outbox=await s.rows('SELECT status,COUNT(*) AS n FROM outbox WHERE school_id=? GROUP BY status',[c.schoolId]);
  let body=ui.note('Today · '+todayIST()+' · Asia/Kolkata')+'<div class="stats">'+[['Present',stats.present||0],['Absent',stats.absent||0],['On leave',stats.leave||0],['Pending leave',pending.n]].map(([name,n])=>`<div class="stat"><strong>${n}</strong><span>${name}</span></div>`).join('')+'</div>';
  if(Number(setup.n))body+=`<div class="notice">${setup.n} student(s) need a section or roll number. Existing records were preserved without inventing new roll numbers. ${ui.link(c,'students','Review students')}</div>`;
  body+=ui.card("Today's homework",ui.table(['Class','Subject','Teacher','Homework'],hw.map(h=>[h.class_name+' '+h.section_name,h.subject,h.teacher,h.text]))+ui.link(c,'homework','All homework'));
  body+=ui.card('Quick actions',`<div class="filters">${ui.link(c,'students','Add student')}${ui.link(c,'import','Import CSV / XLSX')}${ui.link(c,'attendance','Attendance report')}${ui.link(c,'leaves','Review leave requests')}</div>`);
  body+=ui.card('Notification delivery',ui.table(['Status','Messages'],outbox.map(o=>[ui.raw(ui.badge(o.status)),o.n]))+ui.note('Queued is not delivered. Blocked messages need an approved template or updated settings.')+ui.link(c,'notifications','Review delivery'));
  res.send(ui.layout(c,'School overview',body));
}));
router.get('/structure',wrap(async(req,res)=>{
  const c=req.panel,classes=await s.rows('SELECT * FROM classes WHERE school_id=? ORDER BY name',[c.schoolId]),secs=await structure(c),teachers=await s.rows('SELECT id,name FROM teachers WHERE school_id=? AND active=1',[c.schoolId]);
  const classForm=cls=>ui.form(c,'structure',ui.hidden('kind','class')+ui.hidden('id',cls?.id||'')+ui.field('Class name','name',cls?.name||'','text','required maxlength="60"')+ui.select('Status','active',activeOptions,cls?.active??1,null));
  const sectionForm=sec=>ui.form(c,'structure',ui.hidden('kind','section')+ui.hidden('id',sec?.id||'')+ui.select('Class','class_id',classes.map(x=>[x.id,x.name]),sec?.class_id||'')+ui.field('Section name','name',sec?.name||'','text','required maxlength="60"')+ui.select('Class teacher','class_teacher_id',teachers.map(x=>[x.id,x.name]),sec?.class_teacher_id||'','Not assigned')+ui.select('Status','active',activeOptions,sec?.active??1,null));
  res.send(ui.layout(c,'Classes & sections',ui.note('Use your own names. Only the assigned class teacher receives leave requests. Deactivation preserves existing records.')+ui.card('Create structure',detail('Add class',classForm())+detail('Add section',sectionForm()))+ui.card('Classes',classes.map(cls=>detail(cls.name,classForm(cls))).join('')||ui.note('No classes yet.'))+ui.card('Sections',secs.map(sec=>detail(sec.class_name+' / '+sec.name,sectionForm(sec))).join('')||ui.note('No sections yet.'))));
}));
router.post('/structure',wrap(async(req,res)=>{await admin.saveStructure(req.panel.schoolId,req.user,req.body,token(req));redirect(res,req.panel,'structure');}));
router.get('/teachers',wrap(async(req,res)=>{
  const c=req.panel,teachers=await s.rows('SELECT * FROM teachers WHERE school_id=? ORDER BY name',[c.schoolId]),secs=await structure(c);
  const assignments=await s.rows('SELECT a.*,t.name AS teacher,c.name AS class_name,se.name AS section_name FROM teacher_assignments a JOIN teachers t ON t.id=a.teacher_id AND t.school_id=a.school_id JOIN sections se ON se.id=a.section_id AND se.school_id=a.school_id JOIN classes c ON c.id=se.class_id AND c.school_id=se.school_id WHERE a.school_id=? ORDER BY t.name,c.name',[c.schoolId]);
  const teacherForm=t=>ui.form(c,'teachers',ui.hidden('id',t?.id||'')+ui.field('Teacher name','name',t?.name||'','text','required maxlength="80"')+ui.field('WhatsApp number','wa_id',t?.wa_id||'','tel','required')+ui.select('Status','active',activeOptions,t?.active??1,null)+`<div class="wide">${s.PERMISSIONS.map(p=>ui.check(permissionLabels[p],'can_'+p,t?!!t['can_'+p]:p!=='marks_edit')).join('')}</div>`);
  const assignForm=ui.form(c,'teachers',ui.hidden('operation','assign')+ui.select('Teacher','teacher_id',teachers.filter(t=>t.active).map(t=>[t.id,t.name]))+ui.select('Class / section','section_id',sectionOptions(secs.filter(s=>s.active)))+ui.field('Subject name','subject','','text','required maxlength="80"'),'Assign subject');
  res.send(ui.layout(c,'Teachers',ui.note('Teachers have no web-panel access. Permissions and assignments are checked again when they confirm a WhatsApp action.')+ui.card('Add a teacher',teacherForm())+ui.card('Teacher permissions',teachers.map(t=>detail(t.name+' · '+t.wa_id,teacherForm(t))).join('')||ui.note('No teachers yet.'))+ui.card('Assign classes & subjects',assignForm)+ui.card('Current assignments',ui.table(['Teacher','Class','Subject','Action'],assignments.map(a=>[a.teacher,a.class_name+' / '+a.section_name,a.subject,ui.raw(ui.form(c,'teachers',ui.hidden('operation','assignment_delete')+ui.hidden('id',a.id),'Remove'))])))));
}));
router.post('/teachers',wrap(async(req,res)=>{await admin.saveTeacher(req.panel.schoolId,req.user,req.body,token(req));redirect(res,req.panel,'teachers');}));
router.get('/students',wrap(async(req,res)=>{
  const c=req.panel,secs=await structure(c),q=s.text(req.query.q,80),section=req.query.section?s.id(req.query.section):null,page=Math.max(0,Math.min(10000,Number(req.query.page)||0));
  const filter='s.school_id=?'+(section?' AND s.section_id=?':'')+(q?' AND (s.name LIKE ? OR s.roll_no LIKE ? OR s.admission_no LIKE ?)':''),args=[c.schoolId,...(section?[section]:[]),...(q?Array(3).fill('%'+q+'%'):[])];
  const list=await s.rows(`SELECT s.*,c.name AS class_name,se.name AS section_name,(SELECT group_concat(p.name||' · '||p.wa_id, char(10)) FROM parent_student ps JOIN parents p ON p.id=ps.parent_id AND p.school_id=ps.school_id WHERE ps.school_id=s.school_id AND ps.student_id=s.id) AS parents FROM students s LEFT JOIN classes c ON c.id=s.class_id AND c.school_id=s.school_id LEFT JOIN sections se ON se.id=s.section_id AND se.school_id=s.school_id WHERE ${filter} ORDER BY s.name LIMIT 101 OFFSET ?`,[...args,page*100]);
  const editing=req.query.edit?await s.one('SELECT * FROM students WHERE id=? AND school_id=?',[s.id(req.query.edit),c.schoolId]):null;if(req.query.edit&&!editing)throw new s.UserError('Student not found.',404);
  const f=ui.form(c,'students',ui.hidden('id',editing?.id||'')+ui.field('Student name','name',editing?.name||'','text','required maxlength="100"')+ui.field('Admission number','admission_no',editing?.admission_no||'','text','required maxlength="60"')+ui.select('Class / section','section_id',sectionOptions(secs.filter(s=>s.active)),editing?.section_id||'')+ui.field('Roll number','roll_no',editing?.roll_no||'','text','required maxlength="24"')+ui.field('Fees due (INR)','fees_due',editing?.fees_due||0,'number','min="0" max="100000000" step="0.01"')+ui.select('Status','active',activeOptions,editing?.active??1,null)+ui.field('Parent name (optional)','parent_name')+ui.field('Parent phone (optional)','parent_phone','','tel'),editing?'Save student':'Add student');
  res.send(ui.layout(c,'Students',ui.card(editing?'Edit student':'Add student',f)+ui.card('Student directory',`<div class="filters">${ui.link(c,'import','Import CSV / XLSX')}</div>`+filterForm(c,'students',ui.field('Name, roll or admission','q',q)+ui.select('Class / section','section',sectionOptions(secs),section||'','All sections'))+ui.table(['Student','Admission','Class','Roll','Parent contacts','Fees due','Status','Action'],list.slice(0,100).map(st=>[st.name,st.admission_no,[st.class_name,st.section_name].filter(Boolean).join(' / ')||'Not assigned',st.roll_no||'Not assigned',st.parents||'No parent linked','₹'+Number(st.fees_due).toLocaleString('en-IN'),st.active?'Active':'Inactive',ui.raw(ui.link(c,'students','Edit','&edit='+st.id))]))+pager(c,'students',page,list.length>100,'&q='+encodeURIComponent(q)+'&section='+(section||'')))));
}));
router.post('/students',wrap(async(req,res)=>{await admin.saveStudent(req.panel.schoolId,req.user,req.body,token(req));redirect(res,req.panel,'students');}));
router.get('/parents',wrap(async(req,res)=>{
  const c=req.panel,list=await s.rows('SELECT p.*,(SELECT group_concat(s.name, char(10)) FROM parent_student ps JOIN students s ON s.id=ps.student_id AND s.school_id=ps.school_id WHERE ps.school_id=p.school_id AND ps.parent_id=p.id) AS children FROM parents p WHERE p.school_id=? ORDER BY p.name LIMIT 1000',[c.schoolId]),students=await s.rows('SELECT id,name,admission_no FROM students WHERE school_id=? AND active=1 ORDER BY name LIMIT 1000',[c.schoolId]);
  const edited=req.query.edit?list.find(p=>Number(p.id)===Number(req.query.edit)):null;
  const create=ui.form(c,'parents',ui.hidden('id',edited?.id||'')+ui.field('Parent name','name',edited?.name||'','text','required')+ui.field('WhatsApp number','wa_id',edited?.wa_id||'','tel','required'),edited?'Save parent':'Add parent');
  const link=ui.form(c,'parents/link',ui.select('Parent','parent_id',list.map(p=>[p.id,p.name+' · '+p.wa_id]))+ui.select('Student','student_id',students.map(st=>[st.id,st.name+' · '+st.admission_no]))+ui.select('Action','operation',[['link','Link student'],['unlink','Unlink student']],'link',null),'Update link');
  res.send(ui.layout(c,'Parents',ui.note('New or changed numbers must confirm on WhatsApp before seeing children. Linking never sends a student list to an unconfirmed number.')+ui.card(edited?'Edit parent':'Add parent',create)+ui.card('Parent–student links',link)+ui.card('Directory',ui.table(['Parent','Phone','Children','Confirmed','Updates','Action'],list.map(p=>[p.name,p.wa_id,p.children||'—',p.confirmed?'Yes':'Waiting for YES',p.opted_out?'Opted out':'Allowed',ui.raw(ui.link(c,'parents','Edit','&edit='+p.id))])))));
}));
router.post('/parents',wrap(async(req,res)=>{
  const c=req.panel;await s.write(c.schoolId,c.user.staff_id,token(req),'parent_update',async tx=>{
    const name=s.text(req.body.name,100),wa=admin.phone(req.body.wa_id);if(!name)throw new s.UserError('Name is required.');
    if(req.body.id){const p=await s.one('SELECT * FROM parents WHERE school_id=? AND id=?',[c.schoolId,s.id(req.body.id)],tx);if(!p)throw new s.UserError('Parent unavailable.',403);await s.run('UPDATE parents SET name=?,wa_id=?,confirmed=?,opted_out=? WHERE id=? AND school_id=?',[name,wa,wa===p.wa_id?p.confirmed:0,wa===p.wa_id?p.opted_out:0,p.id,c.schoolId],tx);return {id:Number(p.id)};}
    return {id:Number((await s.run('INSERT INTO parents(school_id,name,wa_id) VALUES(?,?,?)',[c.schoolId,name,wa],tx)).lastInsertRowid)};
  });redirect(res,c,'parents');
}));
router.post('/parents/link',wrap(async(req,res)=>{
  const c=req.panel,pid=s.id(req.body.parent_id),sid=s.id(req.body.student_id);await s.write(c.schoolId,c.user.staff_id,token(req),'parent_link',async tx=>{
    if(!await s.one('SELECT id FROM parents WHERE school_id=? AND id=?',[c.schoolId,pid],tx)||!await s.one('SELECT id FROM students WHERE school_id=? AND id=?',[c.schoolId,sid],tx))throw new s.UserError('Parent or student unavailable.',403);
    if(req.body.operation==='unlink')await s.run('DELETE FROM parent_student WHERE school_id=? AND parent_id=? AND student_id=?',[c.schoolId,pid,sid],tx);else await s.run('INSERT OR IGNORE INTO parent_student(school_id,parent_id,student_id) VALUES(?,?,?)',[c.schoolId,pid,sid],tx);return {parentId:pid,studentId:sid};
  });redirect(res,c,'parents');
}));
router.get('/import',wrap(async(req,res)=>{
  const c=req.panel;res.send(ui.layout(c,'Import students',ui.note('CSV and genuine XLSX files · up to 2 MB · 1,000 data rows · 50 columns. Create class and section names first. No changes are made until you review and confirm.')+ui.card('1. Upload spreadsheet',ui.form(c,'import/upload',ui.field('CSV or XLSX file','file','','file','required accept=".csv,.xlsx"'),'Upload and map columns',true)+ui.link(c,'import/template','Download CSV template'))));
}));
router.get('/import/template',(req,res)=>{res.set('Content-Disposition','attachment; filename="student-import-template.csv"').type('text/csv').send('name,admission_no,class,section,roll_no,parent_name,parent_phone,fees_due\r\nExample Student,EXAMPLE-001,VI,Lotus,1,Example Parent,+919876543210,0\r\n');});
router.post('/import/upload',wrap(async(req,res)=>{
  const c=req.panel;if(!req.file)throw new s.UserError('Choose a file.');
  const sheets=await readSpreadsheet(req.file.buffer,req.file.originalname),job=s.newToken();
  await s.run('INSERT INTO import_jobs(id,school_id,staff_id,payload,expires_at) VALUES(?,?,?,?,?)',[job,c.schoolId,c.user.staff_id,JSON.stringify({sheets}),Date.now()+600000]);
  res.redirect('/panel/import/map'+sq(c)+'&job='+job);
}));
async function importJob(c,job) {const r=await s.one("SELECT * FROM import_jobs WHERE id=? AND school_id=? AND staff_id=? AND status='preview' AND expires_at>?",[String(job),c.schoolId,c.user.staff_id,Date.now()]);if(!r)throw new s.UserError('Upload expired or unavailable.',403);return JSON.parse(r.payload);}
router.get('/import/map',wrap(async(req,res)=>{
  const c=req.panel;let job=String(req.query.job||'');
  if(!job){const latest=await s.one("SELECT id FROM import_jobs WHERE school_id=? AND staff_id=? AND status='preview' AND expires_at>? ORDER BY expires_at DESC LIMIT 1",[c.schoolId,c.user.staff_id,Date.now()]);job=latest?.id||'';}
  const source=await importJob(c,job);if(!source.sheets)throw new s.UserError('Choose a new upload.');
  const sheetIndex=Math.max(0,Math.min(source.sheets.length-1,Number(req.query.sheet)||0)),sheet=source.sheets[sheetIndex],mapping=guessMapping(sheet.rows[0]||[]);
  const picker=`<form method="get" class="filters">${ui.hidden('school',c.schoolId)}${ui.hidden('job',job)}${ui.select('Worksheet','sheet',source.sheets.map((sh,i)=>[i,sh.name]),sheetIndex,null)}<button>Use worksheet</button></form>`;
  const columns=(sheet.rows[0]||[]).map((name,i)=>[i,`${i+1}. ${name||'(blank header)'}`]);
  const mappingForm=ui.form(c,'import/preview',ui.hidden('job',job)+ui.hidden('sheet',sheetIndex)+FIELDS.map(f=>ui.select(f.replaceAll('_',' '),'map_'+f,[[-1,'Not mapped'],...columns],mapping[f],null)).join('')+ui.check('Update students with matching admission numbers (preserves unmapped fees)','update'),'Validate and preview');
  res.send(ui.layout(c,'Map spreadsheet columns',ui.card('2. Worksheet',picker+ui.note(sheet.rows.length-1+' data rows')+ui.table(sheet.rows[0]||[],sheet.rows.slice(1,4)))+ui.card('3. Column mapping',mappingForm)));
}));
router.post('/import/preview',wrap(async(req,res)=>{
  const c=req.panel,source=await importJob(c,req.body.job),index=Number(req.body.sheet);if(!source.sheets?.[index])throw new s.UserError('Invalid worksheet.');
  const mapping=Object.fromEntries(FIELDS.map(f=>[f,Number(req.body['map_'+f])]));
  const preview=await stageImport(c.schoolId,c.user,source.sheets[index].rows,mapping,!!req.body.update);
  res.redirect('/panel/import/preview'+sq(c)+'&job='+preview.job);
}));
router.get('/import/preview',wrap(async(req,res)=>{
  const c=req.panel,job=String(req.query.job||''),source=await importJob(c,job),preview=await validateImport(c.schoolId,source.grid,source.mapping,source.update),page=Math.max(0,Number(req.query.page)||0);
  const errors=preview.errors.length?ui.card('Fix these errors',ui.table(['Row','Problem'],preview.errors.map(e=>[e.row,e.message]))):ui.note('No validation errors. This preview expires in 10 minutes.');
  const commit=preview.errors.length?'':ui.form(c,'import/commit',ui.hidden('job',job),`Confirm ${preview.valid.length} student(s)`);
  res.send(ui.layout(c,'Review import',errors+ui.card('4. Preview',ui.note(preview.valid.length+' valid row(s). Existing students: '+(preview.update?'update mode':'create-only mode'))+ui.table(['Row','Name','Admission','Class','Section','Roll','Parent','Phone','Fees'],preview.valid.slice(page*50,page*50+50).map(r=>[r.row,r.name,r.admission_no,r.class,r.section,r.roll_no,r.parent_name,r.parent_phone,r.fees_due]))+pager(c,'import/preview',page,preview.valid.length>(page+1)*50,'&job='+job))+commit));
}));
router.post('/import/commit',wrap(async(req,res)=>{const c=req.panel,result=await commitImport(c.schoolId,c.user,String(req.body.job));redirect(res,c,'students',result.imported+' student(s) imported.');}));
router.get('/attendance',wrap(async(req,res)=>{
  const c=req.panel;await requireService(c,'attendance');const date=s.day(req.query.day||todayIST()),secs=await structure(c),section=req.query.section?s.id(req.query.section):null,q=s.text(req.query.q,80),status=['present','absent','leave','unmarked'].includes(req.query.status)?req.query.status:'';
  const sql=`SELECT st.id,st.name,st.roll_no,c.name AS class_name,se.name AS section_name,a.status,t.name AS teacher,(SELECT group_concat(p.wa_id,', ') FROM parent_student ps JOIN parents p ON p.id=ps.parent_id AND p.school_id=ps.school_id WHERE ps.school_id=st.school_id AND ps.student_id=st.id) AS phones
    FROM students st LEFT JOIN classes c ON c.id=st.class_id AND c.school_id=st.school_id LEFT JOIN sections se ON se.id=st.section_id AND se.school_id=st.school_id
    LEFT JOIN attendance a ON a.student_id=st.id AND a.school_id=st.school_id AND a.day=? LEFT JOIN teachers t ON t.id=a.marked_by AND t.school_id=a.school_id
    WHERE st.school_id=? AND st.active=1${section?' AND st.section_id=?':''}${q?' AND (st.name LIKE ? OR st.roll_no LIKE ?)':''}${status==='unmarked'?' AND a.id IS NULL':status?' AND a.status=?':''} ORDER BY c.name,se.name,CAST(st.roll_no AS INTEGER),st.roll_no LIMIT 1000`;
  const list=await s.rows(sql,[date,c.schoolId,...(section?[section]:[]),...(q?['%'+q+'%','%'+q+'%']:[]),...(status&&status!=='unmarked'?[status]:[])]);
  res.send(ui.layout(c,'Attendance',ui.card('Daily register',filterForm(c,'attendance',ui.field('Date','day',date,'date')+ui.select('Class / section','section',sectionOptions(secs),section||'','All sections')+ui.field('Student name or roll','q',q)+ui.select('Show','status',[['present','Only present'],['absent','Only absent'],['leave','Approved leave'],['unmarked','Not marked']],status,'Everyone'))+ui.table(['Student','Roll','Class','Status','Marked by','Parent numbers'],list.map(st=>[st.name,st.roll_no,st.class_name+' / '+st.section_name,ui.raw(ui.badge(st.status||'unmarked')),st.teacher||'—',st.phones||'—']))+ui.note('Up to 1,000 matching students. Narrow the class filter for larger schools. Unmarked is not counted as absent.'))));
}));
router.get('/homework',wrap(async(req,res)=>{
  const c=req.panel;await requireService(c,'homework');const date=s.day(req.query.day||todayIST()),secs=await structure(c),section=req.query.section?s.id(req.query.section):null;
  const list=await s.rows('SELECT h.*,t.name AS teacher,c.name AS class_name,se.name AS section_name FROM homework h JOIN teachers t ON t.id=h.teacher_id AND t.school_id=h.school_id JOIN sections se ON se.id=h.section_id AND se.school_id=h.school_id JOIN classes c ON c.id=se.class_id AND c.school_id=se.school_id WHERE h.school_id=? AND h.day=?'+(section?' AND h.section_id=?':'')+' ORDER BY h.id DESC LIMIT 500',[c.schoolId,date,...(section?[section]:[])]);
  res.send(ui.layout(c,'Homework',ui.card('Teacher posts',filterForm(c,'homework',ui.field('Date','day',date,'date')+ui.select('Class / section','section',sectionOptions(secs),section||'','All sections'))+ui.table(['Class','Subject','Teacher','Homework','Posted'],list.map(h=>[h.class_name+' / '+h.section_name,h.subject,h.teacher,h.text,h.created_at])))));
}));
router.get('/leaves',wrap(async(req,res)=>{
  const c=req.panel;await requireService(c,'leave');const secs=await structure(c),section=req.query.section?s.id(req.query.section):null,status=['pending','approved','rejected'].includes(req.query.status)?req.query.status:'',date=req.query.day?s.day(req.query.day):'';
  const list=await s.rows(`SELECT l.*,st.name,st.roll_no,c.name AS class_name,se.name AS section_name,t.name AS teacher,(SELECT group_concat(p.wa_id,', ') FROM parent_student ps JOIN parents p ON p.id=ps.parent_id AND p.school_id=ps.school_id WHERE ps.school_id=l.school_id AND ps.student_id=l.student_id) AS phones
    FROM leaves l JOIN students st ON st.id=l.student_id AND st.school_id=l.school_id LEFT JOIN sections se ON se.id=l.section_id AND se.school_id=l.school_id LEFT JOIN classes c ON c.id=se.class_id AND c.school_id=se.school_id LEFT JOIN teachers t ON t.id=se.class_teacher_id AND t.school_id=se.school_id
    WHERE l.school_id=?${section?' AND l.section_id=?':''}${status?' AND l.status=?':''}${date?' AND l.day=?':''} ORDER BY l.id DESC LIMIT 500`,[c.schoolId,...(section?[section]:[]),...(status?[status]:[]),...(date?[date]:[])]);
  res.send(ui.layout(c,'Leave requests',ui.note('Only the assigned class teacher decides requests on WhatsApp. An unassigned request stays pending; assign a class teacher under Classes & sections.')+ui.card('Applications',filterForm(c,'leaves',ui.field('Date (optional)','day',date,'date')+ui.select('Class / section','section',sectionOptions(secs),section||'','All sections')+ui.select('Status','status',[['pending','Pending'],['approved','Approved'],['rejected','Rejected']],status,'All statuses'))+ui.table(['Student / roll','Class','Date','Title / type','Reason','Status','Teacher / note','Parent numbers'],list.map(l=>[l.name+' / '+l.roll_no,l.class_name+' / '+l.section_name,l.day,l.title+' / '+l.type,l.reason,ui.raw(ui.badge(l.status)),(l.teacher||'Not assigned')+(l.teacher_note?'\n'+l.teacher_note:''),l.phones||'—'])))));
}));
router.get('/marks',wrap(async(req,res)=>{
  const c=req.panel;await requireService(c,'marks');let body;
  if(req.query.exam) {
    const e=await s.one('SELECT * FROM marks_exams WHERE school_id=? AND id=?',[c.schoolId,s.id(req.query.exam)]);if(!e)throw new s.UserError('Exam unavailable.',404);
    const list=await s.rows('SELECT m.*,st.name,st.roll_no FROM marks m JOIN students st ON st.id=m.student_id AND st.school_id=m.school_id WHERE m.school_id=? AND m.exam_id=? ORDER BY CAST(st.roll_no AS INTEGER),st.roll_no',[c.schoolId,e.id]);
    body=ui.card(e.subject+' · '+e.name,ui.note('Maximum marks: '+e.total_marks)+ui.table(['Roll','Student','Marks','Updated'],list.map(m=>[m.roll_no,m.name,m.marks,m.updated_at])));
  } else {
    const list=await s.rows('SELECT e.*,c.name AS class_name,se.name AS section_name,t.name AS teacher FROM marks_exams e JOIN sections se ON se.id=e.section_id AND se.school_id=e.school_id JOIN classes c ON c.id=se.class_id AND c.school_id=se.school_id LEFT JOIN teachers t ON t.id=e.uploaded_by AND t.school_id=e.school_id WHERE e.school_id=? ORDER BY e.id DESC LIMIT 200',[c.schoolId]);
    body=ui.card('Teacher uploads',ui.table(['Test','Class','Subject','Maximum','Teacher','Date','Action'],list.map(e=>[e.name,e.class_name+' / '+e.section_name,e.subject,e.total_marks,e.teacher||'Demo',e.test_date||e.created_at,ui.raw(ui.link(c,'marks','View marks','&exam='+e.id))])));
  }
  res.send(ui.layout(c,'Marks',ui.note('Teachers review before saving. Past uploads can be edited only when you grant that teacher “Edit own past marks”. Every mark change is audited.')+body));
}));
router.get('/datesheets',wrap(async(req,res)=>{
  const c=req.panel;await requireService(c,'datesheet');const secs=await structure(c),docs=await s.rows('SELECT id,title,kind,pdf_name,section_id,created_at FROM date_sheets WHERE school_id=? AND active=1 ORDER BY id DESC',[c.schoolId]);
  const f=ui.form(c,'datesheets',ui.field('Title','title','','text','required maxlength="100"')+ui.select('Audience','section_id',sectionOptions(secs),'','Whole school')+ui.field('PDF / JPEG / PNG (optional)','file','','file','accept=".pdf,.jpg,.jpeg,.png"')+ui.area('Or paste the date sheet text','content'),'Publish date sheet',true);
  res.send(ui.layout(c,'Date sheets',ui.note('Maximum file size: 1 MB. Files are stored in the database, not ephemeral server disk. Only verified parents/students in the selected audience can request them.')+ui.card('Official school date sheet',f)+ui.card('Published sheets',ui.table(['Title','Audience','Format','Published','File','Action'],docs.map(d=>[d.title,d.section_id?sectionOptions(secs).find(([id])=>Number(id)===Number(d.section_id))?.[1]||'Section':'Whole school',d.kind,d.created_at,d.kind==='file'?ui.raw(ui.link(c,'datesheets/'+d.id+'/file','Download')):'Text',ui.raw(ui.form(c,'datesheets',ui.hidden('deleteId',d.id),'Unpublish'))])))));
}));
router.post('/datesheets',wrap(async(req,res)=>{
  const c=req.panel;if(req.file&&req.file.size>MEDIA_LIMIT)throw new s.UserError('Date-sheet files must be at most 1 MB.');
  await admin.saveDateSheet(c.schoolId,c.user,{...req.body,kind:req.file?'file':'text',buffer:req.file?.buffer,name:req.file?.originalname},token(req));redirect(res,c,'datesheets');
}));
router.get('/datesheets/:id/file',wrap(async(req,res)=>{
  const c=req.panel;await requireService(c,'datesheet');const doc=await s.one("SELECT * FROM date_sheets WHERE id=? AND school_id=? AND active=1 AND kind='file'",[s.id(req.params.id),c.schoolId]);if(!doc)throw new s.UserError('File unavailable.',404);
  res.set('Content-Disposition','attachment; filename="'+String(doc.pdf_name||'date-sheet').replace(/[^\w .-]/g,'_')+'"').type(doc.mime_type).send(Buffer.from(doc.pdf));
}));
router.get('/events',wrap(async(req,res)=>{
  const c=req.panel;await requireService(c,'events');const list=await s.rows('SELECT * FROM school_events WHERE school_id=? ORDER BY event_date DESC LIMIT 200',[c.schoolId]),edit=req.query.edit?list.find(e=>Number(e.id)===Number(req.query.edit)):null;
  res.send(ui.layout(c,'Events & holidays',ui.card(edit?'Edit event':'Add event',ui.form(c,'events',ui.hidden('id',edit?.id||'')+ui.field('Name','name',edit?.name||'','text','required maxlength="100"')+ui.field('Date','event_date',edit?.event_date||todayIST(),'date','required')+ui.select('Type','kind',[['event','Event'],['holiday','Holiday']],edit?.kind||'event',null)+ui.area('Details','details',edit?.details||'')))+ui.card('Calendar',ui.table(['Date','Name','Type','Details','Action'],list.map(e=>[e.event_date,e.name,e.kind,e.details,ui.raw(ui.link(c,'events','Edit','&edit='+e.id)+' '+ui.form(c,'events',ui.hidden('deleteId',e.id),'Delete'))])))));
}));
router.post('/events',wrap(async(req,res)=>{
  const c=req.panel;await requireService(c,'events');await s.write(c.schoolId,c.user.staff_id,token(req),'event_update',async tx=>{
    if(req.body.deleteId){await s.run('DELETE FROM school_events WHERE school_id=? AND id=?',[c.schoolId,s.id(req.body.deleteId)],tx);return {deleted:s.id(req.body.deleteId)};}
    const name=s.text(req.body.name,100),date=s.day(req.body.event_date),kind=req.body.kind;if(!name||!['event','holiday'].includes(kind))throw new s.UserError('Name, date and event type are required.');
    if(req.body.id){await s.run('UPDATE school_events SET name=?,event_date=?,kind=?,details=? WHERE school_id=? AND id=?',[name,date,kind,s.text(req.body.details,2000),c.schoolId,s.id(req.body.id)],tx);return {id:s.id(req.body.id)};}
    return {id:Number((await s.run('INSERT INTO school_events(school_id,name,event_date,kind,details) VALUES(?,?,?,?,?)',[c.schoolId,name,date,kind,s.text(req.body.details,2000)],tx)).lastInsertRowid)};
  });redirect(res,c,'events');
}));
router.get('/menu',wrap(async(req,res)=>{
  const c=req.panel,school=await s.schoolConfig(c.schoolId),body=Object.entries(s.MENU_FIELDS).map(([module,fields])=>`<section class="card"><h3>${ui.esc(labels[module])}</h3>${ui.check('Show this menu option','menu_'+module,s.menuAllowed(school,module))}${!school.flags[module]&&Object.hasOwn(school.flags,module)?ui.note('This service is disabled by the superadmin. Menu settings cannot override that restriction.'):''}<div class="filters">${fields.map(f=>ui.check(f.replaceAll('_',' '),'field_'+module+'_'+f,s.menuAllowed(school,module,f))).join('')}</div></section>`).join('');
  res.send(ui.layout(c,'Parent menu control',ui.note('Choose both menu options and the sub-options inside them. Language and Back remain available. Changes apply to verified parent and eligible student accounts.')+ui.form(c,'settings',ui.hidden('tab','menu')+'<div class="wide">'+body+'</div>','Save parent menu')));
}));
router.get('/settings',wrap(async(req,res)=>{
  const c=req.panel;res.send(ui.layout(c,'School profile',ui.card('Public information',ui.form(c,'settings',ui.hidden('tab','profile')+ui.field('School name','name',c.school.name,'text','required')+ui.field('Office phone','office_phone',c.school.office_phone,'tel')+ui.area('School timings','timings',c.school.timings)+ui.area('Holiday information','holidays',c.school.holidays)+ui.area('Notices','notices',c.school.notices)+ui.area('Public AI knowledge base','kb',c.school.kb,8))+ui.note('Do not put student records, passwords or confidential material in the public knowledge base.'))));
}));
router.post('/settings',wrap(async(req,res)=>{const c=req.panel;await admin.saveSettings(c.schoolId,c.user,req.body,token(req));redirect(res,c,req.body.tab==='menu'?'menu':req.body.tab==='notifications'?'notifications':'settings');}));
router.get('/notifications',wrap(async(req,res)=>{
  const c=req.panel,school=await s.schoolConfig(c.schoolId),list=await s.rows('SELECT id,wa_id,kind,status,attempts,error,created_at FROM outbox WHERE school_id=? ORDER BY id DESC LIMIT 100',[c.schoolId]);
  const templateFields=['attendance_absent','attendance_present','attendance_leave','leave_request','leave_result'].map(kind=>{
    const v=school.options.templates?.[kind]||{};
    return detail(kind.replaceAll('_',' '),`<div class="form-grid">${ui.field('Approved template name','template_'+kind,v.name||'')}${ui.field('Template language code','language_'+kind,v.language||'en')}${ui.check('Approved utility template in Meta; parameter order checked','approved_'+kind,v.approved)}</div>`);
  }).join('');
  const f=ui.form(c,'settings',ui.hidden('tab','notifications')+`<div class="wide">${ui.check('Send present notifications (absent and leave updates are separate)','present_notify',!!school.present_notify)}${ui.check('Allow mark-sheet photos to be sent to the configured AI provider; required school processing approval is in place','vision_allowed',!!school.options.vision_allowed)}${ui.note('Photos contain student data. Keep disabled until you approve the provider’s privacy, retention and processing terms. Text marks work without photo AI. Provider pricing is not guaranteed free.')}${templateFields}</div>`,'Save notifications & privacy');
  const retry=j=>['blocked','failed'].includes(j.status)?ui.raw(ui.form(c,'notifications/retry',ui.hidden('id',j.id),'Retry after fixing')):'—';
  res.send(ui.layout(c,'Notifications & AI',ui.card('Delivery settings',ui.note('Within 24 hours of an inbound message, replies can use a service message. Outside that window an approved utility template is required. All templates use text body parameters: attendance = student, date, status; leave result = student, date, decision; leave request = school, request ID. Recipient opt-out is always enforced.')+f)+ui.card('Recent delivery attempts',ui.table(['Recipient','Type','Status','Attempts','Reason','Created','Action'],list.map(j=>[j.wa_id,j.kind,ui.raw(ui.badge(j.status)),j.attempts,j.error,j.created_at,retry(j)]))+ui.note('Uncertain means the send may have succeeded before a timeout/restart. It is not automatically retried, to avoid duplicate messages. Reconcile it in Meta before taking manual action.'))));
}));
router.post('/notifications/retry',wrap(async(req,res)=>{
  const c=req.panel;await s.write(c.schoolId,c.user.staff_id,token(req),'notification_retry',async tx=>{
    const result=await s.run("UPDATE outbox SET status='pending',available_at=0,error='' WHERE school_id=? AND id=? AND status IN('blocked','failed') AND created_at>=datetime('now','-7 days')",[c.schoolId,s.id(req.body.id)],tx);if(!result.rowsAffected)throw new s.UserError('This message cannot be retried automatically.');return {id:s.id(req.body.id)};
  });redirect(res,c,'notifications','Message queued for a fresh permission and delivery check.');
}));
router.get('/admins',wrap(async(req,res)=>{
  const c=req.panel,list=await s.rows("SELECT id,name,email,wa_id,active FROM staff_users WHERE school_id=? AND role='admin' ORDER BY name",[c.schoolId]);
  const f=user=>ui.form(c,'admins',ui.hidden('id',user?.id||'')+ui.field('Admin name','name',user?.name||'','text','required')+ui.field('Email','email',user?.email||'','email','required')+ui.field('WhatsApp number (optional)','wa_id',user?.wa_id||'','tel')+ui.field(user?'New password (leave blank to keep)':'Password (12+ characters)','password','','password','autocomplete="new-password" minlength="12"'+(user?'':' required'))+ui.select('Status','active',activeOptions,user?.active??1,null));
  const students=await s.rows('SELECT id,name,admission_no FROM students WHERE school_id=? AND active=1 ORDER BY name LIMIT 1000',[c.schoolId]),accounts=await s.rows('SELECT a.*,st.name FROM student_accounts a JOIN students st ON st.id=a.student_id AND st.school_id=a.school_id WHERE a.school_id=?',[c.schoolId]);
  const sa=ui.form(c,'student-access',ui.select('Student','student_id',students.map(st=>[st.id,st.name+' · '+st.admission_no]))+ui.field('Student WhatsApp number','wa_id','','tel','required')+ui.check('Age eligibility has been verified for WhatsApp','age_eligible')+ui.check('Required guardian/school consent is recorded','consent_verified'),'Enable student access');
  res.send(ui.layout(c,'School admins',ui.note('Multiple admins are supported. Teachers are managed on the Teachers page and cannot sign in here.')+ui.card('Add admin',f())+ui.card('Current admins',list.map(a=>detail(a.name+' · '+a.email,f(a))).join('')||ui.note('No school admins yet.'))+ui.card('Optional student WhatsApp access',ui.note('Parents are the default audience. Student access requires an explicit school-managed link plus verified age eligibility and consent.')+sa+ui.table(['Student','Number','Eligible / consent','Status','Action'],accounts.map(a=>[a.name,a.wa_id,(a.age_eligible?'Yes':'No')+' / '+(a.consent_verified?'Yes':'No'),a.active?'Active':'Disabled',ui.raw(ui.form(c,'student-access',ui.hidden('disableId',a.id),'Disable'))])))));
}));
router.post('/admins',wrap(async(req,res)=>{await admin.saveAdmin(req.panel.schoolId,req.user,req.body,token(req));redirect(res,req.panel,'admins');}));
router.get('/staff',(req,res)=>redirect(res,req.panel,'admins','Manage school admins here; teachers use WhatsApp.'));
router.post('/student-access',wrap(async(req,res)=>{
  const c=req.panel;await s.write(c.schoolId,c.user.staff_id,token(req),'student_access',async tx=>{
    if(req.body.disableId){await s.run('UPDATE student_accounts SET active=0 WHERE school_id=? AND id=?',[c.schoolId,s.id(req.body.disableId)],tx);return {disabled:s.id(req.body.disableId)};}
    const sid=s.id(req.body.student_id),wa=admin.phone(req.body.wa_id);if(!req.body.age_eligible||!req.body.consent_verified)throw new s.UserError('Age eligibility and consent must both be verified.');
    if(!await s.one('SELECT id FROM students WHERE school_id=? AND id=? AND active=1',[c.schoolId,sid],tx))throw new s.UserError('Student unavailable.',403);
    await s.run('INSERT INTO student_accounts(school_id,student_id,wa_id,age_eligible,consent_verified) VALUES(?,?,?,1,1) ON CONFLICT(school_id,student_id,wa_id) DO UPDATE SET active=1,age_eligible=1,consent_verified=1',[c.schoolId,sid,wa],tx);return {studentId:sid};
  });redirect(res,c,'admins');
}));
router.get('/links',wrap(async(req,res)=>{
  const c=req.panel,list=await s.rows("SELECT * FROM link_requests WHERE school_id=? AND status='pending' ORDER BY id DESC LIMIT 100",[c.schoolId]),students=await s.rows('SELECT id,name,admission_no FROM students WHERE school_id=? AND active=1 ORDER BY name LIMIT 1000',[c.schoolId]);
  res.send(ui.layout(c,'Link requests',ui.note('Verify the request against school records before linking. The sender will still need to confirm YES before viewing student details.')+ui.card('Pending verification',list.map(l=>detail(l.wa_id+' · '+l.note,ui.form(c,'links',ui.hidden('id',l.id)+ui.field('Verified parent name','name')+ui.select('Student','student_id',students.map(st=>[st.id,st.name+' · '+st.admission_no]))+ui.select('Decision','decision',[['approve','Approve link'],['reject','Reject request']],'approve',null),'Save decision'))).join('')||ui.note('No pending requests.'))));
}));
router.post('/links',wrap(async(req,res)=>{
  const c=req.panel;await s.write(c.schoolId,c.user.staff_id,token(req),'link_decision',async tx=>{
    const request=await s.one("SELECT * FROM link_requests WHERE id=? AND school_id=? AND status='pending'",[s.id(req.body.id),c.schoolId],tx);if(!request)throw new s.UserError('Request unavailable.');
    if(req.body.decision==='approve') {
      const sid=s.id(req.body.student_id),name=s.text(req.body.name,100);if(!name||!await s.one('SELECT id FROM students WHERE id=? AND school_id=? AND active=1',[sid,c.schoolId],tx))throw new s.UserError('Verified parent name and student are required.');
      await s.run('INSERT OR IGNORE INTO parents(school_id,name,wa_id) VALUES(?,?,?)',[c.schoolId,name,request.wa_id],tx);
      const p=await s.one('SELECT id FROM parents WHERE school_id=? AND wa_id=?',[c.schoolId,request.wa_id],tx);await s.run('INSERT OR IGNORE INTO parent_student(school_id,parent_id,student_id) VALUES(?,?,?)',[c.schoolId,p.id,sid],tx);
    } else if(req.body.decision!=='reject')throw new s.UserError('Invalid decision.');
    await s.run("UPDATE link_requests SET status=?,resolved_at=datetime('now'),resolved_by=? WHERE id=? AND school_id=?",[req.body.decision==='approve'?'approved':'rejected',c.user.staff_id,request.id,c.schoolId],tx);return {requestId:Number(request.id)};
  });redirect(res,c,'links');
}));
router.get('/audit',wrap(async(req,res)=>{
  const c=req.panel,list=await s.rows('SELECT actor,action,details,created_at FROM audit_log WHERE school_id=? ORDER BY id DESC LIMIT 300',[c.schoolId]);res.send(ui.layout(c,'Audit log',ui.card('Recent changes',ui.table(['When','Actor','Action','Details'],list.map(a=>[a.created_at,a.actor,a.action,a.details])))));
}));
router.get('/schools',wrap(async(req,res)=>{
  const c=req.panel;if(c.user.role!=='superadmin')throw new s.UserError('Superadmin access required.',403);
  const schools=await s.rows('SELECT * FROM schools ORDER BY name');
  const f=school=>{const flags=s.json(school?.features),options=s.json(school?.settings);return ui.form(c,'schools',ui.hidden('existingId',school?.id||'')+ui.field('School ID (stable slug)','id',school?.id||'','text','required pattern="[a-zA-Z0-9_-]{1,60}"'+(school?' readonly':''))+ui.field('School name','name',school?.name||'','text','required maxlength="120"')+ui.field('WhatsApp phone-number ID','phone_number_id',school?.phone_number_id||'','text','pattern="[0-9]{5,40}"')+ui.select('School status','active',activeOptions,school?.active??1,null)+ui.field('Daily AI allowance','ai_daily_budget',options.ai_daily_budget??200,'number','min="0" max="1000"')+`<div class="wide"><h3>Service access</h3>${s.FEATURES.map(feature=>ui.check(labels[feature],'feature_'+feature,flags[feature]!==false)).join('')}</div>`,'Save school & access');};
  res.send(ui.layout(c,'Schools & services',ui.note('Add schools, map senders and control service entitlements here without editing code. Meta sender registration, token access and template approval must still be configured in Meta.')+ui.card('Add school',f())+schools.map(school=>ui.card(school.name,ui.link({...c,schoolId:school.id},'','Open school')+detail('Edit school and service access',f(school)))).join('')));
}));
router.post('/schools',wrap(async(req,res)=>{
  const c=req.panel;if(c.user.role!=='superadmin')throw new s.UserError('Superadmin access required.',403);
  const body=req.body,schoolId=s.text(body.id,60),name=s.text(body.name,120),phoneId=s.text(body.phone_number_id,40)||null,budget=Number(body.ai_daily_budget);
  if(!/^[a-zA-Z0-9_-]{1,60}$/.test(schoolId)||!name||phoneId&&!/^\d{5,40}$/.test(phoneId)||!Number.isInteger(budget)||budget<0||budget>1000)throw new s.UserError('Invalid school, sender ID or daily allowance.');
  const flags=Object.fromEntries(s.FEATURES.map(f=>[f,!!body['feature_'+f]]));const tx=await db.transaction('write');
  try {
    const old=await s.one('SELECT * FROM schools WHERE id=?',[schoolId],tx);
    if(body.existingId) {if(body.existingId!==schoolId||!old)throw new s.UserError('School unavailable.');const options={...s.json(old.settings),ai_daily_budget:budget};await s.run('UPDATE schools SET name=?,phone_number_id=?,active=?,features=?,settings=?,config_version=config_version+1 WHERE id=?',[name,phoneId,body.active==='0'?0:1,JSON.stringify(flags),JSON.stringify(options),schoolId],tx);}
    else {if(old)throw new s.UserError('School ID already exists.');await s.run('INSERT INTO schools(id,name,phone_number_id,active,features,settings) VALUES(?,?,?,?,?,?)',[schoolId,name,phoneId,body.active==='0'?0:1,JSON.stringify(flags),JSON.stringify({ai_daily_budget:budget})],tx);}
    if(body.active==='0')await s.run('DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff_users WHERE school_id=?)',[schoolId],tx);
    await s.run('INSERT INTO audit_log(school_id,actor,action,details) VALUES(?,?,?,?)',[schoolId,String(c.user.staff_id),'school_services_updated',JSON.stringify({features:flags,active:body.active!=='0'})],tx);await tx.commit();
  }catch(e){await tx.rollback();throw e;}finally{tx.close();}
  redirect(res,c,'schools','School saved. Use “Open school” to add admins and classes.');
}));
router.get('/keys',wrap(async(req,res)=>{
  const c=req.panel;if(c.user.role!=='superadmin')throw new s.UserError('Superadmin access required.',403);
  const list=await s.rows('SELECT id,label,provider,model,key,project,active,vision FROM ai_keys ORDER BY id DESC'),status=keys.poolStatus();
  const f=ui.form(c,'keys',ui.field('Label','label')+ui.field('API key','key','','password','required autocomplete="off"')+ui.select('Provider','provider',[['auto','Auto-detect'],['gemini','Gemini'],['groq','Groq'],['openrouter','OpenRouter'],['nim','NVIDIA NIM'],['openai','OpenAI'],['custom','Custom OpenAI-compatible']],'auto',null)+ui.field('Model (blank = default)','model')+ui.field('Project / quota group','project')+ui.field('Custom HTTPS base URL (optional)','baseUrl'),'Test and add key');
  res.send(ui.layout(c,'AI keys',ui.note('Global provider pool. Keys are masked in the panel. Same-project keys share quotas. Pricing and provider privacy terms must be checked; a free model is not a promise of zero cost.')+ui.card('Add provider key',f)+ui.card('Database keys',ui.table(['Label','Provider / model','Key','Status','Vision','Action'],list.map(k=>{
    const live=status.find(x=>x.dbId===Number(k.id));return [k.label,k.provider+' / '+k.model,keys.maskKey(k.key),k.active?(live?.state||'active'):'disabled',k.vision?'Allowed':'Text only',ui.raw(ui.form(c,'keys/'+k.id,ui.select('Action','operation',[['test','Test key'],['toggle',k.active?'Disable':'Enable'],['vision',k.vision?'Disable vision':'Enable vision (verified model)'],['delete','Delete stored key']],'test',null),'Apply'))];
  })))+ui.card('Live pool health',ui.table(['Label','Source','Provider','State','Calls','Last success','Last failure'],status.map(k=>[k.label,k.source,k.provider,k.state,k.calls,k.lastOkAt?new Date(k.lastOkAt).toISOString():'—',k.lastError||'—'])))));
}));
router.post('/keys',wrap(async(req,res)=>{
  const c=req.panel;if(c.user.role!=='superadmin')throw new s.UserError('Superadmin access required.',403);
  const key=String(req.body.key||'').trim(),detected=keys.detectKeyProvider(key),provider=req.body.provider==='auto'?detected?.provider:req.body.provider;
  if(!provider||key.length>500)throw new s.UserError('Choose a provider and enter a valid key.');
  const values={key,provider,label:s.text(req.body.label,80),model:s.text(req.body.model,160)||keys.DEFAULT_MODELS[provider],project:s.text(req.body.project,100),baseUrl:s.text(req.body.baseUrl,300)};
  if(!values.model)throw new s.UserError('Enter a model name for this provider.');
  const probe=await keys.testKeyConfig(values);if(!probe.ok&&probe.status!==429)throw new s.UserError(probe.error);
  const id=await keys.addDbKey(values);await audit(c.schoolId,c.user.staff_id,'ai_key_added','keyId='+id);redirect(res,c,'keys',probe.ok?'Key tested and added.':'Key added in cooldown after a rate-limit response.');
}));
router.post('/keys/:id',wrap(async(req,res)=>{
  const c=req.panel;if(c.user.role!=='superadmin')throw new s.UserError('Superadmin access required.',403);const id=s.id(req.params.id),k=await s.one('SELECT * FROM ai_keys WHERE id=?',[id]);if(!k)throw new s.UserError('Key unavailable.');
  const op=req.body.operation;let message='Key updated.';
  if(op==='delete')await keys.deleteDbKey(id);
  else if(op==='toggle')await keys.setDbKeyEnabled(id,!k.active);
  else if(op==='vision'){await s.run('UPDATE ai_keys SET vision=? WHERE id=?',[k.vision?0:1,id]);await keys.setDbKeyEnabled(id,!!k.active);message='Vision capability updated. Enable only for a model verified to accept images.';}
  else if(op==='test'){const result=await keys.testKeyConfig({...k,baseUrl:k.base_url});message=result.ok?'Key test passed.':result.error;}
  else throw new s.UserError('Invalid key action.');
  await audit(c.schoolId,c.user.staff_id,'ai_key_'+op,'keyId='+id);redirect(res,c,'keys',message);
}));
router.use((err,req,res,next)=>{
  if(res.headersSent)return next(err);
  const status=err instanceof s.UserError?err.status:err.code==='LIMIT_FILE_SIZE'?413:400;
  const message=err instanceof s.UserError?err.message:err.code==='LIMIT_FILE_SIZE'?'File is too large. Maximum import size is 2 MB; date sheets 1 MB.':/unique constraint|duplicate/i.test(String(err.message))?'A record with this number or name already exists.':/Invalid school relationship/.test(String(err.message))?'Invalid school relationship or duplicate roll number.':'The change could not be completed. Check the form and try again.';
  const c=req.panel||{user:req.user,csrf:req.csrfToken,schoolId:'',path:''};res.status(status).send(ui.layout(c,'Action not completed',ui.card('Review the form',ui.note(message)+ui.link(c,'','Return to overview'))));
});
