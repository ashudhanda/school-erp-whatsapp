import { db } from "./db.js";
import { config } from "./config.js";
import { sendAlert } from "./alerts.js";

// phone_number_id -> school, db-backed with a small cache (multi-tenant routing).
const cache = new Map();
const alertedUnknown = new Set(); // one telegram alert per unknown id per boot

// which modules a school has — the superadmin toggles these in Panel → Schools,
// no code changes needed to onboard or reshape a school
export const DEFAULT_FEATURES = {
  attendance: true,
  marks: true,
  fees: true,
  homework: true,
  datesheet: true,
  leave: true,
  notices: true,
};

function parseSchool(row) {
  const features = { ...DEFAULT_FEATURES };
  try {
    if (row.features) Object.assign(features, JSON.parse(row.features));
  } catch {
    /* bad json = defaults */
  }
  let menuConfig = null; // { rows: [ids] } — the school admin's parent-menu layout
  try {
    if (row.menu_config) menuConfig = JSON.parse(row.menu_config);
  } catch {
    menuConfig = null;
  }
  return {
    id: row.id,
    name: row.name,
    phoneNumberId: row.phone_number_id,
    kb: row.kb,
    officePhone: row.office_phone || "",
    timings: row.timings || "",
    holidays: row.holidays || "",
    notices: row.notices || "",
    features,
    menuConfig,
    // present confirmations cost a push per child per day — default OFF (absent alerts stay ON)
    presentNotify: Number(row.present_notify || 0) === 1,
  };
}

export async function schoolForPhoneNumberId(phoneNumberId) {
  const key = String(phoneNumberId || "");
  if (cache.has(key)) return cache.get(key);

  let row = (
    await db.execute({
      sql: "SELECT * FROM schools WHERE phone_number_id = ? AND active = 1",
      args: [key],
    })
  ).rows[0];

  // demo fallback ONLY for the configured demo number — a real school's traffic
  // must never silently get demo data (fix H2)
  if (!row && key && key === config.demoPhoneNumberId) {
    row = (await db.execute({ sql: "SELECT * FROM schools WHERE id = ?", args: ["demo-public-school"] })).rows[0];
  }

  if (!row) {
    if (key && !alertedUnknown.has(key)) {
      alertedUnknown.add(key);
      sendAlert('🚨 WhatsApp message from UNKNOWN phone_number_id "' + key + '" — no school is mapped to it. Set it in Panel → Schools.').catch(() => {});
    }
    return null; // router replies with a generic "setup pending" message
  }

  const school = parseSchool(row);
  cache.set(key, school);
  return school;
}

// used by flows that need a school but only have its id (e.g. leave decisions)
export async function schoolById(schoolId) {
  const row = (await db.execute({ sql: "SELECT * FROM schools WHERE id = ? AND active = 1", args: [schoolId] })).rows[0];
  return row ? parseSchool(row) : null;
}

// panel edits to schools call this so the next message picks up fresh data
export function clearSchoolCache() {
  cache.clear();
}
