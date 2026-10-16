import crypto from 'node:crypto';
import { db, getUserLang, todayIST } from './db.js';
import { one, rows, run, schoolConfig, childAccess, leaveForTeacher, UserError, classLabel } from './services.js';
import { handleMessage } from './bot.js';
import { sendText, sendTemplate } from './whatsapp.js';
import { t } from './i18n.js';

// ── Durable message queue worker (inbox + outbox), driven on a tick by index.js.
// - inbox: inbound webhook payloads are stored durably BEFORE the webhook is
//   acknowledged (jobs.ingest, called from webhook.js), then processed here:
//   claimed with status='processing', handled via bot.js, then marked 'done'.
//   Crashes leave 'processing' rows behind; recoverJobs() re-queues them.
// - outbox: notification jobs are validated by notificationFor() (school active,
//   recipient not opted out, service enabled, underlying record still current,
//   24h window vs approved utility template), claimed with status='sending',
//   then handed to whatsapp.js. Rate-limit (429) failures back off with bounded
//   retries; ambiguous sends become 'uncertain' and are NEVER auto-retried
//   (Meta has no send-idempotency guarantee); every other failure is terminal
//   with the provider error recorded.
// processJobs() runs behind a busy-guard so overlapping ticks can't double-claim.
let busy=false;
/**
 * Validate a Meta webhook signature with a timing-safe HMAC comparison.
 * Fails closed: a missing/foreign `secret` or a malformed "sha256=<64 hex>" header
 * returns false before any crypto runs, so bad headers never reach the comparison.
 * @param {Buffer|string} raw - raw request body exactly as Meta sent it
 * @param {string} signature - value of the X-Hub-Signature-256 header
 * @param {string} secret - Meta app secret; empty string never validates
 * @returns {boolean}
 */
export function signatureValid(raw,signature,secret) { return verifySignature(raw,signature,secret); }
// Meta signs the payload as "sha256=<64 lowercase hex chars>". Reject malformed signatures
// before hashing so a missing or foreign header never reaches the HMAC comparison; the
// comparison itself uses crypto.timingSafeEqual to avoid leaking the secret via timing.
function verifySignature(raw,signature,secret) {
  if(!secret||!/^sha256=[0-9a-f]{64}$/.test(String(signature)))return false;
  const expected=crypto.createHmac('sha256',secret).update(raw).digest();
  return crypto.timingSafeEqual(expected,Buffer.from(signature.slice(7),'hex'));
}
/**
 * Persist an incoming Meta webhook payload to the durable inbox BEFORE the
 * webhook is acknowledged. Only messages from known, active schools and with
 * well-formed ids/senders are kept (INSERT OR IGNORE dedupes redeliveries by
 * message_id); oversized payloads (>30 KB) are skipped. Provider status
 * callbacks (delivered/read/failed) never enqueue work — they only update
 * outbox rows. Batched as a single write.
 * @param {object} payload - parsed Meta webhook body
 * @returns {Promise<number>} number of inbound messages stored
 */
export async function ingest(payload) {
  const items=[];
  for(const entry of payload.entry||[])for(const change of entry.changes||[]) {
    const value=change.value,phone=value?.metadata?.phone_number_id;if(!phone)continue;
    const school=await one('SELECT id FROM schools WHERE phone_number_id=? AND active=1',[String(phone)]);if(!school)continue;
    for(const msg of value.messages||[]) {
      if(!msg.id||!/^\d{7,15}$/.test(String(msg.from)))continue;
      const clean={id:String(msg.id).slice(0,200),from:msg.from,type:msg.type,timestamp:msg.timestamp,text:msg.text,interactive:msg.interactive,image:msg.image,document:msg.document};
      const json=JSON.stringify(clean);if(Buffer.byteLength(json)>30000)continue;
      items.push({sql:'INSERT OR IGNORE INTO inbox(school_id,message_id,wa_id,phone_number_id,payload) VALUES(?,?,?,?,?)',args:[school.id,clean.id,clean.from,String(phone),json]});
    }
    // Provider status callbacks update auditability; they never trigger another notification.
    for(const st of value.statuses||[]) if(st.id&&['delivered','read','failed'].includes(st.status)) {
      const prior=st.status==='read'?"'sent','delivered'":"'sent'";
      await run("UPDATE outbox SET status=?,error=? WHERE school_id=? AND provider_id=? AND status IN ("+prior+")",[st.status,st.status==='failed'?'Provider reported delivery failure':'',school.id,st.id]);
    }
  }
  if(items.length)await db.batch(items,'write');return items.length;
}
/**
 * Build the notification for one outbox job, re-validating everything at send
 * time: school still active, recipient not opted out, service enabled, and the
 * underlying record still current (attendance/leave). Returns {blocked:true}
 * when outside the 24h customer-service window with no approved utility template.
 * @throws {UserError} when the send must be suppressed (opt-out, disabled
 * service, superseded record, or unsupported notification kind).
 */
export async function notificationFor(job) {
  const school=await schoolConfig(job.school_id);const pref=await one('SELECT * FROM user_prefs WHERE school_id=? AND wa_id=?',[job.school_id,job.wa_id]);
  if(Number(pref?.opted_out))throw new UserError('Recipient opted out.',403);
  const payload=JSON.parse(job.payload),lang=await getUserLang(job.school_id,job.wa_id)||'en';
  let body,params,kind=job.kind,templateKind=kind;
  if(kind==='leave_request') {
    if(!school.flags.leave)throw new UserError('Leave service disabled.',403);
    const leave=await leaveForTeacher(job.school_id,job.wa_id,job.reference_id);if(leave.status!=='pending')throw new UserError('Request already decided.',403);
    const teacher=await one('SELECT opted_out FROM teachers WHERE school_id=? AND wa_id=?',[job.school_id,job.wa_id]);if(Number(teacher?.opted_out))throw new UserError('Recipient opted out.',403);
    body=t(lang,'leaveTeacherAsk',{school:school.name,name:leave.name,cls:classLabel(leave),roll:leave.roll_no,type:leave.type,reason:leave.reason,day:leave.day})+'\n'+(lang==='hi'?'MENU → अवकाश आवेदन से निर्णय लें।':lang==='hg'?'MENU → Leave requests se decision lein.':'Open MENU → Leave requests to decide.');
    params=[school.name,String(leave.id)];
  } else {
    let student;
    try {student=await childAccess(job.school_id,job.wa_id,job.reference_id,'parent');}
    catch {student=await childAccess(job.school_id,job.wa_id,job.reference_id,'student');}
    const p=await one('SELECT opted_out FROM parents WHERE school_id=? AND wa_id=?',[job.school_id,job.wa_id]);if(Number(p?.opted_out))throw new UserError('Recipient opted out.',403);
    if(kind==='attendance') {
      if(!school.flags.attendance)throw new UserError('Attendance service disabled.',403);
      const a=await one('SELECT status FROM attendance WHERE school_id=? AND student_id=? AND day=?',[job.school_id,student.id,payload.day]);
      if(!a||a.status!==payload.status)throw new UserError('Attendance notification superseded.',403);
      if(a.status==='present'&&!Number(school.present_notify))throw new UserError('Present notifications disabled.',403);
      templateKind='attendance_'+a.status;
      const label=t(lang,{present:'attStatusPresent',absent:'attStatusAbsent',leave:'attStatusLeave'}[a.status]);
      body=school.name+'\n'+student.name+' · '+payload.day+'\n'+label;params=[student.name,payload.day,label];
    } else if(kind==='leave_result') {
      if(!school.flags.leave)throw new UserError('Leave service disabled.',403);
      const leave=await one('SELECT * FROM leaves WHERE school_id=? AND id=? AND student_id=?',[job.school_id,payload.leaveId,student.id]);
      if(!leave||leave.status==='pending')throw new UserError('Leave decision unavailable.',403);
      const status=lang==='hi'?(leave.status==='approved'?'स्वीकृत':'अस्वीकृत'):leave.status;
      body=school.name+'\n'+student.name+' · '+leave.day+'\n'+status+(leave.teacher_note?'\n'+leave.teacher_note:'');params=[student.name,leave.day,status];
    } else throw new UserError('Unsupported notification.',403);
  }
  const inWindow=Number(pref?.last_inbound)>Date.now()-24*60*60*1000;
  const template=school.options.templates?.[templateKind];
  if(!inWindow&&(!template?.name||!template?.approved))return {blocked:true,reason:'Approved utility template required outside the 24-hour window.'};
  return {school,body,params,inWindow,template};
}
/**
 * Execute one outbox job end-to-end: validate via notificationFor(), claim it
 * ('pending' → 'sending', so concurrent workers cannot double-send), then hand
 * it to whatsapp.js. Outcomes: 'sent'; 'blocked' (needs approved template);
 * 'suppressed' (UserError); 'uncertain' on an ambiguous send (never auto-retried
 * — Meta has no send-idempotency guarantee); backoff-requeued 'pending' on a 429
 * (bounded, max 4 attempts); otherwise 'failed' with the provider error recorded.
 */
export async function deliver(job) {
  let n;
  try {n=await notificationFor(job);}catch(e) {await run("UPDATE outbox SET status='suppressed',error=?,payload='{}' WHERE id=?",[e instanceof UserError?e.message:'Notification validation failed',job.id]);return;}
  if(n.blocked){await run("UPDATE outbox SET status='blocked',error=? WHERE id=?",[n.reason,job.id]);return;}
  const claim=await run("UPDATE outbox SET status='sending',attempts=attempts+1 WHERE id=? AND status='pending'",[job.id]);if(!claim.rowsAffected)return;
  const result=n.inWindow?await sendText(n.school.phone_number_id,job.wa_id,n.body):await sendTemplate(n.school.phone_number_id,job.wa_id,n.template.name,n.template.language||'en',n.params);
  if(result.ok)await run("UPDATE outbox SET status='sent',provider_id=?,error='' WHERE id=?",[result.id||null,job.id]);
  else if(result.ambiguous)await run("UPDATE outbox SET status='uncertain',error=? WHERE id=?",['Delivery not confirmed; manual reconciliation required before retry.',job.id]);
  else if(result.status===429&&Number(job.attempts)<4)await run("UPDATE outbox SET status='pending',available_at=?,error=? WHERE id=?",[Date.now()+60000*(Number(job.attempts)+1),result.error,job.id]);
  else await run("UPDATE outbox SET status='failed',error=? WHERE id=?",[result.error||'Send failed',job.id]);
}
/**
 * One queue-worker tick (called from index.js on a timer). Runs behind a
 * busy-guard so overlapping ticks cannot double-claim. Inbox messages process
 * concurrently across senders but serially within a sender (per-sender promise
 * chains); outbox deliveries go out in parallel batches of three.
 */
export async function processJobs() {
  if(busy)return;busy=true;
  try {
    const pending=await rows("SELECT * FROM inbox WHERE status='pending' AND available_at<=? ORDER BY rowid LIMIT 12",[Date.now()]);
    // Concurrent across senders, serial within a sender. Domain confirmations remain transactional.
    const chains=new Map();
    for(const msg of pending) {
      const key=msg.school_id+':'+msg.wa_id;
      const task=(chains.get(key)||Promise.resolve()).then(async()=>{
        const claim=await run("UPDATE inbox SET status='processing',attempts=attempts+1 WHERE school_id=? AND message_id=? AND status='pending'",[msg.school_id,msg.message_id]);if(!claim.rowsAffected)return;
        try {await handleMessage(msg.school_id,msg.phone_number_id,JSON.parse(msg.payload));await run("UPDATE inbox SET status='done',payload='{}',error='' WHERE school_id=? AND message_id=?",[msg.school_id,msg.message_id]);}
        catch {await run("UPDATE inbox SET status=?,available_at=?,error='Message processing failed' WHERE school_id=? AND message_id=?",[msg.attempts<3?'pending':'failed',Date.now()+30000,msg.school_id,msg.message_id]);}
      });chains.set(key,task);
    }
    await Promise.all(chains.values());
    const notifications=await rows("SELECT * FROM outbox WHERE status='pending' AND available_at<=? ORDER BY id LIMIT 15",[Date.now()]);
    for(let i=0;i<notifications.length;i+=3)await Promise.all(notifications.slice(i,i+3).map(deliver));
  } finally {busy=false;}
}
/**
 * Crash recovery, run on boot: re-queue inbox rows left in 'processing' (their
 * handlers never finished), and mark outbox rows left in 'sending' as
 * 'uncertain' — a delivery interrupted mid-flight is flagged for manual
 * reconciliation, never auto-retried.
 */
export async function recoverJobs() {
  await run("UPDATE inbox SET status='pending' WHERE status='processing'");
  // Meta has no general send-idempotency guarantee. Do not automatically repeat an ambiguous send.
  await run("UPDATE outbox SET status='uncertain',error='Worker restarted during delivery; reconcile before retry.' WHERE status='sending'");
}
/**
 * Queue retention pass: drop expired flow sessions and import jobs; delete inbox
 * rows older than 7 days; clear payloads of week-old resolved outbox rows (kept
 * for delivery metadata); expire pending/blocked jobs after 7 days; hard-delete
 * outbox rows after 90 days.
 */
export async function purgeJobs() {
  await run("DELETE FROM flow_sessions WHERE expires_at < datetime('now')");
  await run('DELETE FROM import_jobs WHERE expires_at<?',[Date.now()]);
  await run("DELETE FROM inbox WHERE created_at < datetime('now','-7 days')");
  await run("UPDATE outbox SET payload='{}' WHERE created_at < datetime('now','-7 days') AND status NOT IN ('pending','blocked')");
  await run("UPDATE outbox SET status='expired',payload='{}' WHERE created_at < datetime('now','-7 days') AND status IN ('pending','blocked')");
  await run("DELETE FROM outbox WHERE created_at < datetime('now','-90 days')");
  await run("DELETE FROM write_receipts WHERE created_at < datetime('now','-30 days')");
}
