import test from 'node:test';
import assert from 'node:assert/strict';
import {db,initDb,todayIST} from '../src/db.js';
import * as s from '../src/services.js';
import {setFlow,getFlow,advanceFlow,applyBack,actionId,readAction} from '../src/flows.js';
import {resolveIdentity} from '../src/identity.js';
import {createSession} from '../src/panel/auth.js';
import {parseCsv,guessMapping,stageImport,commitImport,validateImport} from '../src/imports.js';
import {saveStructure,saveStudent,saveTeacher,saveSettings} from '../src/schoolAdmin.js';
import {signatureValid,ingest,notificationFor,deliver} from '../src/jobs.js';
import {setTestTransport} from '../src/whatsapp.js';
import {handleMessage} from '../src/bot.js';
import crypto from 'node:crypto';
let serial=0;
await initDb();await initDb();
async function fixture() {
  const school='school-'+(++serial),other=school+'-other',wa='91990000'+String(serial).padStart(4,'0'),parent='91880000'+String(serial).padStart(4,'0');
  await s.run('INSERT INTO schools(id,name,phone_number_id) VALUES(?,?,?)',[school,'Example School',String(100000+serial)]);
  await s.run('INSERT INTO schools(id,name) VALUES(?,?)',[other,'Other School']);
  const teacher=Number((await s.run('INSERT INTO teachers(school_id,name,wa_id,can_marks_edit) VALUES(?,?,?,1)',[school,'Teacher',wa])).lastInsertRowid);
  const cls=Number((await s.run('INSERT INTO classes(school_id,name) VALUES(?,?)',[school,'VI'])).lastInsertRowid);
  const sec=Number((await s.run('INSERT INTO sections(school_id,class_id,name,class_teacher_id) VALUES(?,?,?,?)',[school,cls,'Lotus',teacher])).lastInsertRowid);
  await s.run('INSERT INTO teacher_assignments(school_id,teacher_id,section_id,subject) VALUES(?,?,?,?)',[school,teacher,sec,'Maths']);
  const kids=[];for(let i=1;i<=3;i++)kids.push(Number((await s.run('INSERT INTO students(school_id,name,admission_no,class_id,section_id,roll_no) VALUES(?,?,?,?,?,?)',[school,'Student '+i,'ADM'+i,cls,sec,String(i)])).lastInsertRowid));
  const p=Number((await s.run('INSERT INTO parents(school_id,name,wa_id,confirmed) VALUES(?,?,?,1)',[school,'Parent',parent])).lastInsertRowid);
  await s.run('INSERT INTO parent_student(school_id,parent_id,student_id) VALUES(?,?,?)',[school,p,kids[0]]);
  const admin=Number((await s.run("INSERT INTO staff_users(school_id,name,email,password_hash,role) VALUES(?,?,?,?,'admin')",[school,'Admin',school+'@example.test','none'])).lastInsertRowid);
  return {school,other,wa,parent,teacher,cls,sec,kids,p,user:{staff_id:admin,role:'admin',school_id:school},phone:String(100000+serial)};
}

test('Persisted flow preserves complete JSON, expires and rejects stale buttons',async()=>{
  const f=await fixture();const st=await setFlow(f.school,f.wa,'marks','data',{text:'a'.repeat(9000)});assert.equal((await getFlow(f.school,f.wa)).data.text.length,9000);
  const next=await advanceFlow(f.school,f.wa,'marks','preview',{value:2});assert.equal(readAction(next,actionId(st,'confirm')),null);
  const previous=await applyBack(f.school,f.wa,'marks',next.data);assert.equal(previous.step,'data');assert.equal(previous.data.text.length,9000);
  await assert.rejects(setFlow(f.school,f.wa,'marks','data',{text:'b'.repeat(250000)}),/too large/);
  await s.run("UPDATE flow_sessions SET expires_at=datetime('now','-1 second') WHERE school_id=?",[f.school]);assert.equal(await getFlow(f.school,f.wa),null);
});
test('Tenant constraints reject foreign class, parent links, and teacher assignments',async()=>{
  const f=await fixture(),foreign=Number((await s.run('INSERT INTO classes(school_id,name) VALUES(?,?)',[f.other,'VII'])).lastInsertRowid);
  await assert.rejects(s.run('UPDATE students SET class_id=? WHERE id=?',[foreign,f.kids[0]]),/Invalid school/);
  const parent=Number((await s.run('INSERT INTO parents(school_id,name,wa_id) VALUES(?,?,?)',[f.other,'Private','917777777777'])).lastInsertRowid);
  await assert.rejects(s.run('INSERT INTO parent_student(school_id,parent_id,student_id) VALUES(?,?,?)',[f.school,parent,f.kids[0]]),/Invalid school/);
  await assert.rejects(s.teacherAccess(f.other,f.wa,'marks',f.sec,'Maths'),/permission|unavailable/);
});
test('Unconfirmed parent cannot resolve student names; teacher cannot create panel session',async()=>{
  const f=await fixture();await s.run('UPDATE parents SET confirmed=0 WHERE id=?',[f.p]);assert.deepEqual((await resolveIdentity(f.school,f.parent)).students,[]);
  assert.deepEqual(await s.actorStudents(f.school,f.parent),[]);
  const staff=Number((await s.run("INSERT INTO staff_users(school_id,name,email,password_hash,role) VALUES(?,?,?,?,'teacher')",[f.school,'Teacher','teacher'+serial+'@example.test','none'])).lastInsertRowid);
  await assert.rejects(createSession(staff),/restricted/);
});
test('Attendance parses mixed separators, supports both modes, rejects unknowns and is idempotent',async()=>{
  const f=await fixture();const draft=await s.attendanceDraft(f.school,f.wa,f.sec,'present','01,\n 3 3');
  assert.deepEqual(draft.entries.map(e=>e.status),['present','absent','present']);assert.equal((await s.one('SELECT COUNT(*) AS n FROM attendance WHERE school_id=?',[f.school])).n,0);
  await assert.rejects(s.attendanceDraft(f.school,f.wa,f.sec,'absent','4'),/Unknown/);
  const result=await s.saveAttendance(f.school,f.wa,draft,'attendancetoken1');assert.equal(result.present,2);await s.saveAttendance(f.school,f.wa,draft,'attendancetoken1');assert.equal((await s.one('SELECT COUNT(*) AS n FROM attendance WHERE school_id=?',[f.school])).n,3);
  const second=await s.attendanceDraft(f.school,f.wa,f.sec,'absent','NONE');assert.ok(second.entries.every(e=>e.status==='present'));
  await s.run('UPDATE teachers SET can_attendance=0 WHERE id=?',[f.teacher]);await assert.rejects(s.saveAttendance(f.school,f.wa,second,'revokedattendance'),/permission/);
});
test('Changed roster blocks stale attendance confirmation',async()=>{
  const f=await fixture();const d=await s.attendanceDraft(f.school,f.wa,f.sec,'present','NONE');await s.run('UPDATE students SET name=? WHERE id=?',['Changed',f.kids[0]]);
  await assert.rejects(s.saveAttendance(f.school,f.wa,d,'roster_changed'),/changed/);
});
test('Leave requests reach only the class teacher, decisions notify linked parents and reject duplicates',async()=>{
  const f=await fixture(),draft=await s.leaveDraft(f.school,f.parent,f.kids[0],'sick','Fever',todayIST());const result=await s.saveLeave(f.school,f.parent,draft,'leave_token_1');
  const request=await s.one("SELECT * FROM outbox WHERE school_id=? AND kind='leave_request'",[f.school]);assert.equal(request.wa_id,f.wa);
  await assert.rejects(s.leaveForTeacher(f.school,'919111111111',result.id),/unavailable/);
  await s.decideLeave(f.school,f.wa,result.id,'approved','', 'leave_decision_1');
  const l=await s.one('SELECT status FROM leaves WHERE id=?',[result.id]);assert.equal(l.status,'approved');
  const attendance=await s.attendanceDraft(f.school,f.wa,f.sec,'present','1 2 3');assert.equal(attendance.entries[0].status,'leave');
  await assert.rejects(s.saveLeave(f.school,f.parent,draft,'leave_token_2'),/already exists/);
  await assert.rejects(s.decideLeave(f.school,f.wa,result.id,'rejected','', 'leave_decision_2'),/already been decided/);
});
test('Marks validation, corrections, history and permission revocation are enforced',async()=>{
  const f=await fixture(),meta={sectionId:f.sec,subject:'Maths',name:'Weekly test',total:50};
  for(const invalid of [[{roll_no:'1',marks:51}],[{roll_no:'1',marks:null}],[{roll_no:'1',marks:10,uncertain:true}],[{roll_no:'1',marks:10},{roll_no:'01',marks:12}],[{roll_no:'9',marks:12}]])await assert.rejects(s.marksDraft(f.school,f.wa,meta,invalid));
  const d=await s.marksDraft(f.school,f.wa,meta,s.parseMarks('1 40\n2, 30'));assert.equal(d.missing.length,1);
  const result=await s.saveMarks(f.school,f.wa,d,'marks_create_1');assert.equal((await s.teacherHistory(f.school,f.wa)).length,1);
  const correction=await s.marksDraft(f.school,f.wa,meta,s.parseMarks('roll 1 is 35 not 40'),result.examId);
  await s.run('UPDATE teachers SET can_marks_edit=0 WHERE id=?',[f.teacher]);await assert.rejects(s.saveMarks(f.school,f.wa,correction,'marks_edit_denied'),/permission/);
  await s.run('UPDATE teachers SET can_marks_edit=1 WHERE id=?',[f.teacher]);await s.saveMarks(f.school,f.wa,correction,'marks_edit_allowed');
  assert.equal((await s.one('SELECT marks FROM marks WHERE exam_id=? AND student_id=?',[result.examId,f.kids[0]])).marks,35);
});
test('CSV mapping is preview-only and commit is scoped, atomic and duplicate-safe',async()=>{
  const f=await fixture(),grid=parseCsv('Name,Admission No,Class,Section,Roll No,Parent Phone\r\n"New, Student",NEW,VI,Lotus,4,9876543210\r\n');
  const mapping=guessMapping(grid[0]),preview=await stageImport(f.school,f.user,grid,mapping,false);assert.equal(preview.errors.length,0);
  assert.equal((await s.one('SELECT COUNT(*) AS n FROM students WHERE school_id=?',[f.school])).n,3);
  const result=await commitImport(f.school,f.user,preview.job);assert.equal(result.imported,1);await commitImport(f.school,f.user,preview.job);assert.equal((await s.one('SELECT COUNT(*) AS n FROM students WHERE school_id=?',[f.school])).n,4);
  const invalid=[...grid,['Duplicate','NEW2','VI','Lotus','4','']];assert.ok((await validateImport(f.school,invalid,mapping,false)).errors.length);
  await assert.rejects(commitImport(f.other,{...f.user,school_id:f.other},preview.job),/expired|another admin/);
  assert.throws(()=>parseCsv('"unfinished'),/unclosed/);
});
test('Notification opt-out and 24-hour/template gates are checked at delivery',async()=>{
  const f=await fixture();await s.saveAttendance(f.school,f.wa,await s.attendanceDraft(f.school,f.wa,f.sec,'absent','1'),'notify_attendance');
  const job=await s.one("SELECT * FROM outbox WHERE school_id=? AND kind='attendance'",[f.school]);assert.ok((await notificationFor(job)).blocked);
  await s.run('INSERT INTO user_prefs(school_id,wa_id,last_inbound) VALUES(?,?,?)',[f.school,f.parent,Date.now()]);assert.ok((await notificationFor(job)).inWindow);
  await s.run('UPDATE parents SET opted_out=1 WHERE id=?',[f.p]);await assert.rejects(notificationFor(job),/opted out/);
  let sent=0;setTestTransport(async()=>{sent++;return {ok:true,id:'provider-test'};});await deliver(job);assert.equal(sent,0);assert.equal((await s.one('SELECT status FROM outbox WHERE id=?',[job.id])).status,'suppressed');
});
test('Webhook validates HMAC and deduplicates durable inbox records',async()=>{
  const f=await fixture(),body=Buffer.from('sample'),secret='test-secret',sig='sha256='+crypto.createHmac('sha256',secret).update(body).digest('hex');
  assert.ok(signatureValid(body,sig,secret));assert.equal(signatureValid(Buffer.from('changed'),sig,secret),false);assert.equal(signatureValid(body,sig,''),false);
  const payload={entry:[{changes:[{value:{metadata:{phone_number_id:f.phone},messages:[{id:'wamid.test',from:f.wa,type:'text',text:{body:'hello'}}]}}]}]};await ingest(payload);await ingest(payload);
  assert.equal((await s.one('SELECT count(*) AS n FROM inbox WHERE school_id=?',[f.school])).n,1);
});
test('Teacher conversation provides Back and rejects an old confirm button',async()=>{
  const f=await fixture(),sent=[];setTestTransport(async(_,payload)=>{sent.push(payload);return {ok:true,id:'test'};});
  const send=async(text,button)=>handleMessage(f.school,f.phone,{from:f.wa,type:button?'interactive':'text',text:{body:text||''},interactive:button?{button_reply:{id:button}}:undefined});
  await send('attendance');let st=await getFlow(f.school,f.wa);assert.equal(st.step,'class');assert.ok(sent.at(-1).interactive.action.buttons.some(b=>b.reply.id.endsWith(':back')));
  const tap=async value=>{const state=await getFlow(f.school,f.wa),index=state.data.screen.options.findIndex(o=>o.value===String(value));assert.ok(index>=0);return send('',actionId(state,'c:'+index));};
  await tap(f.cls);await tap(f.sec);await tap('present');await send('1 2');st=await getFlow(f.school,f.wa);assert.equal(st.step,'preview');const stale=actionId(st,'c:0');await send('back');await send('',stale);
  assert.equal((await s.one('SELECT count(*) AS n FROM attendance WHERE school_id=?',[f.school])).n,0);
});

test.after(()=>db.close());
