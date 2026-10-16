// one database serves all schools — every table carries school_id (multi-tenant day 1).
// local dev: file:./dev.db (no account needed). production: turso env vars.

import { config } from "./config.js";
import { buildDemoStructure, demoSchool } from "./seed.js";
import { hashPassword } from "./panel/password.js";

const nativeTest = process.env.DB_ADAPTER === "native";
if (nativeTest && config.tursoUrl) throw new Error("Native test database cannot use production credentials");
export const db = nativeTest
  ? (await import("./localDb.js")).localClient(process.env.TEST_DB_FILE || ":memory:")
  : (await import("@libsql/client")).createClient({ url: config.tursoUrl || (process.env.NODE_ENV === "test" ? "file:" + process.env.TEST_DB_FILE : "file:./dev.db"), authToken: config.tursoToken || undefined });

// whatsapp sends `from` as plain digits ("919876543210"). panel entries may
// come as "+91 98765 43210", "09876543210" or 10-digit — normalize everything to digits.
export function normalizeWaId(input) {
  let d = String(input || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1); // "09876543210" — common indian format
  if (d.length === 10) d = "91" + d; // india default for panel entries
  return d;
}

// school days run on IST — every "today" in the system comes from here, never UTC
export function todayIST(offsetDays = 0) {
  return new Date(Date.now() + 330 * 60 * 1000 + offsetDays * 86400000).toISOString().slice(0, 10);
}

// per-number language preference — separate from the parents table so unknown
// numbers get it too. en = english (default), hi = hindi (devanagari), hg = hinglish.
export async function getUserLang(schoolId, waId) {
  const row = (await db.execute({ sql: "SELECT lang FROM user_prefs WHERE school_id = ? AND wa_id = ?", args: [schoolId, waId] })).rows[0];
  return row ? String(row.lang) : null;
}

export async function setUserLang(schoolId, waId, lang) {
  await db.execute({
    sql: "INSERT INTO user_prefs (school_id, wa_id, lang) VALUES (?, ?, ?) ON CONFLICT (school_id, wa_id) DO UPDATE SET lang = excluded.lang",
    args: [schoolId, waId, lang],
  });
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS schools (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone_number_id TEXT UNIQUE,
    kb TEXT NOT NULL DEFAULT '',
    office_phone TEXT NOT NULL DEFAULT '',
    timings TEXT NOT NULL DEFAULT '',
    holidays TEXT NOT NULL DEFAULT '',
    notices TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id TEXT NOT NULL REFERENCES schools(id),
    name TEXT NOT NULL,
    UNIQUE (school_id, name)
  )`,
  // sections belong to a class and carry the class-teacher link (leave requests
  // land with the class teacher). custom names — "A", "Rose", whatever the school uses.
  `CREATE TABLE IF NOT EXISTS sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id TEXT NOT NULL REFERENCES schools(id),
    class_id INTEGER NOT NULL REFERENCES classes(id),
    name TEXT NOT NULL,
    class_teacher_id INTEGER,
    UNIQUE (school_id, class_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id TEXT NOT NULL REFERENCES schools(id),
    admission_no TEXT NOT NULL,
    name TEXT NOT NULL,
    class_id INTEGER REFERENCES classes(id),
    section_id INTEGER REFERENCES sections(id),
    roll_no TEXT NOT NULL DEFAULT '',
    attendance_pct INTEGER NOT NULL DEFAULT 0, -- preview until attendance data exists
    fees_due INTEGER NOT NULL DEFAULT 0, -- preview until phase 4
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (school_id, admission_no)
  )`,
  `CREATE TABLE IF NOT EXISTS parents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id TEXT NOT NULL REFERENCES schools(id),
    name TEXT NOT NULL,
    wa_id TEXT NOT NULL,
    confirmed INTEGER NOT NULL DEFAULT 0, -- imported parents unlock personal data only after replying YES
    opted_out INTEGER NOT NULL DEFAULT 0, -- STOP or "galat number" (NO) — suppress proactive msgs + confirm prompts
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (school_id, wa_id)
  )`,
  `CREATE TABLE IF NOT EXISTS parent_student (
    school_id TEXT NOT NULL,
    parent_id INTEGER NOT NULL REFERENCES parents(id),
    student_id INTEGER NOT NULL REFERENCES students(id),
    PRIMARY KEY (parent_id, student_id)
  )`,
  // teachers are whatsapp-only staff — no panel login. their number is the identity.
  // permissions are per-teacher, granted by the school admin in the panel.
  `CREATE TABLE IF NOT EXISTS teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id TEXT NOT NULL REFERENCES schools(id),
    name TEXT NOT NULL,
    wa_id TEXT NOT NULL,
    can_attendance INTEGER NOT NULL DEFAULT 1,
    can_marks INTEGER NOT NULL DEFAULT 1,
    can_marks_edit INTEGER NOT NULL DEFAULT 0, -- editing uploaded marks needs an explicit admin grant
    can_homework INTEGER NOT NULL DEFAULT 1,
    can_tests INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (school_id, wa_id)
  )`,
  `CREATE TABLE IF NOT EXISTS teacher_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id TEXT NOT NULL REFERENCES schools(id),
    teacher_id INTEGER NOT NULL REFERENCES teachers(id),
    section_id INTEGER NOT NULL REFERENCES sections(id),
    subject TEXT NOT NULL,
    UNIQUE (teacher_id, section_id, subject)
  )`,
  // multi-step whatsapp conversations (leave apply, attendance, marks upload...)
  `CREATE TABLE IF NOT EXISTS flow_sessions (
    school_id TEXT NOT NULL,
    wa_id TEXT NOT NULL,
    flow TEXT NOT NULL, -- leave | attendance | marks | marksedit | homework | testdate | lvreject
    step TEXT NOT NULL DEFAULT '',
    payload TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    PRIMARY KEY (school_id, wa_id)
  )`,
  // daily attendance — one row per student per day, re-marking updates in place
  `CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id TEXT NOT NULL,
    day TEXT NOT NULL, -- IST date YYYY-MM-DD
    section_id INTEGER NOT NULL REFERENCES sections(id),
    student_id INTEGER NOT NULL REFERENCES students(id),
    status TEXT NOT NULL, -- present | absent | leave
    marked_by INTEGER, -- teachers.id
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (school_id, day, student_id)
  )`,
  `CREATE TABLE IF NOT EXISTS leaves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id TEXT NOT NULL,
    student_id INTEGER NOT NULL REFERENCES students(id),
    day TEXT NOT NULL, -- IST date the leave is for
    type TEXT NOT NULL DEFAULT 'other', -- sick | other
    title TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
    teacher_note TEXT NOT NULL DEFAULT '',
    applied_by TEXT NOT NULL DEFAULT '', -- wa_id
    decided_by INTEGER, -- teachers.id
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    decided_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS marks_exams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id TEXT NOT NULL,
    section_id INTEGER NOT NULL REFERENCES sections(id),
    subject TEXT NOT NULL,
    name TEXT NOT NULL, -- "Weekly Test" etc
    total_marks REAL NOT NULL DEFAULT 0,
    uploaded_by INTEGER, -- teachers.id
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS marks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id TEXT NOT NULL,
    exam_id INTEGER NOT NULL REFERENCES marks_exams(id),
    student_id INTEGER NOT NULL REFERENCES students(id),
    marks REAL NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (exam_id, student_id)
  )`,
  `CREATE TABLE IF NOT EXISTS homework (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id TEXT NOT NULL,
    section_id INTEGER NOT NULL REFERENCES sections(id),
    subject TEXT NOT NULL,
    teacher_id INTEGER,
    text TEXT NOT NULL,
    day TEXT NOT NULL, -- IST
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id TEXT NOT NULL,
    section_id INTEGER NOT NULL REFERENCES sections(id),
    subject TEXT NOT NULL,
    name TEXT NOT NULL,
    test_date TEXT NOT NULL,
    created_by INTEGER, -- teachers.id
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // one official date sheet per school — text or pdf (pdf uploaded by the school
  // admin straight to the bot on whatsapp; no file hosting needed)
  `CREATE TABLE IF NOT EXISTS date_sheets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'text', -- text | pdf
    title TEXT NOT NULL DEFAULT 'Date Sheet',
    content TEXT NOT NULL DEFAULT '',
    pdf BLOB,
    pdf_name TEXT NOT NULL DEFAULT '',
    wa_media_id TEXT NOT NULL DEFAULT '', -- cached whatsapp upload id
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS staff_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id TEXT REFERENCES schools(id), -- null = superadmin (all schools)
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin', -- superadmin | admin
    wa_id TEXT NOT NULL DEFAULT '', -- optional: lets a school admin use the bot too
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    staff_id INTEGER NOT NULL REFERENCES staff_users(id),
    csrf TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS link_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id TEXT NOT NULL,
    wa_id TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT,
    resolved_by TEXT
  )`,
  // ai keys added from the superadmin panel — merged into the pool on boot;
  // add/disable/delete live without touching env vars (auto-created on boot)
  `CREATE TABLE IF NOT EXISTS ai_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    key TEXT NOT NULL,
    project TEXT NOT NULL DEFAULT '',
    base_url TEXT NOT NULL DEFAULT '', -- custom openai-compatible providers
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS user_prefs (
    school_id TEXT NOT NULL,
    wa_id TEXT NOT NULL,
    lang TEXT NOT NULL DEFAULT 'en', -- en (english, default) | hi (hindi) | hg (hinglish)
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (school_id, wa_id)
  )`,
  `CREATE TABLE IF NOT EXISTS message_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id TEXT NOT NULL,
    wa_id TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'in',
    intent TEXT,
    excerpt TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id TEXT NOT NULL,
    actor TEXT NOT NULL, -- wa_id or staff email
    action TEXT NOT NULL, -- personal_pull | personal_pull_denied | link_request_* | import_commit | panel_write | attendance_mark | marks_upload | ...
    details TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id, class_id)`,
  `CREATE INDEX IF NOT EXISTS idx_students_section ON students(school_id, section_id, roll_no)`,
  `CREATE INDEX IF NOT EXISTS idx_parents_wa ON parents(school_id, wa_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sections_school ON sections(school_id, class_id)`,
  `CREATE INDEX IF NOT EXISTS idx_teachers_wa ON teachers(school_id, wa_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tassign ON teacher_assignments(school_id, teacher_id)`,
  `CREATE INDEX IF NOT EXISTS idx_attendance_day ON attendance(school_id, day, section_id)`,
  `CREATE INDEX IF NOT EXISTS idx_leaves_school ON leaves(school_id, status, day)`,
  `CREATE INDEX IF NOT EXISTS idx_marks_exam ON marks(school_id, exam_id)`,
  `CREATE INDEX IF NOT EXISTS idx_exams_section ON marks_exams(school_id, section_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_homework_day ON homework(school_id, day, section_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tests_date ON tests(school_id, section_id, test_date)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_msglog_school ON message_log(school_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_school ON audit_log(school_id, created_at)`,
];

// existing databases get the new columns here — "duplicate column" errors mean
// the column already exists and are safely ignored.
const MIGRATIONS = [
  "ALTER TABLE schools ADD COLUMN office_phone TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE schools ADD COLUMN timings TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE schools ADD COLUMN holidays TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE schools ADD COLUMN notices TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE parents ADD COLUMN opted_out INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE students ADD COLUMN roll_no TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE students ADD COLUMN section_id INTEGER",
  "ALTER TABLE staff_users ADD COLUMN wa_id TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE schools ADD COLUMN features TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE schools ADD COLUMN menu_config TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE schools ADD COLUMN present_notify INTEGER NOT NULL DEFAULT 0",
];

async function seedIfEmpty() {
  const count = Number((await db.execute("SELECT COUNT(*) AS n FROM schools")).rows[0].n);
  if (count > 0) return;
  console.log("[db] empty database — seeding demo school");

  await db.execute({
    sql: "INSERT INTO schools (id, name, phone_number_id, kb, office_phone, timings, holidays, notices) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [demoSchool.id, demoSchool.name, demoSchool.phoneNumberId || null, demoSchool.kb, demoSchool.officePhone, demoSchool.timings, demoSchool.holidays, demoSchool.notices],
  });

  // demo structure: classes 1-10 × sections A/B, 40 students with roll numbers
  const demo = buildDemoStructure();
  const classIds = new Map();
  for (const name of demo.classes) {
    await db.execute({ sql: "INSERT OR IGNORE INTO classes (school_id, name) VALUES (?, ?)", args: [demoSchool.id, name] });
    const row = (await db.execute({ sql: "SELECT id FROM classes WHERE school_id = ? AND name = ?", args: [demoSchool.id, name] })).rows[0];
    classIds.set(name, Number(row.id));
  }
  const sectionIds = new Map(); // "5|A" -> section id
  for (const sec of demo.sections) {
    const cid = classIds.get(sec.className);
    await db.execute({ sql: "INSERT OR IGNORE INTO sections (school_id, class_id, name) VALUES (?, ?, ?)", args: [demoSchool.id, cid, sec.name] });
    const row = (await db.execute({ sql: "SELECT id FROM sections WHERE school_id = ? AND class_id = ? AND name = ?", args: [demoSchool.id, cid, sec.name] })).rows[0];
    sectionIds.set(sec.className + "|" + sec.name, Number(row.id));
  }
  await db.batch(
    demo.students.map((s) => ({
      sql: "INSERT INTO students (school_id, admission_no, name, class_id, section_id, roll_no, attendance_pct, fees_due) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      args: [
        demoSchool.id,
        s.id,
        s.name,
        classIds.get(s.className),
        sectionIds.get(s.className + "|" + s.sectionName),
        s.rollNo,
        s.attendancePct,
        s.feesDue,
      ],
    })),
    "write"
  );

  // demo parents: real phone numbers from env so ashu can test personal pulls from his own phone.
  // first demo parent gets two kids — tests the multi-child path.
  const demoNumbers = config.demoParentNumbers.split(",").map((n) => normalizeWaId(n)).filter(Boolean);
  for (let i = 0; i < demoNumbers.length && i < demo.students.length; i++) {
    await db.execute({
      sql: "INSERT OR IGNORE INTO parents (school_id, name, wa_id, confirmed) VALUES (?, ?, ?, 1)",
      args: [demoSchool.id, "Demo Parent " + (i + 1), demoNumbers[i]],
    });
    const parent = (await db.execute({ sql: "SELECT id FROM parents WHERE school_id = ? AND wa_id = ?", args: [demoSchool.id, demoNumbers[i]] })).rows[0];
    if (!parent) continue;
    const pid = Number(parent.id);
    const links = [
      { sql: "INSERT OR IGNORE INTO parent_student (school_id, parent_id, student_id) VALUES (?, ?, (SELECT id FROM students WHERE school_id = ? AND admission_no = ?))", args: [demoSchool.id, pid, demoSchool.id, demo.students[i].id] },
    ];
    if (i === 0 && demo.students.length > 1) {
      links.push({ sql: "INSERT OR IGNORE INTO parent_student (school_id, parent_id, student_id) VALUES (?, ?, (SELECT id FROM students WHERE school_id = ? AND admission_no = ?))", args: [demoSchool.id, pid, demoSchool.id, demo.students[1].id] });
    }
    await db.batch(links, "write");
  }

  if (config.superEmail && config.superPassword) {
    await db.execute({
      sql: "INSERT OR IGNORE INTO staff_users (school_id, name, email, password_hash, role, wa_id) VALUES (NULL, ?, ?, ?, 'superadmin', '')",
      args: ["Ashu (Owner)", config.superEmail.toLowerCase(), hashPassword(config.superPassword)],
    });
  }
  if (config.demoAdminEmail && config.demoAdminPassword) {
    await db.execute({
      sql: "INSERT OR IGNORE INTO staff_users (school_id, name, email, password_hash, role, wa_id) VALUES (?, ?, ?, ?, 'admin', ?)",
      args: [demoSchool.id, "Demo School Admin", config.demoAdminEmail.toLowerCase(), hashPassword(config.demoAdminPassword), normalizeWaId(config.demoAdminWaId)],
    });
  }

  // demo teacher: one real whatsapp number from env tests every teacher flow
  const teacherWa = normalizeWaId(config.demoTeacherNumber);
  if (teacherWa) {
    await db.execute({
      sql: "INSERT OR IGNORE INTO teachers (school_id, name, wa_id, can_attendance, can_marks, can_marks_edit, can_homework, can_tests) VALUES (?, ?, ?, 1, 1, 1, 1, 1)",
      args: [demoSchool.id, "Demo Teacher", teacherWa],
    });
    const t = (await db.execute({ sql: "SELECT id FROM teachers WHERE school_id = ? AND wa_id = ?", args: [demoSchool.id, teacherWa] })).rows[0];
    if (t) {
      const tid = Number(t.id);
      // class teacher of the first two sections (leave requests land here) +
      // subject assignments on the first three (attendance/marks/homework/tests)
      const secs = demo.sections.slice(0, 3);
      for (let i = 0; i < secs.length; i++) {
        const sid = sectionIds.get(secs[i].className + "|" + secs[i].name);
        if (i < 2) await db.execute({ sql: "UPDATE sections SET class_teacher_id = ? WHERE id = ?", args: [tid, sid] });
        await db.execute({
          sql: "INSERT OR IGNORE INTO teacher_assignments (school_id, teacher_id, section_id, subject) VALUES (?, ?, ?, ?)",
          args: [demoSchool.id, tid, sid, "Maths"],
        });
      }
    }
  }

  // demo content so date sheet / homework / marks pulls show something on day 1
  const firstSection = sectionIds.get("1|A");
  if (firstSection) {
    await db.execute({
      sql: "INSERT INTO date_sheets (school_id, kind, title, content) VALUES (?, 'text', ?, ?)",
      args: [demoSchool.id, "Unit Test 2 — Date Sheet", "Unit Test 2 (Classes 1-10)\n12 Sep — Maths\n13 Sep — English\n15 Sep — Science\n16 Sep — Hindi\n17 Sep — Social Science"],
    });
    await db.execute({
      sql: "INSERT INTO homework (school_id, section_id, subject, teacher_id, text, day) VALUES (?, ?, 'Maths', NULL, ?, ?)",
      args: [demoSchool.id, firstSection, "Chapter 4 — Exercise 4.1, questions 1 to 10.", todayIST()],
    });
    await db.execute({
      sql: "INSERT INTO tests (school_id, section_id, subject, name, test_date, created_by) VALUES (?, ?, 'Maths', ?, ?, NULL)",
      args: [demoSchool.id, firstSection, "Maths Weekly Test", todayIST(6)],
    });
    const kids = (await db.execute({ sql: "SELECT id FROM students WHERE school_id = ? AND section_id = ?", args: [demoSchool.id, firstSection] })).rows;
    if (kids.length) {
      const ex = await db.execute({
        sql: "INSERT INTO marks_exams (school_id, section_id, subject, name, total_marks, uploaded_by) VALUES (?, ?, 'Maths', 'Weekly Test 1', 50, NULL)",
        args: [demoSchool.id, firstSection],
      });
      const examId = Number(ex.lastInsertRowid);
      await db.batch(
        kids.map((k, i) => ({
          sql: "INSERT INTO marks (school_id, exam_id, student_id, marks) VALUES (?, ?, ?, ?)",
          args: [demoSchool.id, examId, Number(k.id), Math.min(50, 38 + i * 3)],
        })),
        "write"
      );
    }
  }
}

/**
 * Boot the database: WAL journaling for local dev files, create tables, run
 * idempotent column migrations (re-runs are safe — "duplicate column" errors
 * are swallowed), apply package migrations, then create indexes. Demo data is
 * seeded only when the database is empty.
 */
export async function initDb() {
  try {
    await db.execute("PRAGMA journal_mode=WAL"); // local file only — turso remote doesn't need it
  } catch {
    /* remote turso ignores/errors on this — safe to skip */
  }
  for (const stmt of SCHEMA.filter(x => !/^CREATE (UNIQUE )?INDEX/i.test(x.trim()))) await db.execute(stmt);
  for (const stmt of MIGRATIONS) {
    try {
      await db.execute(stmt);
    } catch (err) {
      if (!/duplicate column/i.test(String(err.message))) throw err;
    }
  }
  await import("./migrations.js").then(m => m.migrate(db));
  for (const stmt of SCHEMA.filter(x => /^CREATE (UNIQUE )?INDEX/i.test(x.trim()))) await db.execute(stmt);
  if (process.env.SKIP_DEMO_SEED !== "1") await seedIfEmpty();
}

/**
 * Append one audit-trail row (school, actor, action, first 500 chars of details).
 * Fail-safe by design: a logging failure is printed to console but never throws,
 * so auditing can never break the flow it is recording.
 */
export async function audit(schoolId, actor, action, details = "") {
  try {
    await db.execute({
      sql: "INSERT INTO audit_log (school_id, actor, action, details) VALUES (?, ?, ?, ?)",
      args: [schoolId, String(actor), action, String(details).slice(0, 500)],
    });
  } catch (err) {
    console.error("[audit] failed:", err.message);
  }
}

/**
 * Record that an inbound message arrived. Only the intent classification is
 * stored — the message body is intentionally never persisted, so this log
 * cannot leak conversation content. Fail-safe like audit().
 */
export async function logMessage(schoolId, waId, intent, text) {
  try {
    await db.execute({
      sql: "INSERT INTO message_log (school_id, wa_id, intent, excerpt) VALUES (?, ?, ?, ?)",
      args: [schoolId, waId, intent || null, ""],
    });
  } catch (err) {
    console.error("[msglog] failed:", err.message);
  }
}

// dpdp retention: logs auto-purge after 90 days (runs on boot + daily)
/**
 * Retention cleanup (DPDP alignment): message_log and audit_log rows older than
 * `days` are dropped; resolved link requests share the same window (wa_id +
 * child name are personal data); expired panel and flow sessions are swept.
 * Pending link requests are kept regardless of age. Fail-safe like audit().
 */
export async function purgeOldLogs(days = 90) {
  try {
    for (const t of ["message_log", "audit_log"]) {
      await db.execute({ sql: "DELETE FROM " + t + " WHERE created_at < datetime('now', ?)", args: ["-" + days + " days"] });
    }
    // resolved link requests carry wa_id + child name — same retention window
    await db.execute({ sql: "DELETE FROM link_requests WHERE status != 'pending' AND created_at < datetime('now', ?)", args: ["-" + days + " days"] });
    // expired sessions used to pile up forever (they were only deleted on reuse)
    await db.execute("DELETE FROM sessions WHERE expires_at < datetime('now')");
    await db.execute("DELETE FROM flow_sessions WHERE expires_at < datetime('now')");
  } catch (err) {
    console.error("[purge] failed:", err.message);
  }
}
