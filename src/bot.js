import { db, getUserLang, setUserLang, audit, normalizeWaId, todayIST } from './db.js';
import { resolveIdentity, confirmParent, denyParent, setOptOut, createLinkRequest, linkRateLimited, pullRateLimited } from './identity.js';
import { resolveTeacher, resolveStaffAdmin, teacherSections, subjectsFor } from './teachers.js';
import { getFlow, setFlow, clearFlow, applyBack, actionId, readAction } from './flows.js';
import { t, menuRows } from './i18n.js';
import { sendText, sendList, sendButtons, sendDocument, sendImage } from './whatsapp.js';
import * as s from './services.js';
import { downloadMedia, uploadMedia } from './media.js';
import { extractMarks } from './vision.js';

const L=(lang,en,hi,hg)=>lang==='hi'?hi:lang==='hg'?hg:en;
const entry=(value,label,description='')=>({value,label,description});
const byValue=(flow,value)=>flow.data.screen.options.find(o=>o.value===value);
const MAIN=new Set(['attendance','marks','fees','homework','datesheet','leave','notices','timings','holidays','admission']);
const flowPerm={attendance:'attendance',marks:'marks',history:'marks',homework:'homework',test:'tests'};
// Per-sender message serialization: WhatsApp can deliver several webhooks for the same
// user near-simultaneously, and overlapping flow steps would corrupt flow_sessions.
// Each (school,wa_id) pair gets a promise chain, so messages run one at a time in
// arrival order. A failed step must never block the queue (previous.catch(()=>{})),
// and the map entry is deleted only by the chain it created.
const locks=new Map();
export function serialMessage(key,fn) {
  const previous=locks.get(key)||Promise.resolve();
  const next=previous.catch(()=>{}).then(fn);locks.set(key,next);
  return next.finally(()=>{if(locks.get(key)===next)locks.delete(key);});
}
async function context(schoolId,msg,phone) {
  const [school,lang,teacher,admin,parent,students]=await Promise.all([s.schoolConfig(schoolId),getUserLang(schoolId,msg.from),resolveTeacher(schoolId,msg.from),resolveStaffAdmin(schoolId,msg.from),resolveIdentity(schoolId,msg.from),s.actorStudents(schoolId,msg.from,'student')]);
  const roles=[];if(admin)roles.push('admin');if(teacher)roles.push('teacher');if(parent?.confirmed)roles.push('parent');if(students.length)roles.push('student');if(!roles.length)roles.push('public');
  const preference=await s.one('SELECT active_role FROM user_prefs WHERE school_id=? AND wa_id=?',[schoolId,msg.from]);
  return {schoolId,school,phone,wa:msg.from,lang:lang||'en',teacher,admin,parent,roles,role:roles.includes(preference?.active_role)?preference.active_role:roles[0]};
}
// Turn the current screen (body + option list) into a real WhatsApp message: 3 or fewer
// rows become quick-reply buttons, longer lists become a sectioned list picker.
// Pagination rows (prev/next) advance the 7-item page; every non-menu screen also gets
// a Back row. Bodies over 950 chars are sent as plain text first so the picker stays short.
async function render(c,st) {
  const options=st.data.screen.options,offset=st.data.page||0,visible=options.slice(offset,offset+7);
  const rows=visible.map((o,i)=>[actionId(st,'c:'+(offset+i)),o.label,o.description]);
  if(offset>0)rows.push([actionId(st,'prev'),L(c.lang,'Previous page','पिछला पेज','Pichla page')]);
  if(offset+7<options.length)rows.push([actionId(st,'next'),L(c.lang,'Next page','अगला पेज','Agla page')]);
  if(st.flow!=='menu')rows.push([actionId(st,'back'),t(c.lang,'backBtn')]);
  if(!rows.length)rows.push([actionId(st,'home'),t(c.lang,'menuButton')]);
  let body=st.data.screen.body;
  if(body.length>950) {await sendText(c.phone,c.wa,body);body=L(c.lang,'Review the details above, then choose:','ऊपर विवरण देखें, फिर चुनें:','Upar details dekhein, phir choose karein:');}
  return rows.length<=3?sendButtons(c.phone,c.wa,body,rows):sendList(c.phone,c.wa,body,t(c.lang,'menuButton'),rows);
}
async function screen(c,flow,step,body,options=[],data={},push=true) {
  const old=push?await getFlow(c.schoolId,c.wa):null;
  const hist=old && old.flow!=='menu' ? [...(old.data._hist||[]),{step:old.step,data:{...old.data,_hist:undefined}}].slice(-12) : [];
  const st=await setFlow(c.schoolId,c.wa,flow,step,{...data,role:c.role,page:0,screen:{body,options},_hist:hist});
  await render(c,st);return st;
}
async function tell(c,body) {await sendText(c.phone,c.wa,body);await home(c);}
async function home(c,header=null) {
  const options=[];
  if(c.role==='teacher') {
    const mapping={t_att:'attendance',t_marks:'marks',t_hw:'homework',t_test:'tests',t_hist:'marks'};
    for(const [key,label,desc] of menuRows(c.lang,{audience:'teacher'})) {
      if(key==='lang'||(c.school.flags[mapping[key]]&&Number(c.teacher?.['can_'+mapping[key]]))) options.push(entry(key,label,desc));
    }
    if(c.school.flags.leave&&c.teacher.classTeacherOf.length) options.splice(Math.max(0,options.length-1),0,entry('t_leaves',L(c.lang,'Leave requests','अवकाश आवेदन','Leave requests')));
    if(c.school.flags.attendance&&c.teacher.can_attendance) options.push(entry('t_att_history',L(c.lang,'Attendance history','उपस्थिति इतिहास','Attendance history')));
  } else if(c.role==='admin') {
    options.push(entry('a_today',L(c.lang,"Today's summary",'आज का सारांश','Aaj ka summary')));
    if(c.school.flags.datesheet)options.push(entry('a_datesheet',L(c.lang,'Upload date sheet','डेट शीट अपलोड','Date sheet upload')));
    options.push(entry('lang','🌐 Language'));
  } else {
    const audience=c.role==='public'?'public':'parent';
    for(const [key,label,desc] of menuRows(c.lang,{audience,cfg:audience==='parent'?c.school.menu:null})) {
      if(c.school.flags[key]===false)continue;
      const fields=c.school.menu.fields?.[key];if(audience==='parent'&&Array.isArray(fields)&&!fields.length)continue;
      options.push(entry(key,label,desc));
    }
  }
  if(c.parent&&!c.parent.confirmed&&!c.parent.optedOut)options.push(entry('confirm_parent',L(c.lang,'Confirm parent number','अभिभावक नंबर पुष्टि','Parent number confirm')));
  if(c.roles.length>1)options.push(entry('role',L(c.lang,'Switch role','भूमिका बदलें','Role badlein')));
  return await screen(c,'menu','root',header|| (c.role==='teacher'?t(c.lang,'teacherMenuBody',{name:c.teacher.name}):t(c.lang,'menuBody')),options,{},false);
}
async function roleScreen(c) {return await screen(c,'role','choose',L(c.lang,'Choose how to use the bot:','बॉट की भूमिका चुनें:','Bot ka role choose karein:'),c.roles.map(r=>entry(r,r)),{},false);}
async function classScreen(c,flow) {
  await s.teacherAccess(c.schoolId,c.wa,flowPerm[flow]);
  const sections=teacherSections(c.teacher),classMap=new Map();
  for(const a of [...c.teacher.assignments,...c.teacher.classTeacherOf]) {
    const sec=await s.one('SELECT class_id FROM sections WHERE id=? AND school_id=?',[a.section_id,c.schoolId]);
    if(sec&&sections.some(x=>x.id===Number(a.section_id)))classMap.set(Number(sec.class_id),a.class_name);
  }
  return await screen(c,flow,'class',L(c.lang,'Choose a class:','कक्षा चुनें:','Class choose karein:'),[...classMap].map(([key,name])=>entry(String(key),name)),{},false);
}
async function sectionScreen(c,st,classId) {
  const allowed=new Set(teacherSections(c.teacher).map(x=>x.id));
  const secs=await s.rows('SELECT * FROM sections WHERE school_id=? AND class_id=? AND active=1 ORDER BY name',[c.schoolId,s.id(classId)]);
  return await screen(c,st.flow,'section',t(c.lang,'pickSection'),secs.filter(x=>allowed.has(Number(x.id))).map(x=>entry(String(x.id),x.name)),{classId:Number(classId)});
}
async function subjectScreen(c,st,sectionId) {
  const permitted=teacherSections(c.teacher).find(x=>x.id===Number(sectionId));if(!permitted)throw new s.UserError('This class is not assigned to you.',403);
  const data={...st.data,sectionId:Number(sectionId),sectionLabel:permitted.label};delete data.screen;delete data._hist;
  if(st.flow==='attendance') return await screen(c,st.flow,'mode',t(c.lang,'attPickMode',{section:permitted.label,day:todayIST()}),[entry('present',t(c.lang,'attModePresent')),entry('absent',t(c.lang,'attModeAbsent'))],data);
  return await screen(c,st.flow,'subject',t(c.lang,'pickSubject',{section:permitted.label}),subjectsFor(c.teacher,sectionId).map(sub=>entry(sub,sub)),data);
}
const confirmOptions=c=>[entry('confirm',t(c.lang,'confirmBtn')),entry('edit',t(c.lang,'editBtn'))];
async function previewMarks(c,draft,flow='marks') {
  const lines=draft.entries.map(e=>e.roll_no+'. '+e.name+' — '+e.marks).join('\n');
  const missing=draft.missing.length?'\n'+L(c.lang,'Missing (not recorded as zero): ','छूटे हुए (शून्य नहीं): ','Missing (zero nahi): ')+draft.missing.map(e=>e.roll+' '+e.name).join(', '):'';
  return await screen(c,flow,'preview',t(c.lang,'marksPreview',{subject:draft.subject,name:draft.name,total:draft.total,section:'',lines,invalid:'',missing}),confirmOptions(c),{draft});
}
async function chooseChild(c,module) {
  const school=await s.schoolConfig(c.schoolId);
  if(!s.menuAllowed(school,module))throw new s.UserError('This menu option is disabled.',403);
  if(school.flags[module]===false)throw new s.UserError('This service is disabled.',403);
  if(!['parent','student'].includes(c.role)){if(c.parent&&!c.parent.confirmed&&!c.parent.optedOut)return await start(c,'confirm_parent');return await tell(c,t(c.lang,'privacyLocked'));}
  const kids=await s.actorStudents(c.schoolId,c.wa,c.role);
  return await screen(c,'parent','child',L(c.lang,'Choose a student:','छात्र चुनें:','Student choose karein:'),kids.map(st=>entry(String(st.id),st.name,s.classLabel(st))),{module},false);
}
async function parentFields(c,module,studentId) {
  const kid=await s.childAccess(c.schoolId,c.wa,studentId,c.role);
  const allowed=(s.MENU_FIELDS[module]||[]).filter(f=>s.menuAllowed(c.school,module,f));
  const labels={today:L(c.lang,'Today','आज','Aaj'),month:L(c.lang,'This month','इस महीने','Is mahine'),latest:L(c.lang,'Latest marks','नवीनतम अंक','Latest marks'),history:L(c.lang,'History','इतिहास','History'),dues:L(c.lang,'Dues','बकाया','Dues'),official:L(c.lang,'Official date sheet','आधिकारिक डेट शीट','Official date sheet'),tests:L(c.lang,'Upcoming tests','आगामी टेस्ट','Upcoming tests'),apply:L(c.lang,'Apply for leave','अवकाश आवेदन','Leave apply')};
  return await screen(c,'parent','field',kid.name+' — '+s.classLabel(kid),allowed.map(key=>entry(key,labels[key]||key)),{module,studentId:Number(studentId)});
}
async function parentResult(c,data,field) {
  const {module,studentId}=data;
  const school=await s.feature(c.schoolId,module);
  if(!s.menuAllowed(school,module,field))throw new s.UserError('This view is disabled.',403);
  const kid=await s.childAccess(c.schoolId,c.wa,studentId,c.role),date=todayIST();
  if(pullRateLimited(c.schoolId,c.wa))throw new s.UserError('Daily query limit reached. Contact the school office.');
  let body=kid.name+' — '+s.classLabel(kid)+'\n';
  if(module==='leave'&&field==='apply')return await screen(c,'leave','type',t(c.lang,'leavePickType'),[entry('sick',t(c.lang,'leaveSick')),entry('other',t(c.lang,'leaveOther'))],{studentId},false);
  if(module==='leave') {
    const list=await s.rows('SELECT day,type,title,status,teacher_note FROM leaves WHERE school_id=? AND student_id=? ORDER BY id DESC LIMIT 30',[c.schoolId,kid.id]);
    body+=list.length?list.map(l=>l.day+' · '+l.type+' · '+l.status+'\n'+l.title+(l.teacher_note?'\n'+l.teacher_note:'')).join('\n\n'):L(c.lang,'No leave requests.','कोई आवेदन नहीं।','Koi leave nahi.');
  }
  if(module==='attendance'&&field==='today') {
    const a=await s.one('SELECT status FROM attendance WHERE school_id=? AND student_id=? AND day=?',[c.schoolId,kid.id,date]);
    const leave=await s.one("SELECT id FROM leaves WHERE school_id=? AND student_id=? AND day=? AND status='approved'",[c.schoolId,kid.id,date]);
    const status=a?.status||(leave?'leave':'none');body+=date+' · '+t(c.lang,{present:'attStatusPresent',absent:'attStatusAbsent',leave:'attStatusLeave',none:'attStatusNone'}[status]);
  } else if(module==='attendance') {
    const a=await s.one("SELECT COUNT(*) AS n,SUM(status='present') AS present,SUM(status='absent') AS absent,SUM(status='leave') AS leave FROM attendance WHERE school_id=? AND student_id=? AND day>=? AND day<=?",[c.schoolId,kid.id,date.slice(0,7)+'-01',date]);
    const denominator=Number(a.present||0)+Number(a.absent||0);
    body+=L(c.lang,'Present / Absent / Leave: ','उपस्थित / अनुपस्थित / अवकाश: ','Present / Absent / Leave: ')+[a.present||0,a.absent||0,a.leave||0].join(' / ')+'\n'+(denominator?(Math.round(10000*Number(a.present)/denominator)/100)+'%':L(c.lang,'Not enough data','पर्याप्त डेटा नहीं','Data nahi hai'))+'\n'+L(c.lang,'Approved leave is excluded from the percentage.','स्वीकृत अवकाश प्रतिशत में शामिल नहीं।','Approved leave percentage mein include nahi.');
  }
  if(module==='fees') body+=Number(kid.fees_due)>0?'₹'+Number(kid.fees_due).toLocaleString('en-IN')+' '+L(c.lang,'due','बकाया','due'):L(c.lang,'No dues.','कोई बकाया नहीं।','Koi dues nahi.');
  if(module==='marks') {
    const list=await s.rows('SELECT e.name,e.subject,e.total_marks,e.test_date,m.marks FROM marks m JOIN marks_exams e ON e.id=m.exam_id AND e.school_id=m.school_id WHERE m.school_id=? AND m.student_id=? ORDER BY e.id DESC LIMIT ?',[c.schoolId,kid.id,field==='latest'?5:50]);
    body+=list.length?list.map(e=>e.test_date+' · '+e.subject+' · '+e.name+': '+e.marks+'/'+e.total_marks).join('\n'):t(c.lang,'marksNone');
  }
  if(module==='homework') {
    const list=await s.rows('SELECT subject,text FROM homework WHERE school_id=? AND section_id=? AND day=? ORDER BY id DESC',[c.schoolId,kid.section_id||0,date]);
    body+=list.length?list.map(e=>e.subject+': '+e.text).join('\n\n'):t(c.lang,'hwNone');
  }
  if(module==='datesheet'&&field==='tests') {
    await s.feature(c.schoolId,'tests');
    const list=await s.rows('SELECT subject,name,test_date FROM tests WHERE school_id=? AND section_id=? AND test_date>=? ORDER BY test_date LIMIT 50',[c.schoolId,kid.section_id||0,date]);
    body+=list.length?list.map(e=>e.test_date+' · '+e.subject+' · '+e.name).join('\n'):L(c.lang,'No upcoming tests.','कोई आगामी टेस्ट नहीं।','Koi upcoming test nahi.');
  }
  if(module==='datesheet'&&field==='official') {
    const doc=await s.one('SELECT * FROM date_sheets WHERE school_id=? AND active=1 AND (section_id IS NULL OR section_id=?) ORDER BY id DESC LIMIT 1',[c.schoolId,kid.section_id||0]);
    if(!doc)body+=t(c.lang,'dsNone');
    else if(doc.kind==='text')body+=doc.title+'\n'+doc.content;
    else {
      const mediaId=await uploadMedia(c.phone,Buffer.from(doc.pdf),doc.mime_type,doc.pdf_name);
      const result=doc.mime_type.startsWith('image/')?await sendImage(c.phone,c.wa,mediaId,doc.title):await sendDocument(c.phone,c.wa,mediaId,doc.pdf_name,doc.title);
      if(!result.ok)throw new s.UserError('The document could not be delivered. Please retry.');
      body+=doc.title;
    }
  }
  await audit(c.schoolId,c.wa,'personal_pull','module='+module+' field='+field+' student='+kid.id);
  return await screen(c,'parent','result',body,[],{module,studentId});
}
// Teacher attendance confirmation screen: a present-first / absent-second roll list with
// counts, plus any approved-leave students listed separately so they can't be marked
// absent by mistake. This preview is the write gate — nothing is saved or notified
// until the teacher taps confirm in the handleFlow 'preview' step.
async function attendancePreview(c,draft) {
  const list=status=>draft.entries.filter(e=>e.status===status).map(e=>e.roll_no+'. '+e.name).join('\n')||'—';
  const body=t(c.lang,'attPreview',{section:teacherSections(c.teacher).find(x=>x.id===draft.sectionId)?.label||'',day:draft.day,mode:draft.mode,pc:draft.entries.filter(e=>e.status==='present').length,ac:draft.entries.filter(e=>e.status==='absent').length,plist:list('present'),alist:list('absent'),invalid:'\n\n'+L(c.lang,'Approved leave','स्वीकृत अवकाश','Approved leave')+':\n'+list('leave')});
  return await screen(c,'attendance','preview',body,confirmOptions(c),{draft});
}
async function handleFlow(c,st,value,input,msg) {
  let d=st.data,flow=st.flow,step=st.step;
  if(flow==='confirmParent') {if(value==='yes')await confirmParent(c.schoolId,c.wa);else if(value==='no')await denyParent(c.schoolId,c.wa);else throw new s.UserError('Choose YES or NO.');await clearFlow(c.schoolId,c.wa);return await roleScreen(await context(c.schoolId,{from:c.wa},c.phone));}
  if(flow==='role') {if(!c.roles.includes(value))throw new s.UserError('Invalid role.');await s.run('UPDATE user_prefs SET active_role=? WHERE school_id=? AND wa_id=?',[value,c.schoolId,c.wa]);c.role=value;await clearFlow(c.schoolId,c.wa);return await home(c);}
  if(flow==='language') {if(!['en','hi','hg'].includes(value))throw new s.UserError('Invalid language.');await setUserLang(c.schoolId,c.wa,value);c.lang=value;return await home(c,t(value,'langSetConfirm'));}
  if(flow==='menu')return await start(c,value);
  if(flow==='parent'&&step==='child')return await parentFields(c,d.module,s.id(value));
  if(flow==='parent'&&step==='field')return await parentResult(c,d,value);
  if(flowPerm[flow]&&step==='class')return await sectionScreen(c,st,value);
  if(flowPerm[flow]&&step==='section')return await subjectScreen(c,st,value);
  if(flowPerm[flow]&&step==='subject') {
    if(!subjectsFor(c.teacher,d.sectionId).includes(value))throw new s.UserError('Subject is not assigned.',403);
    const next={...d,subject:value};
    if(flow==='marks')return await screen(c,flow,'meta',t(c.lang,'marksAskMeta'),[],next);
    if(flow==='homework')return await screen(c,flow,'text',t(c.lang,'hwAskText',{subject:value,section:d.sectionLabel}),[],next);
    if(flow==='test')return await screen(c,flow,'text',t(c.lang,'tdAskMeta'),[],next);
  }
  if(flow==='attendance'&&step==='mode')return await screen(c,flow,'rolls',t(c.lang,value==='present'?'attAskRollsPresent':'attAskRollsAbsent')+'\n'+L(c.lang,'Type NONE for an empty list.','खाली सूची के लिए NONE लिखें।','Empty list ke liye NONE likhein.'),[],{...d,mode:value});
  if(flow==='attendance'&&step==='rolls')return await attendancePreview(c,await s.attendanceDraft(c.schoolId,c.wa,d.sectionId,d.mode,input));
  if(flow==='attendance'&&step==='preview') {
    if(value==='edit')return await screen(c,flow,'rolls',t(c.lang,d.draft.mode==='present'?'attAskRollsPresent':'attAskRollsAbsent'),[],{sectionId:d.draft.sectionId,mode:d.draft.mode});
    if(value==='confirm') {const result=await s.saveAttendance(c.schoolId,c.wa,d.draft,st.nonce);return await tell(c,t(c.lang,'attSaved',{section:'',present:result.present,absent:result.absent})+'\n'+L(c.lang,'Alerts are queued; delivery status is in the panel.','सूचनाएं कतार में हैं; वितरण स्थिति पैनल में है।','Alerts queue mein hain; delivery panel mein dikhegi.'));}
  }
  if(flow==='leave') {
    if(step==='type')return await screen(c,flow,'date',L(c.lang,'Choose a date, or type YYYY-MM-DD:','तिथि चुनें या YYYY-MM-DD लिखें:','Date choose karein ya YYYY-MM-DD likhein:'),[entry(todayIST(),L(c.lang,'Today','आज','Aaj')),entry(todayIST(1),L(c.lang,'Tomorrow','कल','Kal'))],{...d,type:value});
    if(step==='date')return await screen(c,flow,'reason',t(c.lang,'leaveAskReason'),[],{...d,day:s.day(value||input)});
    if(step==='reason') {const draft=await s.leaveDraft(c.schoolId,c.wa,d.studentId,d.type,input,d.day,c.role);return await screen(c,flow,'preview',t(c.lang,'leavePreview',{name:draft.name,cls:draft.section,type:draft.type,reason:draft.reason,day:draft.day}),confirmOptions(c),{draft});}
    if(step==='preview'&&value==='edit')return await screen(c,flow,'reason',t(c.lang,'leaveAskReason'),[],{studentId:d.draft.studentId,type:d.draft.type,day:d.draft.day});
    if(step==='preview'&&value==='confirm') {const result=await s.saveLeave(c.schoolId,c.wa,d.draft,st.nonce);return await tell(c,L(c.lang,'Leave request saved.','अवकाश आवेदन सहेजा गया।','Leave request save ho gayi.')+(result.teacherAssigned?'':'\n'+L(c.lang,'No class teacher is assigned yet. Please contact the school admin.','कक्षा शिक्षक नियुक्त नहीं है। स्कूल एडमिन से संपर्क करें।','Class teacher assign nahi hai. School admin se baat karein.')));}
  }
  if(flow==='leaveReview') {
    if(step==='list') {const l=await s.leaveForTeacher(c.schoolId,c.wa,value);return await screen(c,flow,'decision',t(c.lang,'leaveTeacherAsk',{school:c.school.name,name:l.name,cls:s.classLabel(l),roll:l.roll_no,type:l.type,reason:l.reason,day:l.day}),[entry('approved',t(c.lang,'leaveApproveBtn')),entry('rejected',t(c.lang,'leaveRejectBtn'))],{leaveId:Number(l.id)});}
    if(step==='decision'&&value==='approved') {await s.decideLeave(c.schoolId,c.wa,d.leaveId,'approved','',st.nonce);return await tell(c,L(c.lang,'Leave approved. Update queued.','अवकाश स्वीकृत। सूचना कतार में है।','Leave approved. Update queue mein hai.'));}
    if(step==='decision'&&value==='rejected')return await screen(c,flow,'reason',t(c.lang,'leaveRejectAsk'),[entry('skip',t(c.lang,'skipBtn'))],d);
    if(step==='reason')return await screen(c,flow,'confirm',L(c.lang,'Reject this request?','अनुरोध अस्वीकार करें?','Request reject karein?')+'\n'+(value==='skip'?'—':s.text(input,500)),[entry('confirm',t(c.lang,'confirmBtn'))],{...d,note:value==='skip'?'':s.text(input,500)});
    if(step==='confirm'&&value==='confirm') {await s.decideLeave(c.schoolId,c.wa,d.leaveId,'rejected',d.note,st.nonce);return await tell(c,L(c.lang,'Leave rejected. Update queued.','अवकाश अस्वीकृत। सूचना कतार में है।','Leave rejected. Update queue mein hai.'));}
  }
  if(flow==='marks'&&step==='meta') {
    const m=input.match(/^(.+?)\s+(\d+(?:\.\d+)?)$/);if(!m)throw new s.UserError('Send the test name followed by total marks, e.g. Weekly Test 50.');
    return await screen(c,flow,'data',t(c.lang,'marksAskData',{subject:d.subject,section:d.sectionLabel,name:m[1],total:m[2]}),[],{...d,name:m[1],total:Number(m[2])});
  }
  if((flow==='marks'||flow==='history')&&(step==='data'||step==='correction')) {
    let entries;
    if(msg.type==='image') {
      const draft=d.draft||d;await s.teacherAccess(c.schoolId,c.wa,draft.examId?'marks_edit':'marks',draft.sectionId,draft.subject);
      await sendText(c.phone,c.wa,t(c.lang,'marksPhotoWorking'));
      const media=await downloadMedia(msg.image?.id); const result=await extractMarks(c.schoolId,media.buffer,media.mime);
      if(result.total!==null&&result.total!==Number(draft.total))throw new s.UserError('The image total differs from the selected total. Go back and verify it.');
      entries=result.entries;
    } else entries=s.parseMarks(input);
    const meta={...(d.draft||d)};
    if(msg.type==='image'&&msg.image?.caption&&!meta.examId)meta.name=s.text(msg.image.caption,100);
    if(step==='correction'&&!meta.examId) {
      const combined=new Map(meta.entries.map(e=>[s.roll(e.roll_no),e]));for(const e of entries)combined.set(s.roll(e.roll_no),e);entries=[...combined.values()];
    }
    return await previewMarks(c,await s.marksDraft(c.schoolId,c.wa,meta,entries,meta.examId||null),flow);
  }
  if((flow==='marks'||flow==='history')&&step==='preview') {
    if(value==='edit')return await screen(c,flow,'correction',t(c.lang,'marksEditAsk'),[],{draft:d.draft});
    if(value==='confirm') {const result=await s.saveMarks(c.schoolId,c.wa,d.draft,st.nonce);return await tell(c,t(c.lang,result.edited?'marksEdited':'marksSaved',{subject:d.draft.subject,name:d.draft.name,count:result.count}));}
  }
  if(flow==='history'&&step==='list') {
    const exam=await s.examForTeacher(c.schoolId,c.wa,value);
    return await screen(c,flow,'view',exam.subject+' — '+exam.name+' ('+exam.total_marks+')\n'+exam.entries.map(e=>e.roll_no+'. '+e.name+' — '+e.marks).join('\n'),exam.canEdit?[entry('edit',t(c.lang,'editBtn'))]:[],{examId:Number(exam.id)});
  }
  if(flow==='history'&&step==='view'&&value==='edit') {
    const e=await s.examForTeacher(c.schoolId,c.wa,d.examId);if(!e.canEdit)throw new s.UserError('Editing is disabled by the school admin.',403);
    return await screen(c,flow,'correction',t(c.lang,'marksEditHow',{name:e.name}),[],{draft:{examId:Number(e.id),sectionId:Number(e.section_id),subject:e.subject,name:e.name,total:Number(e.total_marks),revision:Number(e.revision),testDate:e.test_date}});
  }
  if(flow==='homework'&&step==='text')return await screen(c,flow,'preview',d.subject+'\n'+s.text(input,4000),confirmOptions(c),{...d,text:s.text(input,4000)});
  if(flow==='test'&&step==='text') {
    const m=input.match(/^(.+?)\s+(\d{4}-\d{2}-\d{2})$/);if(!m)throw new s.UserError('Send a test name and YYYY-MM-DD date.');
    s.day(m[2]);return await screen(c,flow,'preview',d.subject+'\n'+m[1]+' · '+m[2],confirmOptions(c),{...d,name:m[1],date:m[2]});
  }
  if((flow==='homework'||flow==='test')&&step==='preview') {
    if(value==='edit')return await screen(c,flow,'text',t(c.lang,flow==='test'?'tdAskMeta':'hwAskText',{subject:d.subject,section:d.sectionLabel}),[],d);
    if(value==='confirm') {if(flow==='homework')await s.saveHomework(c.schoolId,c.wa,d,st.nonce);else await s.saveTest(c.schoolId,c.wa,d,st.nonce);return await tell(c,t(c.lang,flow==='homework'?'hwSaved':'tdSaved',{name:d.name,subject:d.subject,section:d.sectionLabel,date:d.date}));}
  }
  if(flow==='adminSheet') {
    if(step==='content') {
      let doc={kind:'text',content:s.text(input,20000),title:L(c.lang,'Date sheet','डेट शीट','Date sheet')};
      if(msg.type==='document'||msg.type==='image') {
        const file=msg.document||msg.image;const media=await downloadMedia(file.id,['application/pdf','image/jpeg','image/png']);
        doc={kind:'file',mime:media.mime,base64:media.buffer.toString('base64'),name:s.text(file.filename||'date-sheet.'+(media.mime==='application/pdf'?'pdf':'png'),100),title:s.text(file.caption||'Date sheet',100)};
        // Large binary drafts use the scoped, expiring upload store rather than conversation JSON.
        const job=s.newToken();await s.run('INSERT INTO import_jobs(id,school_id,staff_id,payload,expires_at) VALUES(?,?,?,?,?)',[job,c.schoolId,c.admin.id,JSON.stringify(doc),Date.now()+600000]);
        doc={job,title:doc.title};
      }
      if(!doc.job&&!doc.content)throw new s.UserError('Send a PDF, image or date-sheet text.');
      return await screen(c,flow,'preview',L(c.lang,'Publish this date sheet?','यह डेट शीट प्रकाशित करें?','Ye date sheet publish karein?')+'\n'+(doc.content||doc.title),confirmOptions(c),{doc});
    }
    if(step==='preview'&&value==='edit')return await screen(c,flow,'content',t(c.lang,'dsUploadHint'),[],{},false);
    if(step==='preview'&&value==='confirm') {
      const {saveDateSheet}=await import('./schoolAdmin.js');let doc=d.doc;
      if(doc.job){const job=await s.one('SELECT payload FROM import_jobs WHERE id=? AND school_id=? AND staff_id=? AND expires_at>?',[doc.job,c.schoolId,c.admin.id,Date.now()]);if(!job)throw new s.UserError('Upload expired.');doc=JSON.parse(job.payload);}
      await saveDateSheet(c.schoolId,{role:'admin',staff_id:c.admin.id,email:c.wa,school_id:c.schoolId},doc,st.nonce);
      return await tell(c,t(c.lang,'dsSavedText'));
    }
  }
  throw new s.UserError('Please use the options on the latest message.');
}
async function start(c,value) {
  if(value==='confirm_parent'&&c.parent&&!c.parent.confirmed)return await screen(c,'confirmParent','confirm',t(c.lang,'confirmPrompt',{school:c.school.name}),[entry('yes','YES'),entry('no','NO')],{},false);
  if(value==='role')return await roleScreen(c);
  if(value==='lang')return await screen(c,'language','choose',t(c.lang,'langPickerIntro'),[entry('en','English'),entry('hi','हिन्दी'),entry('hg','Hinglish')],{},false);
  if(c.role==='teacher') {
    const flow={t_att:'attendance',t_marks:'marks',t_hw:'homework',t_test:'test'}[value];if(flow)return await classScreen(c,flow);
    if(value==='t_hist') {const list=await s.teacherHistory(c.schoolId,c.wa);return await screen(c,'history','list',list.length?t(c.lang,'marksHistPick'):t(c.lang,'marksHistEmpty'),list.map(e=>entry(String(e.id),e.name,e.subject+' · '+s.classLabel(e)+' · '+e.created_at)),{},false);}
    if(value==='t_leaves') {
      await s.feature(c.schoolId,'leave');const list=await s.rows(`SELECT l.id,l.day,l.title,s.name FROM leaves l JOIN students s ON s.id=l.student_id AND s.school_id=l.school_id AND s.section_id=l.section_id
        JOIN sections sec ON sec.id=l.section_id AND sec.school_id=l.school_id WHERE l.school_id=? AND sec.class_teacher_id=? AND l.status='pending' ORDER BY l.id LIMIT 100`,[c.schoolId,c.teacher.id]);
      return await screen(c,'leaveReview','list',L(c.lang,'Pending leave requests','लंबित अवकाश आवेदन','Pending leave requests'),list.map(l=>entry(String(l.id),l.name,l.day+' · '+l.title)),{},false);
    }
    if(value==='t_att_history') {
      await s.teacherAccess(c.schoolId,c.wa,'attendance');const secs=teacherSections(c.teacher).map(x=>x.id);
      const list=secs.length?await s.rows("SELECT day,section_id,SUM(status='present') AS present,SUM(status='absent') AS absent,SUM(status='leave') AS leave FROM attendance WHERE school_id=? AND section_id IN("+secs.map(()=>'?').join(',')+") GROUP BY day,section_id ORDER BY day DESC LIMIT 30",[c.schoolId,...secs]):[];
      return await screen(c,'attendanceHistory','view',list.length?list.map(a=>a.day+' · '+(teacherSections(c.teacher).find(x=>x.id===Number(a.section_id))?.label||'')+'\n'+[a.present,a.absent,a.leave].join(' / ')).join('\n\n'):L(c.lang,'No records.','कोई रिकॉर्ड नहीं।','Koi record nahi.'),[],{},false);
    }
  }
  if(c.role==='admin'&&value==='a_today') {
    const stats=await s.one("SELECT SUM(status='present') AS present,SUM(status='absent') AS absent,SUM(status='leave') AS leave FROM attendance WHERE school_id=? AND day=?",[c.schoolId,todayIST()]);
    const pending=await s.one("SELECT COUNT(*) AS n FROM leaves WHERE school_id=? AND status='pending'",[c.schoolId]);
    const hw=await s.one('SELECT COUNT(*) AS n FROM homework WHERE school_id=? AND day=?',[c.schoolId,todayIST()]);
    return await screen(c,'adminSummary','view',t(c.lang,'adminSummary',{school:c.school.name,day:todayIST(),present:stats.present||0,absent:stats.absent||0,leave:stats.leave||0,pending:pending.n,homework:hw.n}),[],{},false);
  }
  if(c.role==='admin'&&value==='a_datesheet') {await s.feature(c.schoolId,'datesheet');return await screen(c,'adminSheet','content',t(c.lang,'dsUploadHint'),[],{},false);}
  if(['timings','holidays','notices','admission'].includes(value)) {
    if(c.school.flags[value]===false)throw new s.UserError('Service disabled.',403);
    if(c.role!=='public'&&!s.menuAllowed(c.school,value,value==='admission'?'info':'current'))throw new s.UserError('Menu option disabled.',403);
    let body=c.school[value]||'';
    if(value==='holidays') {const ev=await s.rows("SELECT name,event_date,details FROM school_events WHERE school_id=? AND kind='holiday' AND event_date>=? ORDER BY event_date LIMIT 30",[c.schoolId,todayIST()]);body+='\n'+ev.map(e=>e.event_date+' · '+e.name+' '+e.details).join('\n');}
    if(value==='notices'&&c.school.flags.events){const events=await s.rows("SELECT name,event_date,details FROM school_events WHERE school_id=? AND kind='event' AND event_date>=? ORDER BY event_date LIMIT 20",[c.schoolId,todayIST()]);body+='\n'+events.map(e=>e.event_date+' · '+e.name+' '+e.details).join('\n');}
    if(value==='admission')body=await publicAnswer(c,'Tell me about admissions.');
    return await screen(c,'publicInfo','view',body.trim()||L(c.lang,'Please contact the school office.','स्कूल कार्यालय से संपर्क करें।','School office se baat karein.'),[],{},false);
  }
  if(MAIN.has(value))return await chooseChild(c,value);
  throw new s.UserError('That option is not available for your role.',403);
}
async function publicAnswer(c,question) {
  const {answerQuestion}=await import('./ai/brain.js');
  return (await answerQuestion({id:c.schoolId,name:c.school.name,kb:c.school.kb},question,c.lang))||t(c.lang,'aiFallback',{office:c.school.office_phone||t(c.lang,'officeContact')});
}
/**
 * Webhook entry point for one inbound message. Validates the sender's WhatsApp id,
 * then runs everything inside serialMessage so one user's messages never overlap.
 * The pipeline, in order: STOP/START opt-outs, unconfirmed-parent gating, link
 * requests, menu/language shortcuts, the active flow's step handler, teacher
 * text aliases, intent classification, and the AI knowledge-base fallback.
 * UserError instances become friendly user messages (with the current screen
 * re-rendered); any other error becomes a generic failure — 403s clear the flow
 * instead so stale permission state can't persist.
 */
export async function handleMessage(schoolId,phone,msg) {
  if(!msg?.from||!/^\d{7,15}$/.test(msg.from))return;
  return serialMessage(schoolId+':'+msg.from,async()=>{
    let c;
    try {
      c=await context(schoolId,msg,phone);
      const inboundAt=Number(msg.timestamp)>0?Math.min(Date.now(),Number(msg.timestamp)*1000):(process.env.NODE_ENV==='test'?Date.now():0);
      await s.run('INSERT INTO user_prefs(school_id,wa_id,last_inbound) VALUES(?,?,?) ON CONFLICT(school_id,wa_id) DO UPDATE SET last_inbound=MAX(last_inbound,excluded.last_inbound)',[schoolId,c.wa,inboundAt]);
      const input=String(msg.text?.body||msg.image?.caption||msg.document?.caption||'').trim();
      const tapped=msg.interactive?.button_reply?.id||msg.interactive?.list_reply?.id||'';
      if(/^(stop|unsubscribe|band karo)$/i.test(input)) {await setOptOut(schoolId,c.wa,true);await s.run('UPDATE user_prefs SET opted_out=1 WHERE school_id=? AND wa_id=?',[schoolId,c.wa]);return await tell(c,t(c.lang,'stopReply'));}
      if(/^(start|subscribe|shuru karo)$/i.test(input)) {await setOptOut(schoolId,c.wa,false);await s.run('UPDATE user_prefs SET opted_out=0 WHERE school_id=? AND wa_id=?',[schoolId,c.wa]);return await tell(c,t(c.lang,'startReply'));}
      let st=await getFlow(schoolId,c.wa);
      if(c.parent&&!c.parent.confirmed && c.role==='public' && !st) {
        if(/^(yes|haan|हाँ)$/i.test(input)) {await confirmParent(schoolId,c.wa);c=await context(schoolId,msg,phone);return await home(c,t(c.lang,'yesConfirmed'));}
        if(/^(no|nahi|नहीं)$/i.test(input)) {await denyParent(schoolId,c.wa);return await tell(c,t(c.lang,'noReply'));}
        if(!c.parent.optedOut&&/^(hi|hello|menu)$/i.test(input)) {await sendText(phone,c.wa,t(c.lang,'confirmPrompt',{school:c.school.name}));return;}
      }
      if(/^link\b/i.test(input)) {
        if(c.parent?.confirmed)return await tell(c,t(c.lang,'alreadyLinked',{office:c.school.office_phone||t(c.lang,'officeContact')}));
        if(linkRateLimited(schoolId,c.wa))throw new s.UserError('Link request limit reached.');
        const note=s.text(input.replace(/^link\b/i,''),120);if(!note)return await tell(c,t(c.lang,'linkUsage'));
        await createLinkRequest(schoolId,c.wa,note);return await tell(c,t(c.lang,'linkCreated'));
      }
      if(/^(menu|home|hi|hello|hey|नमस्ते|मेनू|options)$/i.test(input)||tapped==='menu')return await home(c);
      if(/^(language|bhasha|भाषा)$/i.test(input)||tapped==='lang')return await start(c,'lang');
      if(st&&st.data.role!==c.role) {await clearFlow(schoolId,c.wa);st=null;}
      if(st) {
        if(flowPerm[st.flow])await s.teacherAccess(schoolId,c.wa,st.data.draft?.examId?'marks_edit':flowPerm[st.flow],st.data.sectionId||st.data.draft?.sectionId,null);
        if(['parent','leave'].includes(st.flow)&& (st.data.studentId||st.data.draft?.studentId))await s.childAccess(schoolId,c.wa,st.data.studentId||st.data.draft.studentId,c.role);
        if(st.flow==='leaveReview'&&st.data.leaveId)await s.leaveForTeacher(schoolId,c.wa,st.data.leaveId);
        let action=tapped?readAction(st,tapped):null;
        if(tapped&&action===null)throw new s.UserError('That button is from an older screen. Use the latest message or type MENU.');
        if(/^(back|वापस)$/i.test(input))action='back';
        if(action==='back') {const prev=await applyBack(schoolId,c.wa,st.flow,st.data);return prev?render(c,prev):home(c);}
        if(action==='next'||action==='prev') {const page=Math.max(0,(st.data.page||0)+(action==='next'?7:-7));if(page>=st.data.screen.options.length)throw new s.UserError('Invalid page.');const newState=await setFlow(schoolId,c.wa,st.flow,st.step,{...st.data,page});return await render(c,newState);}
        if(action==='home')return await home(c);
        let value=null;
        if(action?.startsWith('c:'))value=st.data.screen.options[Number(action.slice(2))]?.value;
        if(st.flow==='confirmParent'&&/^(yes|haan|हाँ)$/i.test(input))value='yes';
        if(st.flow==='confirmParent'&&/^(no|nahi|नहीं)$/i.test(input))value='no';
        if(!value&&/^(confirm|yes|कन्फर्म)$/i.test(input)&&byValue(st,'confirm'))value='confirm';
        if(!value&&/^(edit|बदलें)$/i.test(input)&&byValue(st,'edit'))value='edit';
        if(!value&&/^(skip|छोड़ें)$/i.test(input)&&byValue(st,'skip'))value='skip';
        if(st.flow!=='menu')return await handleFlow(c,st,value,input,msg);
        if(value)return await start(c,value);
      }
      if(tapped) {if(MAIN.has(tapped)||tapped.startsWith('t_'))return await start(c,tapped);throw new s.UserError('Use the latest menu.');}
      const teacherAliases={attendance:'t_att',marks:'t_marks',homework:'t_hw',test:'t_test',history:'t_hist',leave:'t_leaves'};
      const term=input.toLowerCase();if(c.role==='teacher'&&teacherAliases[term])return await start(c,teacherAliases[term]);
      const alias={'date sheet':'datesheet','datesheet':'datesheet','leave':'leave','test':'datesheet','tests':'datesheet',attendence:'attendance',hajri:'attendance',fees:'fees',fee:'fees'};
      const intent=alias[term]|| (MAIN.has(term)?term:null);
      if(intent)return await start(c,intent);
      if(!input)return await home(c);
      const {classify}=await import('./intents.js');const guessed=classify(input);if(guessed.intent)return await start(c,guessed.intent);
      if(c.role==='teacher')return await home(c);
      await sendText(phone,c.wa,await publicAnswer(c,input));return await home(c);
    } catch(error) {
      if(c) {await audit(c.schoolId,c.wa,'bot_action_rejected',error instanceof s.UserError?'validation_or_permission':'internal_error');
        await sendText(phone,msg.from,(c.lang==='en'?(error instanceof s.UserError?error.message:'Something went wrong. Please try again.') : L(c.lang,'', 'यह प्रक्रिया पूरी नहीं हुई। इनपुट और अनुमति जांचें, या Back / Menu चुनें।','Process complete nahi hua. Input aur permission check karein, ya Back / Menu choose karein.')));
        const current=await getFlow(schoolId,c.wa);if(current&&error?.status!==403)await render(c,current);else {await clearFlow(schoolId,c.wa);await home(c);}
      }
      else console.error('[bot] School is unavailable');
    }
  });
}
