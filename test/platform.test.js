import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {db,initDb} from '../src/db.js';
import * as s from '../src/services.js';
import {createSession} from '../src/panel/auth.js';
import {createApp} from '../src/index.js';
import {readSpreadsheet} from '../src/imports.js';
import {hashPassword} from '../src/panel/password.js';
import {setTestTransport} from '../src/whatsapp.js';
import crypto from 'node:crypto';
await initDb();
const school='web-school';await s.run('INSERT INTO schools(id,name,phone_number_id) VALUES(?,?,?)',[school,'Web Test School','123456']);
const adminId=Number((await s.run("INSERT INTO staff_users(school_id,name,email,password_hash,role) VALUES(?,?,?,?,'admin')",[school,'Test Admin','admin@example.test',hashPassword('test-password-12')])).lastInsertRowid);
const superId=Number((await s.run("INSERT INTO staff_users(name,email,password_hash,role) VALUES(?,?,?,'superadmin')",['Super Admin','super@example.test',hashPassword('test-password-12')])).lastInsertRowid);
const session=await createSession(adminId),superSession=await createSession(superId);
const server=await new Promise(resolve=>{const x=createApp().listen(0,'127.0.0.1',()=>resolve(x));});const base='http://127.0.0.1:'+server.address().port;
const get=(path,admin=true)=>fetch(base+'/panel/'+path,{headers:admin?{cookie:'panel_session='+session.token}:{},redirect:'manual'});
const post=(path,body,useSuper=false)=>fetch(base+'/panel/'+path,{method:'POST',headers:{cookie:'panel_session='+(useSuper?superSession:session).token,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_csrf:(useSuper?superSession:session).csrf,_token:s.newToken(),school,...body}),redirect:'manual'});

test('All operational screens load with a real Express server',async()=>{
  for(const path of ['', 'structure','teachers','students','parents','import','attendance','homework','leaves','marks','datesheets','events','menu','settings','notifications','admins','links','audit']) {
    const res=await get(path);assert.equal(res.status,200,path+': '+await res.text());
  }
  assert.equal((await get('schools')).status,403);assert.equal((await get('keys')).status,403);
  for(const path of ['schools','keys'])assert.equal((await fetch(base+'/panel/'+path,{headers:{cookie:'panel_session='+superSession.token}})).status,200);
});
test('Unauthenticated access, teacher login, CSRF and cross-school mutations are denied',async()=>{
  assert.equal((await get('students',false)).status,302);
  const r=await fetch(base+'/panel/structure',{method:'POST',headers:{cookie:'panel_session='+session.token,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({name:'Attack',kind:'class'})});assert.equal(r.status,403);
  await s.run('INSERT INTO schools(id,name) VALUES(?,?)',['foreign-school','Other']);
  const cls=Number((await s.run('INSERT INTO classes(school_id,name) VALUES(?,?)',['foreign-school','PRIVATE'])).lastInsertRowid);
  assert.equal((await post('structure',{school:'foreign-school',kind:'class',id:cls,name:'Changed'})).status,403);
  assert.equal((await s.one('SELECT name FROM classes WHERE id=?',[cls])).name,'PRIVATE');
  const user=await s.run("INSERT INTO staff_users(school_id,name,email,password_hash,role) VALUES(?,?,?,?,'teacher')",[school,'Teacher','teacher@example.test',hashPassword('test-password-12')]);assert.ok(user.rowsAffected);
  const login=await fetch(base+'/panel/login'),cookie=login.headers.get('set-cookie').split(';')[0],html=await login.text(),csrf=html.match(/name="_login_csrf" value="([a-f0-9]+)"/)[1];
  const denied=await fetch(base+'/panel/login',{method:'POST',headers:{cookie,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_login_csrf:csrf,email:'teacher@example.test',password:'test-password-12'}),redirect:'manual'});assert.equal(denied.status,401);
});
test('Panel creates custom classes, teachers, sections, students and admins',async()=>{
  assert.equal((await post('structure',{kind:'class',name:'Sixth Rose',active:'1'})).status,302);
  const cls=await s.one('SELECT id FROM classes WHERE school_id=? AND name=?',[school,'Sixth Rose']);
  assert.equal((await post('teachers',{name:'Class Teacher',wa_id:'919876540001',can_attendance:'1',can_marks:'1',can_marks_edit:'1',can_homework:'1',can_tests:'1'})).status,302);
  const teacher=await s.one('SELECT id FROM teachers WHERE school_id=? AND wa_id=?',[school,'919876540001']);
  assert.equal((await post('structure',{kind:'section',class_id:cls.id,name:'Lotus',class_teacher_id:teacher.id})).status,302);
  const section=await s.one('SELECT id FROM sections WHERE school_id=? AND name=?',[school,'Lotus']);
  assert.equal((await post('teachers',{operation:'assign',teacher_id:teacher.id,section_id:section.id,subject:'English'})).status,302);
  assert.equal((await post('students',{name:'Test Student',admission_no:'TEST1',section_id:section.id,roll_no:'1',fees_due:'1500',parent_name:'Parent',parent_phone:'9876543210'})).status,302);
  assert.equal((await post('admins',{name:'Second Admin',email:'second@example.test',password:'another-safe-password',wa_id:'919876540002'})).status,302);
  const identity=await s.one('SELECT confirmed FROM parents WHERE school_id=? AND wa_id=?',[school,'919876543210']);assert.equal(Number(identity.confirmed),0);
});
test('Genuine XLSX parsing, worksheet selection and formula rejection',async()=>{
  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Class VI');sheet.addRow(['name','admission_no','class','section','roll_no']);sheet.addRow(['Student, Example','XLSX1','Sixth Rose','Lotus','2']);workbook.addWorksheet('Second').addRow(['Hello']);
  const bytes=Buffer.from(await workbook.xlsx.writeBuffer()),parsed=await readSpreadsheet(bytes,'students.xlsx');assert.equal(parsed.length,2);assert.equal(parsed[0].rows[1][0],'Student, Example');assert.equal(parsed[0].rows[1][4],'2');
  sheet.getCell('A2').value={formula:'1+1',result:2};await assert.rejects(readSpreadsheet(Buffer.from(await workbook.xlsx.writeBuffer()),'formula.xlsx'),/formulas/);
  await assert.rejects(readSpreadsheet(Buffer.from('not a spreadsheet'),'renamed.xlsx'));
});
test('Multipart import is mapped, previewed and committed without duplicate rows',async()=>{
  const form=new FormData();form.set('_csrf',session.csrf);form.set('_token',s.newToken());form.set('school',school);form.set('file',new Blob(['Name,Admission No,Class,Section,Roll No\nNew Student,CSV1,Sixth Rose,Lotus,3\n'],{type:'text/csv'}),'students.csv');
  const uploaded=await fetch(base+'/panel/import/upload',{method:'POST',headers:{cookie:'panel_session='+session.token},body:form,redirect:'manual'});assert.equal(uploaded.status,302);
  const loc=uploaded.headers.get('location');assert.ok(loc.includes('job='));const job=new URL(loc,base).searchParams.get('job');assert.equal((await get('import/map?job='+job)).status,200);
  const preview=await post('import/preview',{job,sheet:'0',map_name:'0',map_admission_no:'1',map_class:'2',map_section:'3',map_roll_no:'4',map_parent_name:'-1',map_parent_phone:'-1',map_fees_due:'-1'});assert.equal(preview.status,302);
  const stage=new URL(preview.headers.get('location'),base).searchParams.get('job');assert.equal((await get('import/preview?job='+stage)).status,200);
  assert.equal((await post('import/commit',{job:stage})).status,302);assert.equal((await post('import/commit',{job:stage})).status,302);
  assert.equal(Number((await s.one('SELECT count(*) AS n FROM students WHERE school_id=? AND admission_no=?',[school,'CSV1'])).n),1);
});
test('Date sheets persist behind authentication and support school-scoped text publishing',async()=>{
  assert.equal((await post('datesheets',{title:'Term exam',content:'Maths — 2026-12-01'})).status,302);assert.equal(Number((await s.one('SELECT count(*) AS n FROM date_sheets WHERE school_id=?',[school])).n),1);
  const form=new FormData();for(const [k,v]of Object.entries({_csrf:session.csrf,_token:s.newToken(),school,title:'PDF schedule'}))form.set(k,v);form.set('file',new Blob(['%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF'],{type:'application/pdf'}),'sheet.pdf');
  const res=await fetch(base+'/panel/datesheets',{method:'POST',headers:{cookie:'panel_session='+session.token},body:form,redirect:'manual'});assert.equal(res.status,302);
  const doc=await s.one("SELECT id FROM date_sheets WHERE school_id=? AND kind='file'",[school]);assert.equal((await get('datesheets/'+doc.id+'/file',false)).status,302);assert.equal((await get('datesheets/'+doc.id+'/file')).status,200);
});
test('Service revocation and parent sub-menu settings persist server-side',async()=>{
  assert.equal((await post('settings',{tab:'menu',menu_attendance:'1',field_attendance_today:'1'})).status,302);
  const cfg=await s.schoolConfig(school);assert.equal(s.menuAllowed(cfg,'attendance','today'),true);assert.equal(s.menuAllowed(cfg,'attendance','month'),false);assert.equal(s.menuAllowed(cfg,'marks'),false);
  const result=await post('schools',{existingId:school,id:school,name:'Web Test School',phone_number_id:'123456',active:'1',ai_daily_budget:'20',feature_marks:'1'},true);assert.equal(result.status,302);
  assert.equal((await get('attendance')).status,403);assert.equal((await get('marks')).status,200);
});
test('Webhook authentication, durable ACK and duplicate events work through HTTP',async()=>{
  setTestTransport(async()=>({ok:true,id:'test-delivery'}));
  const payload=JSON.stringify({entry:[{changes:[{value:{metadata:{phone_number_id:'123456'},messages:[{id:'integration-message',from:'919111111111',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'hello'}}]}}]}]});
  const send=sig=>fetch(base+'/webhook',{method:'POST',headers:{'Content-Type':'application/json','x-hub-signature-256':sig},body:payload});
  assert.equal((await send('bad')).status,403);const signature='sha256='+crypto.createHmac('sha256','integration-test-secret').update(payload).digest('hex');assert.equal((await send(signature)).status,200);assert.equal((await send(signature)).status,200);
  assert.equal(Number((await s.one('SELECT count(*) AS n FROM inbox WHERE message_id=?',['integration-message'])).n),1);
  await new Promise(resolve=>setTimeout(resolve,100));
});
test.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
