// Domain-services layer: permission checks (teacherAccess/childAccess), input validators
// (id/day/roll/rollInput), DB helpers (rows/one/run/json), and the transactional write() with
// idempotency tokens. Never throws plain Errors for user-facing failures — use UserError,
// whose status is surfaced to the user or suppressed by callers.
import crypto from 'node:crypto';
import { db, todayIST } from './db.js';

export const FEATURES = ['attendance','marks','fees','homework','datesheet','leave','notices','events','tests'];
export const PERMISSIONS = ['attendance','marks','marks_edit','homework','tests'];
export const MENU_FIELDS = {
  attendance:['today','month'], marks:['latest','history'], fees:['dues'], homework:['today'],
  datesheet:['official','tests'], leave:['apply','history'], notices:['current'], timings:['current'], holidays:['current'], admission:['info']
};
export class UserError extends Error { constructor(message,status=400) { super(message); this.status=status; } }
export const rows = async (sql,args=[],cx=db) => (await cx.execute({sql,args})).rows;
export const one = async (sql,args=[],cx=db) => (await rows(sql,args,cx))[0] || null;
export const run = (sql,args=[],cx=db) => cx.execute({sql,args});
export function json(value,fallback={}) { try { const v=JSON.parse(value||''); return v && typeof v==='object' && !Array.isArray(v) ? v : fallback; } catch { return fallback; } }
export const text=(value,max=200)=>String(value??'').trim().slice(0,max);
export function id(value) { const n=Number(value); if(!Number.isSafeInteger(n)||n<=0) throw new UserError('Invalid selection.'); return n; }
export function day(value) {
  const s=String(value||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s+'T00:00:00Z'))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s) throw new UserError('Use a valid date in YYYY-MM-DD format.');
  return s;
}
export const fingerprint=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function schoolConfig(schoolId,cx=db) {
  const s=await one('SELECT * FROM schools WHERE id=? AND active=1',[schoolId],cx);
  if(!s) throw new UserError('School is unavailable.',403);
  const flags=json(s.features); s.flags=Object.fromEntries(FEATURES.map(f=>[f,flags[f]!==false]));
  s.options=json(s.settings); s.menu=json(s.menu_config); return s;
}
export async function feature(schoolId,name,cx=db) {
  const s=await schoolConfig(schoolId,cx);
  if(!s.flags[name]) throw new UserError('This service is not enabled for your school.',403);
  return s;
}
export function menuAllowed(school,module,field) {
  const menu=school.menu;
  if(Array.isArray(menu.rows)&&!menu.rows.includes(module)) return false;
  const fields=menu.fields?.[module]; return !field || !Array.isArray(fields) || fields.includes(field);
}
export async function teacherAccess(schoolId,waId,permission,sectionId,subject=null,cx=db) {
  await feature(schoolId,permission==='marks_edit'?'marks':permission,cx);
  const teacher=await one('SELECT * FROM teachers WHERE school_id=? AND wa_id=? AND active=1',[schoolId,waId],cx);
  if(!teacher || !PERMISSIONS.includes(permission) || (!Number(teacher['can_'+permission]) || (permission==='marks_edit'&&!Number(teacher.can_marks)))) throw new UserError('Teacher permission is required.',403);
  if(sectionId) {
    const sec=await one(`SELECT s.* FROM sections s JOIN classes c ON c.id=s.class_id AND c.school_id=s.school_id
      WHERE s.id=? AND s.school_id=? AND s.active=1 AND c.active=1`,[id(sectionId),schoolId],cx);
    const assignment=await one('SELECT id FROM teacher_assignments WHERE school_id=? AND teacher_id=? AND section_id=?'+(subject!==null?' AND subject=?':''),[schoolId,teacher.id,sectionId,...(subject!==null?[subject]:[])],cx);
    if(!sec || (!assignment && !(permission==='attendance' && Number(sec.class_teacher_id)===Number(teacher.id)))) throw new UserError('This class or subject is not assigned to you.',403);
  }
  return teacher;
}
export async function actorStudents(schoolId,waId,role='parent',cx=db) {
  await schoolConfig(schoolId,cx);
  const fields=`s.*, c.name AS class_name, sec.name AS section_name`;
  if(role==='student') return rows(`SELECT ${fields} FROM student_accounts a JOIN students s ON s.id=a.student_id AND s.school_id=a.school_id AND s.active=1
    LEFT JOIN classes c ON c.id=s.class_id AND c.school_id=s.school_id LEFT JOIN sections sec ON sec.id=s.section_id AND sec.school_id=s.school_id
    WHERE a.school_id=? AND a.wa_id=? AND a.active=1 AND a.age_eligible=1 AND a.consent_verified=1`,[schoolId,waId],cx);
  return rows(`SELECT ${fields} FROM parents p JOIN parent_student ps ON ps.parent_id=p.id AND ps.school_id=p.school_id
    JOIN students s ON s.id=ps.student_id AND s.school_id=ps.school_id AND s.active=1
    LEFT JOIN classes c ON c.id=s.class_id AND c.school_id=s.school_id LEFT JOIN sections sec ON sec.id=s.section_id AND sec.school_id=s.school_id
    WHERE p.school_id=? AND p.wa_id=? AND p.confirmed=1`,[schoolId,waId],cx);
}
export async function childAccess(schoolId,waId,studentId,role='parent',cx=db) {
  const s=(await actorStudents(schoolId,waId,role,cx)).find(s=>Number(s.id)===Number(studentId));
  if(!s) throw new UserError('Student details are not available to this number.',403);
  return s;
}
export const classLabel=s=>[s.class_name,s.section_name].filter(Boolean).join(' ');
export async function roster(schoolId,sectionId,cx=db) {
  return rows(`SELECT id,name,roll_no FROM students WHERE school_id=? AND section_id=? AND active=1 ORDER BY CAST(roll_no AS INTEGER),roll_no,name`,[schoolId,id(sectionId)],cx);
}
export function roll(value) {
  const s=String(value??'').normalize('NFKC').replace(/[०-९]/g,c=>String(c.charCodeAt(0)-0x966)).trim();
  if(!/^[A-Za-z0-9_-]{1,24}$/.test(s)) throw new UserError('Invalid roll number: '+s.slice(0,24));
  return /^\d+$/.test(s) ? String(BigInt(s)) : s.toUpperCase();
}
export function rollInput(value) {
  const s=text(value,12000); if(/^(none|nil|कोई नहीं|koi nahi)$/i.test(s)) return [];
  if(!s) throw new UserError('Enter roll numbers, or NONE if the list is empty.');
  return [...new Set(s.split(/[\s,;]+/).filter(Boolean).map(roll))];
}
function rosterMap(list) {
  const map=new Map();
  for(const st of list) { if(!st.roll_no) throw new UserError('The school admin must assign roll numbers before this class can be used.'); const key=roll(st.roll_no); if(map.has(key)) throw new UserError('Duplicate roll numbers. Please contact the school admin.'); map.set(key,st); }
  if(!map.size) throw new UserError('No active students in this class.'); return map;
}
export async function write(schoolId,actor,token,action,fn) {
  if(!/^[a-zA-Z0-9:_-]{8,180}$/.test(String(token))) throw new UserError('Expired confirmation. Please start again.');
  const tx=await db.transaction('write');
  try {
    const existing=await one('SELECT result FROM write_receipts WHERE school_id=? AND token=?',[schoolId,token],tx);
    if(existing) { await tx.rollback(); return JSON.parse(existing.result); }
    await schoolConfig(schoolId,tx);
    const result=await fn(tx);
    await run('INSERT INTO audit_log(school_id,actor,action,details) VALUES(?,?,?,?)',[schoolId,String(actor),action,JSON.stringify(result).slice(0,500)],tx);
    await run('INSERT INTO write_receipts(school_id,token,result) VALUES(?,?,?)',[schoolId,token,JSON.stringify(result)],tx);
    await tx.commit(); return result;
  } catch(e) { await tx.rollback(); throw e; } finally { tx.close(); }
}
export const newToken=()=>crypto.randomBytes(16).toString('hex');
export async function queue(schoolId,waId,kind,referenceId,payload,dedupe,cx=db) {
  await run(`INSERT OR IGNORE INTO outbox(school_id,wa_id,kind,reference_id,payload,dedupe_key) VALUES(?,?,?,?,?,?)`,[schoolId,waId,kind,referenceId,JSON.stringify(payload),dedupe],cx);
}
export async function queueParents(schoolId,studentId,kind,payload,dedupe,cx=db) {
  const recipients=await rows(`SELECT p.wa_id FROM parents p JOIN parent_student ps ON ps.parent_id=p.id AND ps.school_id=p.school_id
    WHERE ps.school_id=? AND ps.student_id=? AND p.confirmed=1 AND p.opted_out=0`,[schoolId,studentId],cx);
  for(const p of recipients) await queue(schoolId,p.wa_id,kind,studentId,payload,dedupe+':'+p.wa_id,cx);
}
async function attendanceSnapshot(schoolId,sectionId,date,cx=db) {
  const list=await roster(schoolId,sectionId,cx); rosterMap(list);
  const leaves=await rows(`SELECT id,student_id,version FROM leaves WHERE school_id=? AND day=? AND status='approved'
    AND student_id IN(SELECT id FROM students WHERE school_id=? AND section_id=?) ORDER BY id`,[schoolId,date,schoolId,sectionId],cx);
  const saved=await rows('SELECT student_id,status,revision FROM attendance WHERE school_id=? AND day=? AND section_id=? ORDER BY student_id',[schoolId,date,sectionId],cx);
  return {list,leaves,saved,hash:fingerprint({list,leaves,saved})};
}
export async function attendanceDraft(schoolId,waId,sectionId,mode,input,date=todayIST(),cx=db) {
  await teacherAccess(schoolId,waId,'attendance',sectionId,null,cx); day(date);
  if(!['present','absent'].includes(mode)) throw new UserError('Choose Present or Absent.');
  const snap=await attendanceSnapshot(schoolId,sectionId,date,cx), map=rosterMap(snap.list), picked=rollInput(input);
  const unknown=picked.filter(k=>!map.has(k)); if(unknown.length) throw new UserError('Unknown roll numbers: '+unknown.join(', ')+'. Nothing was saved.');
  const leaveIds=new Set(snap.leaves.map(l=>Number(l.student_id))), selected=new Set(picked);
  const entries=snap.list.map(st=>({...st,status:leaveIds.has(Number(st.id))?'leave':selected.has(roll(st.roll_no))?mode:mode==='present'?'absent':'present'}));
  return {sectionId:Number(sectionId),day:date,mode,input:picked.length?picked.join(' '):'NONE',hash:snap.hash,entries};
}
export async function saveAttendance(schoolId,waId,draft,token) {
  return write(schoolId,waId,token,'attendance_mark',async tx=>{
    const teacher=await teacherAccess(schoolId,waId,'attendance',draft.sectionId,null,tx);
    if(draft.day!==todayIST()) throw new UserError('The date changed. Restart attendance for today.');
    const fresh=await attendanceDraft(schoolId,waId,draft.sectionId,draft.mode,draft.input,draft.day,tx);
    if(fresh.hash!==draft.hash) throw new UserError('The roster, leave list or attendance changed. Please review a fresh preview.');
    const settings=await schoolConfig(schoolId,tx);
    for(const st of fresh.entries) {
      const old=await one('SELECT * FROM attendance WHERE school_id=? AND student_id=? AND day=?',[schoolId,st.id,draft.day],tx);
      await run(`INSERT INTO attendance(school_id,day,section_id,student_id,status,marked_by) VALUES(?,?,?,?,?,?)
        ON CONFLICT(school_id,day,student_id) DO UPDATE SET status=excluded.status, marked_by=excluded.marked_by,
        section_id=excluded.section_id, updated_at=datetime('now'),revision=attendance.revision+1`,[schoolId,draft.day,draft.sectionId,st.id,st.status,teacher.id],tx);
      if(old?.status===st.status) continue;
      if(st.status==='absent'||(st.status==='present'&&Number(settings.present_notify))||st.status==='leave') {
        await queueParents(schoolId,st.id,'attendance',{day:draft.day,status:st.status},'attendance:'+draft.day+':'+st.id+':'+(Number(old?.revision||0)+1),tx);
      }
    }
    return {day:draft.day,sectionId:draft.sectionId,present:fresh.entries.filter(s=>s.status==='present').length,absent:fresh.entries.filter(s=>s.status==='absent').length,leave:fresh.entries.filter(s=>s.status==='leave').length};
  });
}
export async function leaveDraft(schoolId,waId,studentId,type,reason,date,role='parent') {
  await feature(schoolId,'leave'); const student=await childAccess(schoolId,waId,studentId,role); day(date);
  if(!student.section_id) throw new UserError('Ask the school admin to assign a class-section first.');
  if(!['sick','other'].includes(type)||!text(reason,1000)) throw new UserError('Choose a leave type and enter a reason.');
  return {studentId:Number(student.id),role,type,reason:text(reason,1000),day:date,name:student.name,section:classLabel(student)};
}
export async function saveLeave(schoolId,waId,draft,token) {
  return write(schoolId,waId,token,'leave_apply',async tx=>{
    const s=await feature(schoolId,'leave',tx); if(!menuAllowed(s,'leave','apply')) throw new UserError('Leave applications are disabled.',403);
    const st=await childAccess(schoolId,waId,draft.studentId,draft.role,tx); day(draft.day);
    if(!['sick','other'].includes(draft.type)||!text(draft.reason,1000)||!st.section_id) throw new UserError('Invalid leave application.');
    const duplicate=await one("SELECT id FROM leaves WHERE school_id=? AND student_id=? AND day=? AND status IN('pending','approved')",[schoolId,st.id,draft.day],tx);
    if(duplicate) throw new UserError('A leave request already exists for this date.');
    const result=await run('INSERT INTO leaves(school_id,student_id,section_id,day,type,title,reason,applied_by) VALUES(?,?,?,?,?,?,?,?)',[schoolId,st.id,st.section_id,draft.day,draft.type,text(draft.reason,80),text(draft.reason,1000),waId],tx);
    const leaveId=Number(result.lastInsertRowid);
    const teacher=await one('SELECT t.* FROM sections s JOIN teachers t ON t.id=s.class_teacher_id AND t.school_id=s.school_id AND t.active=1 WHERE s.id=? AND s.school_id=?',[st.section_id,schoolId],tx);
    if(teacher) await queue(schoolId,teacher.wa_id,'leave_request',leaveId,{leaveId},'leave:'+leaveId,tx);
    return {id:leaveId,status:'pending',teacherAssigned:!!teacher};
  });
}
export async function leaveForTeacher(schoolId,waId,leaveId,cx=db) {
  await feature(schoolId,'leave',cx);
  const l=await one(`SELECT l.*, s.name,s.roll_no,c.name AS class_name,sec.name AS section_name,t.id AS teacher_id FROM leaves l
    JOIN students s ON s.id=l.student_id AND s.school_id=l.school_id AND s.section_id=l.section_id AND s.active=1
    JOIN sections sec ON sec.id=l.section_id AND sec.school_id=l.school_id AND sec.active=1
    JOIN classes c ON c.id=sec.class_id AND c.school_id=sec.school_id
    JOIN teachers t ON t.id=sec.class_teacher_id AND t.school_id=l.school_id AND t.active=1
    WHERE l.id=? AND l.school_id=? AND t.wa_id=?`,[id(leaveId),schoolId,waId],cx);
  if(!l) throw new UserError('This leave request is unavailable to you.',403); return l;
}
export async function decideLeave(schoolId,waId,leaveId,status,note,token) {
  if(!['approved','rejected'].includes(status)) throw new UserError('Invalid leave decision.');
  return write(schoolId,waId,token,'leave_decision',async tx=>{
    const l=await leaveForTeacher(schoolId,waId,leaveId,tx);
    if(l.status!=='pending') throw new UserError('This request has already been decided.');
    await run("UPDATE leaves SET status=?,teacher_note=?,decided_by=?,decided_at=datetime('now'),version=version+1 WHERE school_id=? AND id=? AND status='pending'",[status,text(note,500),l.teacher_id,schoolId,l.id],tx);
    // Approval does not overwrite a teacher's already-recorded present observation.
    if(status==='approved') await run("UPDATE attendance SET status='leave',revision=revision+1,updated_at=datetime('now') WHERE school_id=? AND student_id=? AND day=? AND status='absent'",[schoolId,l.student_id,l.day],tx);
    await queueParents(schoolId,l.student_id,'leave_result',{leaveId:l.id},'leave-result:'+l.id,tx);
    const sa=await one('SELECT id FROM student_accounts WHERE school_id=? AND student_id=? AND wa_id=? AND active=1 AND age_eligible=1 AND consent_verified=1',[schoolId,l.student_id,l.applied_by],tx);
    if(sa) await queue(schoolId,l.applied_by,'leave_result',l.student_id,{leaveId:l.id},'leave-result:'+l.id+':'+l.applied_by,tx);
    return {id:Number(l.id),status};
  });
}
export function parseMarks(value) {
  const lines=text(value,20000).split(/\r?\n|;/).map(s=>s.trim()).filter(Boolean); if(!lines.length) throw new UserError('Enter one roll and mark per line.');
  return lines.map(line=>{
    const m=line.match(/^(?:roll\s*|रोल\s*)?([A-Za-z0-9_-]+)(?:\s+(?:is|ko|ke|के|का|है)\s+|\s*[:,=]\s*|\s+)(\d+(?:\.\d+)?)(?:\s+not\s+\d+(?:\.\d+)?)?\s*$/i);
    if(!m) throw new UserError('Cannot read: '+line.slice(0,60)+'. Use: roll marks, one per line.');
    return {roll_no:roll(m[1]),marks:Number(m[2])};
  });
}
export async function marksDraft(schoolId,waId,meta,entries,examId=null,cx=db) {
  const sectionId=id(meta.sectionId); await teacherAccess(schoolId,waId,examId?'marks_edit':'marks',sectionId,meta.subject,cx);
  const total=Number(meta.total); if(!Number.isFinite(total)||total<=0||total>10000||!text(meta.name,100)) throw new UserError('Test name and positive total marks are required.');
  const list=await roster(schoolId,sectionId,cx),map=rosterMap(list), seen=new Set();
  if(!Array.isArray(entries)||!entries.length||entries.length>1000) throw new UserError('No valid marks were supplied.');
  const checked=entries.map(e=>{
    let key; try {key=roll(e.roll_no);}catch {key=null;}
    if(!key||!map.has(key)) { const name=String(e.name||e.roll_no||'').trim().toLowerCase().replace(/\s+/g,' ');const matches=list.filter(st=>st.name.trim().toLowerCase().replace(/\s+/g,' ')===name);if(matches.length!==1)throw new UserError('Use a unique matching student name or a valid roll number.');key=roll(matches[0].roll_no); }
    if(seen.has(key)) throw new UserError('Duplicate roll: '+key); seen.add(key);
    const st=map.get(key); if(!st) throw new UserError('Unknown roll: '+key);
    if(e.uncertain||e.marks===null||e.marks===undefined||e.marks===''||!Number.isFinite(Number(e.marks))||Number(e.marks)<0||Number(e.marks)>total) throw new UserError('Check the mark for roll '+key+'. Nothing was saved.');
    if(e.name && text(e.name).toLowerCase().replace(/\s+/g,' ')!==text(st.name).toLowerCase().replace(/\s+/g,' ')) throw new UserError('Name does not match roll '+key+'. Verify the sheet or correct the text.');
    return {studentId:Number(st.id),roll_no:key,name:st.name,marks:Number(e.marks)};
  });
  let exam=null;
  if(examId) {
    exam=await one('SELECT * FROM marks_exams WHERE id=? AND school_id=?',[id(examId),schoolId],cx);
    const teacher=await teacherAccess(schoolId,waId,'marks_edit',sectionId,meta.subject,cx);
    if(!exam||Number(exam.uploaded_by)!==Number(teacher.id)||Number(exam.section_id)!==sectionId||exam.subject!==meta.subject) throw new UserError('This upload is not available for editing.',403);
  }
  return {sectionId,subject:text(meta.subject,80),name:text(meta.name,100),total,testDate:meta.testDate?day(meta.testDate):todayIST(),entries:checked,
    missing:list.filter(s=>!seen.has(roll(s.roll_no))).map(s=>({roll:s.roll_no,name:s.name})),rosterHash:fingerprint(list),examId:exam?Number(exam.id):null,revision:exam?Number(exam.revision):null};
}
export async function saveMarks(schoolId,waId,draft,token) {
  return write(schoolId,waId,token,draft.examId?'marks_edit':'marks_upload',async tx=>{
    const teacher=await teacherAccess(schoolId,waId,draft.examId?'marks_edit':'marks',draft.sectionId,draft.subject,tx);
    const fresh=await marksDraft(schoolId,waId,draft,draft.entries,draft.examId,tx);
    if(fresh.rosterHash!==draft.rosterHash||fresh.revision!==draft.revision) throw new UserError('The roster or marks changed. Please review again.');
    let examId=draft.examId;
    if(!examId) examId=Number((await run('INSERT INTO marks_exams(school_id,section_id,subject,name,total_marks,uploaded_by,test_date) VALUES(?,?,?,?,?,?,?)',[schoolId,draft.sectionId,draft.subject,draft.name,draft.total,teacher.id,draft.testDate],tx)).lastInsertRowid);
    for(const e of fresh.entries) {
      const old=await one('SELECT marks FROM marks WHERE school_id=? AND exam_id=? AND student_id=?',[schoolId,examId,e.studentId],tx);
      await run(`INSERT INTO marks(school_id,exam_id,student_id,marks) VALUES(?,?,?,?) ON CONFLICT(exam_id,student_id) DO UPDATE SET marks=excluded.marks,updated_at=datetime('now')`,[schoolId,examId,e.studentId,e.marks],tx);
      if(draft.examId&&Number(old?.marks)!==e.marks) await run('INSERT INTO audit_log(school_id,actor,action,details) VALUES(?,?,?,?)',[schoolId,waId,'mark_changed',JSON.stringify({examId,studentId:e.studentId,old:old?.marks??null,new:e.marks})],tx);
    }
    if(draft.examId) await run('UPDATE marks_exams SET revision=revision+1 WHERE id=? AND school_id=?',[examId,schoolId],tx);
    return {examId,count:fresh.entries.length,edited:!!draft.examId};
  });
}
export async function teacherHistory(schoolId,waId,offset=0) {
  const t=await teacherAccess(schoolId,waId,'marks');
  return rows(`SELECT e.*,c.name AS class_name,s.name AS section_name FROM marks_exams e JOIN sections s ON s.id=e.section_id AND s.school_id=e.school_id
    JOIN classes c ON c.id=s.class_id AND c.school_id=s.school_id WHERE e.school_id=? AND e.uploaded_by=?
    AND EXISTS(SELECT 1 FROM teacher_assignments a WHERE a.school_id=e.school_id AND a.teacher_id=e.uploaded_by AND a.section_id=e.section_id AND a.subject=e.subject)
    ORDER BY e.id DESC LIMIT 100 OFFSET ?`,[schoolId,t.id,Math.max(0,offset)]);
}
export async function examForTeacher(schoolId,waId,examId) {
  const e=await one('SELECT * FROM marks_exams WHERE school_id=? AND id=?',[schoolId,id(examId)]);
  if(!e) throw new UserError('Upload unavailable.',403);
  const t=await teacherAccess(schoolId,waId,'marks',e.section_id,e.subject);
  if(Number(t.id)!==Number(e.uploaded_by)) throw new UserError('Upload unavailable.',403);
  const marks=await rows('SELECT m.*,s.name,s.roll_no FROM marks m JOIN students s ON s.id=m.student_id AND s.school_id=m.school_id WHERE m.school_id=? AND m.exam_id=? ORDER BY CAST(s.roll_no AS INTEGER),s.roll_no',[schoolId,e.id]);
  return {...e,entries:marks,canEdit:!!t.can_marks_edit};
}
export async function saveHomework(schoolId,waId,draft,token) {
  return write(schoolId,waId,token,'homework_post',async tx=>{
    const teacher=await teacherAccess(schoolId,waId,'homework',draft.sectionId,draft.subject,tx);
    if(!text(draft.text,4000)) throw new UserError('Homework cannot be empty.');
    const r=await run('INSERT INTO homework(school_id,section_id,subject,teacher_id,text,day) VALUES(?,?,?,?,?,?)',[schoolId,draft.sectionId,draft.subject,teacher.id,text(draft.text,4000),todayIST()],tx);
    return {id:Number(r.lastInsertRowid)};
  });
}
export async function saveTest(schoolId,waId,draft,token) {
  return write(schoolId,waId,token,'test_announce',async tx=>{
    const teacher=await teacherAccess(schoolId,waId,'tests',draft.sectionId,draft.subject,tx); day(draft.date);
    if(draft.date<todayIST()||!text(draft.name,100)) throw new UserError('Enter a test name and a date from today onwards.');
    const r=await run('INSERT INTO tests(school_id,section_id,subject,name,test_date,created_by) VALUES(?,?,?,?,?,?)',[schoolId,draft.sectionId,draft.subject,text(draft.name,100),draft.date,teacher.id],tx);
    return {id:Number(r.lastInsertRowid)};
  });
}
