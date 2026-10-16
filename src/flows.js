// Multi-step conversation state: stores per-user flow sessions with a 10-minute TTL and a
// random nonce per session. The nonce binds button action ids via actionId()/readAction()
// so stale or forged button ids cannot resume the wrong step; backStep()/applyBack()
// implement the universal Back option over the last 12 visited steps.
// NOTE: the 10-minute TTL lives in TWO places — TTL_MS below (kept for callers/tests)
// and the datetime('now','+10 minutes') inside setFlow's upsert. The SQL side is the
// authoritative one; keep both in sync if the TTL ever changes.
import crypto from 'node:crypto';
import { db } from './db.js';
export const TTL_MS = 10 * 60 * 1000;
// getFlow returns the live session or null. Sessions past expires_at (stored as
// "YYYY-MM-DD HH:MM:SS", compared as UTC) are deleted on read; a corrupt payload
// is treated as a missing session too, so callers never see half-state.
export async function getFlow(schoolId, waId) {
  const row = (await db.execute({ sql:'SELECT * FROM flow_sessions WHERE school_id=? AND wa_id=?', args:[schoolId,waId] })).rows[0];
  if (!row) return null;
  if (Date.parse(String(row.expires_at).replace(' ','T') + 'Z') <= Date.now()) { await clearFlow(schoolId,waId); return null; }
  try { return {flow:row.flow,step:row.step,data:JSON.parse(row.payload),nonce:row.nonce,revision:Number(row.revision)}; }
  catch { await clearFlow(schoolId,waId); return null; }
}
export async function setFlow(schoolId,waId,flow,step,data={}) {
  const payload=JSON.stringify(data);
  if (Buffer.byteLength(payload)>240000) throw new Error('Flow is too large. Split the upload into smaller batches.');
  const nonce=crypto.randomBytes(8).toString('hex');
  await db.execute({sql:`INSERT INTO flow_sessions(school_id,wa_id,flow,step,payload,expires_at,nonce)
    VALUES(?,?,?,?,?,datetime('now','+10 minutes'),?) ON CONFLICT(school_id,wa_id) DO UPDATE SET
    flow=excluded.flow, step=excluded.step, payload=excluded.payload, nonce=excluded.nonce,
    revision=flow_sessions.revision+1, updated_at=datetime('now'), expires_at=excluded.expires_at`,args:[schoolId,waId,flow,step,payload,nonce]});
  return { flow,step,data,nonce };
}
export async function advanceFlow(schoolId,waId,flow,step,data) {
  const old=await getFlow(schoolId,waId);
  const hist=old?.data?._hist || [];
  const clean={...old?.data}; delete clean._hist;
  return setFlow(schoolId,waId,flow,step,{...data,_hist:[...hist,{step:old?.step||'',data:clean}].slice(-12)});
}
// Back-step support: advanceFlow keeps the last 12 visited steps (as _hist) so a user can
// undo one screen; backStep pops the newest entry and returns the previous step+data.
// actionId/readAction bind button callbacks to the flow's per-session nonce so a forged or
// stale button id from an older session is rejected instead of resuming the wrong step.
export function backStep(data) {
  const hist=[...(data._hist||[])]; const prev=hist.pop();
  return prev ? {step:prev.step,data:{...prev.data,_hist:hist}} : null;
}
export async function applyBack(schoolId,waId,flow,data) {
  const prev=backStep(data);
  if (!prev) { await clearFlow(schoolId,waId); return null; }
  return setFlow(schoolId,waId,flow,prev.step,prev.data);
}
export async function clearFlow(schoolId,waId) { await db.execute({sql:'DELETE FROM flow_sessions WHERE school_id=? AND wa_id=?',args:[schoolId,waId]}); }
export const actionId=(state,action)=>'f:'+state.nonce+':'+action;
export function readAction(state,id) { const prefix='f:'+state.nonce+':'; return typeof id==='string' && id.startsWith(prefix) ? id.slice(prefix.length) : null; }
