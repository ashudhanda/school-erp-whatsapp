import test from 'node:test';
import assert from 'node:assert/strict';
import {db,initDb} from '../src/db.js';
await db.execute(`CREATE TABLE schools(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone_number_id TEXT UNIQUE,kb TEXT NOT NULL DEFAULT '',office_phone TEXT NOT NULL DEFAULT '',timings TEXT NOT NULL DEFAULT '',holidays TEXT NOT NULL DEFAULT '',notices TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
await db.execute('CREATE TABLE classes(id INTEGER PRIMARY KEY,school_id TEXT NOT NULL,name TEXT NOT NULL,UNIQUE(school_id,name))');
await db.execute(`CREATE TABLE students(id INTEGER PRIMARY KEY,school_id TEXT NOT NULL,admission_no TEXT NOT NULL,name TEXT NOT NULL,class_id INTEGER,attendance_pct INTEGER NOT NULL DEFAULT 0,fees_due INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT (datetime('now')),UNIQUE(school_id,admission_no))`);
await db.execute("INSERT INTO schools(id,name) VALUES('legacy','Existing School')");
await db.execute("INSERT INTO classes(id,school_id,name) VALUES(500,'legacy','Old 5A')");
await db.execute("INSERT INTO students(id,school_id,admission_no,name,class_id,fees_due) VALUES(700,'legacy','KEEP-123','Preserved Student',500,3456)");
test('Legacy schema migrates twice without losing data or inventing roll numbers',async()=>{
  await initDb();await initDb();
  const student=(await db.execute('SELECT * FROM students WHERE id=700')).rows[0];assert.equal(student.name,'Preserved Student');assert.equal(Number(student.fees_due),3456);assert.equal(student.admission_no,'KEEP-123');assert.equal(student.roll_no,'');assert.equal(student.section_id,null);assert.equal(Number(student.class_id),500);
  assert.equal(Number((await db.execute('SELECT count(*) AS n FROM students')).rows[0].n),1);
  const cols=(await db.execute('PRAGMA table_info(flow_sessions)')).rows.map(r=>r.name);assert.ok(cols.includes('nonce'));assert.ok(cols.includes('revision'));
  assert.ok((await db.execute("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_students_section'")).rows.length);
});
test.after(()=>db.close());
