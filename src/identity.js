// THE privacy hard rule lives here — in code, never in the ai.
// Personal views are deterministic. Opt-in photo extraction sends the actual image to an approved AI provider.
// unmatched numbers get public info only — we don't even confirm a student exists.
import { db, audit } from "./db.js";

// returns { parent, students, confirmed, optedOut } for a registered number, otherwise null.
// unconfirmed parents get an EMPTY students list — no child data (not even names) leaks before the YES confirm.
export async function resolveIdentity(schoolId, waId) {
  const p = await db.execute({
    sql: "SELECT * FROM parents WHERE school_id = ? AND wa_id = ?",
    args: [schoolId, waId],
  });
  const parent = p.rows[0];
  if (!parent) return null;
  if (!parent.confirmed) return {parent,students:[],confirmed:false,optedOut:!!parent.opted_out};

  const kids = await db.execute({
    sql: `SELECT s.*, c.name AS class_name, sec.name AS section_name
          FROM parent_student ps
          JOIN students s ON s.id = ps.student_id AND s.school_id=ps.school_id AND s.active = 1
          LEFT JOIN classes c ON c.id = s.class_id AND c.school_id=s.school_id
          LEFT JOIN sections sec ON sec.id = s.section_id AND sec.school_id=s.school_id
          WHERE ps.school_id = ? AND ps.parent_id = ?`,
    args: [schoolId, parent.id],
  });
  return { parent, students: kids.rows, confirmed: !!parent.confirmed, optedOut: !!parent.opted_out };
}

// "5 A" style label for a kid's class-section
export function kidClassLabel(student) {
  const c = String(student.class_name || "").trim();
  const s = String(student.section_name || "").trim();
  return (c + " " + s).trim();
}

// per-number daily caps, in memory (single render instance — fine at this scale).
// security layer 4: rate limiting. keys are school-scoped, and stale entries get
// pruned so the map never grows unbounded (fix M9).
function makeLimiter(max) {
  const hits = new Map();
  return (schoolId, waId) => {
    const day = new Date().toISOString().slice(0, 10);
    const key = schoolId + "|" + waId;
    const h = hits.get(key);
    if (!h || h.day !== day) {
      if (hits.size > 5000) {
        for (const [k, v] of hits) if (v.day !== day) hits.delete(k);
      }
      hits.set(key, { day, n: 1 });
      return false;
    }
    h.n += 1;
    return h.n > max;
  };
}

export const pullRateLimited = makeLimiter(30); // personal pulls per number per day
export const linkRateLimited = makeLimiter(3); // link requests per number per day

// imported parents unlock personal data only after confirming on whatsapp (reply YES).
// YES also clears any earlier opt-out/deny.
export async function confirmParent(schoolId, waId) {
  await db.execute({
    sql: "UPDATE parents SET confirmed = 1, opted_out = 0 WHERE school_id = ? AND wa_id = ?",
    args: [schoolId, waId],
  });
  await audit(schoolId, waId, "parent_confirmed", "");
}

// unconfirmed number replied NO ("galat number") — never re-prompt, treat as unknown (fix M5).
export async function denyParent(schoolId, waId) {
  await db.execute({
    sql: "UPDATE parents SET opted_out = 1 WHERE school_id = ? AND wa_id = ?",
    args: [schoolId, waId],
  });
  await audit(schoolId, waId, "parent_denied", "unconfirmed number replied NO");
}

// STOP / START — persisted so proactive messages have a real suppression list (fix M4).
export async function setOptOut(schoolId, waId, optedOut) {
  const r = await db.execute({
    sql: "UPDATE parents SET opted_out = ? WHERE school_id = ? AND wa_id = ?",
    args: [optedOut ? 1 : 0, schoolId, waId],
  });
  if (r.rowsAffected) await audit(schoolId, waId, optedOut ? "opt_out" : "opt_in", "");
  return r.rowsAffected > 0;
}

export async function createLinkRequest(schoolId, waId, note) {
  // one pending request per number — repeat LINKs update the note instead of piling up
  const existing = (
    await db.execute({
      sql: "SELECT id FROM link_requests WHERE school_id = ? AND wa_id = ? AND status = 'pending'",
      args: [schoolId, waId],
    })
  ).rows[0];
  if (existing) {
    await db.execute({
      sql: "UPDATE link_requests SET note = ?, created_at = datetime('now') WHERE id = ?",
      args: [note, Number(existing.id)],
    });
    await audit(schoolId, waId, "link_request_updated", note);
    return;
  }
  await db.execute({
    sql: "INSERT INTO link_requests (school_id, wa_id, note) VALUES (?, ?, ?)",
    args: [schoolId, waId, note],
  });
  await audit(schoolId, waId, "link_request_created", note);
}
