/**
 * Run all schema migrations. Idempotent: safe to call on every boot because
 * every step is guarded — new columns are added only when PRAGMA table_info
 * shows them missing, tables/indexes use CREATE ... IF NOT EXISTS, and the
 * tenant_* triggers are created with CREATE TRIGGER IF NOT EXISTS. The last
 * statement is a cleanup sweep: any sessions still belonging to staff rows
 * with role='teacher' are deleted, so teachers never hold panel sessions.
 * @param {object} db - database client with an execute() method
 */
export async function migrate(db) {
  const columns = {
    ai_keys: {vision: 'INTEGER NOT NULL DEFAULT 0'},
    classes: { active: 'INTEGER NOT NULL DEFAULT 1' },
    sections: { active: 'INTEGER NOT NULL DEFAULT 1' },
    teachers: { opted_out: 'INTEGER NOT NULL DEFAULT 0' },
    attendance: { updated_at: 'TEXT', revision: 'INTEGER NOT NULL DEFAULT 1' },
    marks_exams: { revision: 'INTEGER NOT NULL DEFAULT 1', test_date: "TEXT NOT NULL DEFAULT ''" },
    leaves: { section_id: 'INTEGER', version: 'INTEGER NOT NULL DEFAULT 1' },
    user_prefs: { active_role: "TEXT NOT NULL DEFAULT ''", last_inbound: 'INTEGER NOT NULL DEFAULT 0', opted_out: 'INTEGER NOT NULL DEFAULT 0' },
    flow_sessions: { nonce: "TEXT NOT NULL DEFAULT ''", revision: 'INTEGER NOT NULL DEFAULT 1' },
    schools: { settings: "TEXT NOT NULL DEFAULT '{}'", config_version: 'INTEGER NOT NULL DEFAULT 1' },
    date_sheets: { section_id: 'INTEGER', active: 'INTEGER NOT NULL DEFAULT 1', mime_type: "TEXT NOT NULL DEFAULT 'application/pdf'" }
  };
  for (const [table, cols] of Object.entries(columns)) {
    const found = new Set((await db.execute('PRAGMA table_info(' + table + ')')).rows.map(r => r.name));
    for (const [name, type] of Object.entries(cols)) {
      if (!found.has(name)) await db.execute('ALTER TABLE ' + table + ' ADD COLUMN ' + name + ' ' + type);
    }
  }
  const schema = [
    `CREATE TABLE IF NOT EXISTS student_accounts (
      id INTEGER PRIMARY KEY, school_id TEXT NOT NULL, student_id INTEGER NOT NULL,
      wa_id TEXT NOT NULL, age_eligible INTEGER NOT NULL DEFAULT 0, consent_verified INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1, UNIQUE(school_id, student_id, wa_id))`,
    `CREATE TABLE IF NOT EXISTS write_receipts (school_id TEXT NOT NULL, token TEXT NOT NULL, result TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(school_id,token))`,
    `CREATE TABLE IF NOT EXISTS inbox (school_id TEXT NOT NULL, message_id TEXT NOT NULL, wa_id TEXT NOT NULL,
      phone_number_id TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(school_id,message_id))`,
    `CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY, school_id TEXT NOT NULL, wa_id TEXT NOT NULL,
      kind TEXT NOT NULL, reference_id INTEGER, payload TEXT NOT NULL, dedupe_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL DEFAULT 0,
      provider_id TEXT, error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(school_id,dedupe_key))`,
    `CREATE TABLE IF NOT EXISTS import_jobs (id TEXT PRIMARY KEY, school_id TEXT NOT NULL, staff_id INTEGER NOT NULL,
      payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'preview', expires_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS school_events (id INTEGER PRIMARY KEY, school_id TEXT NOT NULL, name TEXT NOT NULL,
      event_date TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('event','holiday')), details TEXT NOT NULL DEFAULT '')`,
    `CREATE TABLE IF NOT EXISTS ai_usage (school_id TEXT NOT NULL, day TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(school_id,day))`,
    `CREATE INDEX IF NOT EXISTS idx_inbox_pending ON inbox(status,available_at)`,
    `CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox(status,available_at)`,
    `CREATE INDEX IF NOT EXISTS idx_flow_exp ON flow_sessions(expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_student_account_wa ON student_accounts(school_id,wa_id)`,
    `CREATE INDEX IF NOT EXISTS idx_parent_links ON parent_student(school_id,parent_id,student_id)`,
    `CREATE INDEX IF NOT EXISTS idx_staff_wa ON staff_users(school_id,wa_id)`,
    `CREATE INDEX IF NOT EXISTS idx_leave_student ON leaves(school_id,student_id,day,status)`
  ];
  for (const sql of schema) await db.execute(sql);
  // Reject invalid cross-school relationships even through legacy panel endpoints.
  for (const [table, checks] of Object.entries({
    students: ["NEW.class_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM classes WHERE id=NEW.class_id AND school_id=NEW.school_id)",
      "NEW.section_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sections WHERE id=NEW.section_id AND school_id=NEW.school_id AND class_id=NEW.class_id)",
      "NEW.roll_no != '' AND NEW.section_id IS NOT NULL AND EXISTS (SELECT 1 FROM students WHERE school_id=NEW.school_id AND section_id=NEW.section_id AND roll_no=NEW.roll_no AND id!=COALESCE(NEW.id,-1) AND active=1)"],
    sections: ["NOT EXISTS (SELECT 1 FROM classes WHERE id=NEW.class_id AND school_id=NEW.school_id)",
      "NEW.class_teacher_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM teachers WHERE id=NEW.class_teacher_id AND school_id=NEW.school_id)"],
    parent_student: ["NOT EXISTS (SELECT 1 FROM parents WHERE id=NEW.parent_id AND school_id=NEW.school_id)",
      "NOT EXISTS (SELECT 1 FROM students WHERE id=NEW.student_id AND school_id=NEW.school_id)"],
    teacher_assignments: ["NOT EXISTS (SELECT 1 FROM teachers WHERE id=NEW.teacher_id AND school_id=NEW.school_id)",
      "NOT EXISTS (SELECT 1 FROM sections WHERE id=NEW.section_id AND school_id=NEW.school_id)"],
    marks: ["NOT EXISTS (SELECT 1 FROM marks_exams e JOIN students s ON s.id=NEW.student_id AND s.school_id=e.school_id AND s.section_id=e.section_id WHERE e.id=NEW.exam_id AND e.school_id=NEW.school_id)"],
    attendance: ["NOT EXISTS (SELECT 1 FROM students WHERE id=NEW.student_id AND school_id=NEW.school_id AND section_id=NEW.section_id)",
      "NEW.status NOT IN ('present','absent','leave')"],
    student_accounts: ["NOT EXISTS (SELECT 1 FROM students WHERE id=NEW.student_id AND school_id=NEW.school_id)"]
  })) {
    for (const op of ['INSERT','UPDATE']) {
      await db.execute('CREATE TRIGGER IF NOT EXISTS tenant_' + table + '_' + op + ' BEFORE ' + op + ' ON ' + table +
        ' WHEN ' + checks.map(s => '(' + s + ')').join(' OR ') + " BEGIN SELECT RAISE(ABORT,'Invalid school relationship or duplicate roll number'); END");
    }
  }
  await db.execute("DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff_users WHERE role='teacher')");
}
