// Password hashing for staff-panel accounts (panel/auth.js).
// Scheme "s1": a fresh 16-byte random salt plus Node scrypt (N=16384, r=8, p=1,
// 64-byte digest), stored as `s1$<salt hex>$<digest hex>`. Verification is
// constant-time and never throws — anything that is not exactly this shape
// (wrong version, bad hex, wrong field count, corrupted value) simply returns
// false, so a foreign or mangled hash can never lock the panel out.
import crypto from 'node:crypto';

/**
 * Hash a cleartext password for storage. Each call generates a fresh salt, so
 * two identical passwords never produce the same stored value.
 * @param {string} password - the cleartext password
 * @returns {string} `s1$<salt hex>$<digest hex>`
 */
export function hashPassword(password) { const salt=crypto.randomBytes(16).toString('hex'); return 's1$'+salt+'$'+crypto.scryptSync(String(password),salt,64,{N:16384,r:8,p:1}).toString('hex'); }

/**
 * Check a cleartext candidate against a stored hash. Never throws; malformed
 * input just returns false.
 * @param {string} password - the cleartext candidate
 * @param {string} stored - value previously produced by hashPassword
 * @returns {boolean} true on match, false otherwise
 */
export function verifyPassword(password,stored) { try { const [version,salt,digest]=String(stored).split('$'); if(version!=='s1'||!/^[a-f0-9]{32}$/.test(salt)||!/^[a-f0-9]{128}$/.test(digest)) return false; return crypto.timingSafeEqual(crypto.scryptSync(String(password),salt,64,{N:16384,r:8,p:1}),Buffer.from(digest,'hex')); } catch { return false; } }
