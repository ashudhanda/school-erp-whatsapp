// Staff-facing mutations behind the admin panel — classes/sections, teachers,
// students, admins, settings, date sheets. Two layers guard every save:
//   1. assertAdmin(): the caller must be admin/superadmin and (unless
//      superadmin) belong to the same school as the record being touched.
//   2. write(): every mutation runs inside a transaction tagged with the
//      acting staff id and an audit token, so every change is attributable.
// Self-safety rules live here too: an admin cannot disable their own account,
// and the last active admin of a school cannot be disabled. Phone numbers go
// through normalizeWaId() + the 7-15 digit E.164 check; admin passwords must
// be 12+ chars and are scrypt-hashed (see panel/password.js) — a password
// change or deactivation wipes that admin's panel sessions. Section updates
// can never move a section to a different class; students with a pending leave
// request cannot be transferred to another section.
import { normalizeWaId } from './db.js';
import { UserError, FEATURES, PERMISSIONS, MENU_FIELDS, one, rows, run, schoolConfig, write, text, day, id, roll } from './services.js';
import { hashPassword } from './panel/password.js';
import { sniff, MEDIA_LIMIT } from './media.js';
export function assertAdmin(user,schoolId) {if(!user||!['admin','superadmin'].includes(user.role)||(user.role!=='superadmin'&&user.school_id!==schoolId))throw new UserError('School admin permission is required.',403);}
export function phone(value,optional=false) {const n=normalizeWaId(value);if(optional&&!n)return '';if(!/^\d{7,15}$/.test(n))throw new UserError('Enter a valid phone number including country code.');return n;}
export async function saveStructure(schoolId,user,body,token) {
  assertAdmin(user,schoolId);
  return write(schoolId,user.staff_id,token,'structure_update',async tx=>{
    const name=text(body.name,60);if(!name)throw new UserError('A name is required.');
    if(body.kind==='class') {
      if(body.id) {const result=await run('UPDATE classes SET name=?,active=? WHERE school_id=? AND id=?',[name,body.active==='0'?0:1,schoolId,id(body.id)],tx);if(!result.rowsAffected)throw new UserError('Class unavailable.',403);return {id:id(body.id)};}
      const result=await run('INSERT INTO classes(school_id,name) VALUES(?,?)',[schoolId,name],tx);return {id:Number(result.lastInsertRowid)};
    }
    const cls=await one('SELECT id FROM classes WHERE school_id=? AND id=? AND active=1',[schoolId,id(body.class_id)],tx);if(!cls)throw new UserError('Class unavailable.',403);
    const teacherId=body.class_teacher_id?id(body.class_teacher_id):null;
    if(teacherId&&!await one('SELECT id FROM teachers WHERE school_id=? AND id=? AND active=1',[schoolId,teacherId],tx))throw new UserError('Teacher unavailable.',403);
    if(body.id) {const old=await one('SELECT class_id FROM sections WHERE school_id=? AND id=?',[schoolId,id(body.id)],tx);if(!old||Number(old.class_id)!==Number(cls.id))throw new UserError('A section cannot be moved to a different class.',403);await run('UPDATE sections SET name=?,class_teacher_id=?,active=? WHERE school_id=? AND id=?',[name,teacherId,body.active==='0'?0:1,schoolId,id(body.id)],tx);return {id:id(body.id)};}
    return {id:Number((await run('INSERT INTO sections(school_id,class_id,name,class_teacher_id) VALUES(?,?,?,?)',[schoolId,cls.id,name,teacherId],tx)).lastInsertRowid)};
  });
}
export async function saveTeacher(schoolId,user,body,token) {
  assertAdmin(user,schoolId);
  return write(schoolId,user.staff_id,token,'teacher_update',async tx=>{
    if(body.operation==='assignment_delete') {await run('DELETE FROM teacher_assignments WHERE school_id=? AND id=?',[schoolId,id(body.id)],tx);return {assignmentId:id(body.id)};}
    if(body.operation==='assign') {
      const tid=id(body.teacher_id),sid=id(body.section_id),subject=text(body.subject,80);if(!subject)throw new UserError('A subject is required.');
      if(!await one('SELECT id FROM teachers WHERE school_id=? AND id=? AND active=1',[schoolId,tid],tx)||!await one('SELECT id FROM sections WHERE school_id=? AND id=? AND active=1',[schoolId,sid],tx))throw new UserError('Invalid assignment.',403);
      await run('INSERT OR IGNORE INTO teacher_assignments(school_id,teacher_id,section_id,subject) VALUES(?,?,?,?)',[schoolId,tid,sid,subject],tx);return {teacherId:tid,sectionId:sid};
    }
    const name=text(body.name,80),wa=phone(body.wa_id);if(!name)throw new UserError('Teacher name is required.');
    const permissions=PERMISSIONS.map(p=>body['can_'+p]&&body['can_'+p]!=='0'?1:0);
    if(body.id) {const result=await run('UPDATE teachers SET name=?,wa_id=?,active=?,can_attendance=?,can_marks=?,can_marks_edit=?,can_homework=?,can_tests=? WHERE id=? AND school_id=?',[name,wa,body.active==='0'?0:1,...permissions,id(body.id),schoolId],tx);if(!result.rowsAffected)throw new UserError('Teacher unavailable.',403);return {id:id(body.id)};}
    return {id:Number((await run('INSERT INTO teachers(school_id,name,wa_id,can_attendance,can_marks,can_marks_edit,can_homework,can_tests) VALUES(?,?,?,?,?,?,?,?)',[schoolId,name,wa,...permissions],tx)).lastInsertRowid)};
  });
}
export async function saveStudent(schoolId,user,body,token) {
  assertAdmin(user,schoolId);
  return write(schoolId,user.staff_id,token,'student_update',tx=>saveStudentRow(schoolId,body,tx));
}
export async function saveStudentRow(schoolId,body,tx) {
  const name=text(body.name,100),admission=text(body.admission_no,60),sid=id(body.section_id),rollNo=roll(body.roll_no);
  const fees=Number(body.fees_due||0);if(!Number.isFinite(fees)||fees<0||fees>100000000)throw new UserError('Invalid fee amount.');
  if(!name||!admission)throw new UserError('Name and admission number are required.');
  const section=await one('SELECT s.* FROM sections s JOIN classes c ON c.id=s.class_id AND c.school_id=s.school_id WHERE s.id=? AND s.school_id=? AND s.active=1 AND c.active=1',[sid,schoolId],tx);
  if(!section)throw new UserError('Class-section unavailable.',403);
  let studentId;
  if(body.id) {
    studentId=id(body.id);const old=await one('SELECT * FROM students WHERE school_id=? AND id=?',[schoolId,studentId],tx);if(!old)throw new UserError('Student unavailable.',403);
    if(Number(old.section_id)!==sid) {
      const hasPending=await one("SELECT id FROM leaves WHERE school_id=? AND student_id=? AND status='pending'",[schoolId,studentId],tx);if(hasPending)throw new UserError('Resolve pending leave requests before transferring this student.');
    }
    await run('UPDATE students SET name=?,admission_no=?,class_id=?,section_id=?,roll_no=?,fees_due=?,active=? WHERE id=? AND school_id=?',[name,admission,section.class_id,sid,rollNo,fees,body.active==='0'?0:1,studentId,schoolId],tx);
  } else studentId=Number((await run('INSERT INTO students(school_id,name,admission_no,class_id,section_id,roll_no,fees_due) VALUES(?,?,?,?,?,?,?)',[schoolId,name,admission,section.class_id,sid,rollNo,fees],tx)).lastInsertRowid);
  if(body.parent_phone) {
    const wa=phone(body.parent_phone),parentName=text(body.parent_name,100)||'Parent';
    await run('INSERT INTO parents(school_id,name,wa_id) VALUES(?,?,?) ON CONFLICT(school_id,wa_id) DO NOTHING',[schoolId,parentName,wa],tx);
    const p=await one('SELECT id FROM parents WHERE school_id=? AND wa_id=?',[schoolId,wa],tx);
    await run('INSERT OR IGNORE INTO parent_student(school_id,parent_id,student_id) VALUES(?,?,?)',[schoolId,p.id,studentId],tx);
  }
  return {id:studentId};
}
export async function saveAdmin(schoolId,user,body,token) {
  assertAdmin(user,schoolId);
  return write(schoolId,user.staff_id,token,'admin_update',async tx=>{
    const name=text(body.name,100),email=text(body.email,160).toLowerCase(),wa=phone(body.wa_id,true);
    if(!name||!/^\S+@\S+\.\S+$/.test(email))throw new UserError('Name and valid email are required.');
    const password=String(body.password||'');if(password&&password.length<12)throw new UserError('Use a password of at least 12 characters.');
    if(body.id) {
      const current=await one('SELECT * FROM staff_users WHERE id=? AND school_id=? AND role=\'admin\'',[id(body.id),schoolId],tx);if(!current)throw new UserError('Admin unavailable.',403);
      if(Number(current.id)===Number(user.staff_id)&&body.active==='0')throw new UserError('You cannot disable your own account.');
      if(body.active==='0') {const n=await one("SELECT count(*) AS n FROM staff_users WHERE school_id=? AND active=1 AND role='admin'",[schoolId],tx);if(Number(n.n)<2&&current.active)throw new UserError('Keep at least one active school admin.');}
      await run('UPDATE staff_users SET name=?,email=?,wa_id=?,active=?,password_hash=? WHERE id=? AND school_id=?',[name,email,wa,body.active==='0'?0:1,password?hashPassword(password):current.password_hash,current.id,schoolId],tx);
      if(password||body.active==='0')await run('DELETE FROM sessions WHERE staff_id=?',[current.id],tx);return {id:Number(current.id)};
    }
    if(password.length<12)throw new UserError('Use a password of at least 12 characters.');
    return {id:Number((await run("INSERT INTO staff_users(school_id,name,email,wa_id,password_hash,role) VALUES(?,?,?,?,?,'admin')",[schoolId,name,email,wa,hashPassword(password)],tx)).lastInsertRowid)};
  });
}
export async function saveSettings(schoolId,user,body,token) {
  assertAdmin(user,schoolId);
  return write(schoolId,user.staff_id,token,'school_settings',async tx=>{
    const school=await schoolConfig(schoolId,tx),options={...school.options};
    if(body.tab==='menu') {
      const enabled=[],fields={};
      for(const [module,sub] of Object.entries(MENU_FIELDS)) {
        if(body['menu_'+module])enabled.push(module);
        fields[module]=sub.filter(f=>!!body['field_'+module+'_'+f]);
      }
      await run('UPDATE schools SET menu_config=?,config_version=config_version+1 WHERE id=?',[JSON.stringify({rows:enabled,fields}),schoolId],tx);
    } else if(body.tab==='notifications') {
      options.templates={};
      for(const kind of ['attendance_absent','attendance_present','attendance_leave','leave_request','leave_result']) {
        const name=text(body['template_'+kind],100),language=text(body['language_'+kind],20)||'en';
        if(name&&!/^[a-z0-9_]+$/.test(name))throw new UserError('Template names must use lowercase letters, digits and underscores.');
        if(!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language))throw new UserError('Invalid template language code.');
        options.templates[kind]={name,language,approved:!!body['approved_'+kind]};
      }
      options.vision_allowed=!!body.vision_allowed;
      await run('UPDATE schools SET settings=?,present_notify=?,config_version=config_version+1 WHERE id=?',[JSON.stringify(options),body.present_notify?1:0,schoolId],tx);
    } else {
      await run('UPDATE schools SET name=?,office_phone=?,timings=?,holidays=?,notices=?,kb=?,config_version=config_version+1 WHERE id=?',[text(body.name,120)||school.name,phone(body.office_phone,true),text(body.timings,2000),text(body.holidays,4000),text(body.notices,4000),text(body.kb,16000),schoolId],tx);
    }
    return {schoolId,tab:body.tab||'profile'};
  });
}
export async function saveDateSheet(schoolId,user,doc,token) {
  assertAdmin(user,schoolId);
  return write(schoolId,user.staff_id,token,'datesheet_upload',async tx=>{
    const school=await schoolConfig(schoolId,tx);if(!school.flags.datesheet)throw new UserError('Date sheets are disabled.',403);
    if(doc.deleteId) {await run('UPDATE date_sheets SET active=0 WHERE school_id=? AND id=?',[schoolId,id(doc.deleteId)],tx);return {id:id(doc.deleteId),removed:true};}
    const sectionId=doc.section_id?id(doc.section_id):null;
    if(sectionId&&!await one('SELECT id FROM sections WHERE school_id=? AND id=?',[schoolId,sectionId],tx))throw new UserError('Section unavailable.',403);
    const content=text(doc.content,20000),title=text(doc.title,100)||'Date sheet';let buffer=null,mime='text/plain',name='';
    if(doc.kind!=='text') {buffer=doc.buffer||Buffer.from(doc.base64||'','base64');if(buffer.length>MEDIA_LIMIT)throw new UserError('Maximum file size is 1 MB.');mime=sniff(buffer);name=text(doc.name,100).replace(/[^\w .-]/g,'_')||'date-sheet';}
    else if(!content)throw new UserError('Date sheet content is required.');
    return {id:Number((await run('INSERT INTO date_sheets(school_id,section_id,kind,title,content,pdf,pdf_name,mime_type) VALUES(?,?,?,?,?,?,?,?)',[schoolId,sectionId,buffer?'file':'text',title,content,buffer,name,mime],tx)).lastInsertRowid)};
  });
}
