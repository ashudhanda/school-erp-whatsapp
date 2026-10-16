// Staff panel auth: server-side sessions in the sessions table, carried by an
// HttpOnly cookie (panel_session, Path=/panel, SameSite=Lax). Sessions live
// 12 hours (HOURS) and are validated against the staff user's active state and
// their school's active state on every request (getSession), so disabling a
// user or school kills the session immediately. Each session also carries its
// own CSRF token (csrf), checked by checkCsrf on every mutating form POST with
// a timing-safe comparison. Only active superadmins and active admins of
// active schools can hold a session.
import crypto from 'node:crypto';
import { db } from '../db.js';
const HOURS=12,COOKIE='panel_session';
/**
 * Create a new panel session for a staff member.
 * Fails when the user is not an active superadmin or an active admin of an
 * active school. Mints a 32-byte session token and a 16-byte CSRF token and
 * stores them with a 12-hour expiry (see HOURS).
 * @param {number} staffId - staff_users row id
 * @returns {Promise<{token: string, csrf: string}>} cookie token + form CSRF token
 * @throws {Error} when the staff member may not access the panel
 */
export async function createSession(staffId) {
  const user=(await db.execute({sql:`SELECT u.id FROM staff_users u LEFT JOIN schools s ON s.id=u.school_id WHERE u.id=? AND u.active=1 AND (u.role='superadmin' OR (u.role='admin' AND s.active=1))`,args:[staffId]})).rows[0];
  if(!user)throw new Error('Panel access is restricted to active school admins and superadmins.');
  const token=crypto.randomBytes(32).toString('hex'),csrf=crypto.randomBytes(16).toString('hex');
  await db.execute({sql:"INSERT INTO sessions(token,staff_id,csrf,expires_at) VALUES(?,?,?,datetime('now','+12 hours'))",args:[token,staffId,csrf]});return {token,csrf};
}
export const destroySession=token=>db.execute({sql:'DELETE FROM sessions WHERE token=?',args:[token]});
export async function getSession(req) {
  const m=/(?:^|;\s*)panel_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'');if(!m)return null;
  const row=(await db.execute({sql:`SELECT se.token,se.csrf,se.expires_at,u.id AS staff_id,u.name,u.email,u.role,u.school_id,u.active,s.active AS school_active
    FROM sessions se JOIN staff_users u ON u.id=se.staff_id LEFT JOIN schools s ON s.id=u.school_id WHERE se.token=?`,args:[m[1]]})).rows[0];
  if(!row)return null;
  if(!row.active||!['admin','superadmin'].includes(row.role)||(row.role==='admin'&&!row.school_active)||Date.parse(row.expires_at.replace(' ','T')+'Z')<=Date.now()) {await destroySession(m[1]);return null;}
  return row;
}
export function sessionCookieHeader(req,token) {return COOKIE+'='+token+'; HttpOnly; SameSite=Lax; Path=/panel; Max-Age='+HOURS*3600+(req.secure||process.env.NODE_ENV==='production'?'; Secure':'');}
export const clearCookieHeader=()=>COOKIE+'=; HttpOnly; SameSite=Lax; Path=/panel; Max-Age=0';
// In-memory login rate limiter. Keys are per-email|ip plus per-ip (see routes.js).
// 5 failed attempts lock a key out for 10 minutes; a success clears it. Stale entries
// (unseen for an hour) are pruned on write and the map is hard-capped at 10k keys, so a
// credential-stuffing wave can't grow memory unbounded. Single process only — fine at
// this scale, but a multi-worker deploy would need a shared store.
const attempts=new Map();
export function loginLocked(key) {return (attempts.get(key)?.until||0)>Date.now();}
export function loginFailed(key) {for(const [k,a]of attempts)if(a.seen<Date.now()-3600000)attempts.delete(k);if(attempts.size>10000)attempts.delete(attempts.keys().next().value);const a=attempts.get(key)||{n:0,until:0};a.n++;a.seen=Date.now();if(a.n>=5){a.until=Date.now()+600000;a.n=0;}attempts.set(key,a);}
export const loginSucceeded=key=>attempts.delete(key);
export async function requireAuth(req,res,next) {try {const session=await getSession(req);if(!session)return res.redirect('/panel/login');req.user=session;req.csrfToken=session.csrf;next();}catch(e){next(e);}}
export const requireRole=(...roles)=>(req,res,next)=>roles.includes(req.user?.role)?next():res.status(403).send('This action is not allowed for your role.');
export function checkCsrf(req,res,next) {
  const received=Buffer.from(String(req.body?._csrf||'')),expected=Buffer.from(String(req.csrfToken||''));
  if(!req.user||!expected.length||received.length!==expected.length||!crypto.timingSafeEqual(received,expected))return res.status(403).send('Invalid or expired form token. Go back and retry.');next();
}
