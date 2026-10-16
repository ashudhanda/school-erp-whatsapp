// teacher identity — a teacher's whatsapp number IS their login (no panel access).
// everything here is school-scoped and assignment-scoped: a teacher can only ever
// touch classes/subjects the school admin assigned to them.
import { db } from "./db.js";

// returns the teacher row + assignments + sections they're class teacher of, or null
export async function resolveTeacher(schoolId, waId) {
  const t = (
    await db.execute({
      sql: "SELECT * FROM teachers WHERE school_id = ? AND wa_id = ? AND active = 1",
      args: [schoolId, waId],
    })
  ).rows[0];
  if (!t) return null;

  const assignments = (
    await db.execute({
      sql: `SELECT ta.section_id, ta.subject, s.name AS section_name, c.name AS class_name, c.id AS class_id
            FROM teacher_assignments ta
            JOIN sections s ON s.id = ta.section_id AND s.school_id=ta.school_id AND s.active=1
            JOIN classes c ON c.id = s.class_id AND c.school_id=s.school_id AND c.active=1
            WHERE ta.school_id = ? AND ta.teacher_id = ?
            ORDER BY CAST(c.name AS INTEGER), c.name, s.name, ta.subject`,
      args: [schoolId, t.id],
    })
  ).rows;

  const classTeacherOf = (
    await db.execute({
      sql: `SELECT s.id AS section_id, s.name AS section_name, c.name AS class_name
            FROM sections s JOIN classes c ON c.id = s.class_id AND c.school_id=s.school_id AND c.active=1
            WHERE s.school_id = ? AND s.class_teacher_id = ? AND s.active=1`,
      args: [schoolId, t.id],
    })
  ).rows;

  return { ...t, assignments, classTeacherOf };
}

// permission flags live on the teachers row — the school admin grants them in the panel
export const can = (teacher, perm) => !!teacher && Number(teacher["can_" + perm] || 0) === 1;

// unique sections the teacher may act on (subject assignments ∪ class-teacher sections)
export function teacherSections(teacher) {
  const map = new Map();
  for (const a of teacher.assignments || []) {
    map.set(Number(a.section_id), { id: Number(a.section_id), label: `${a.class_name} ${a.section_name}` });
  }
  for (const c of teacher.classTeacherOf || []) {
    if (!map.has(Number(c.section_id))) map.set(Number(c.section_id), { id: Number(c.section_id), label: `${c.class_name} ${c.section_name}` });
  }
  return [...map.values()];
}

export function subjectsFor(teacher, sectionId) {
  return (teacher.assignments || [])
    .filter((a) => Number(a.section_id) === Number(sectionId))
    .map((a) => String(a.subject));
}

export function isClassTeacherOf(teacher, sectionId) {
  return (teacher.classTeacherOf || []).some((c) => Number(c.section_id) === Number(sectionId));
}

// the class roster, roll-number order (numeric when possible)
export async function rosterForSection(schoolId, sectionId) {
  return (
    await db.execute({
      sql: `SELECT id, name, roll_no FROM students
            WHERE school_id = ? AND section_id = ? AND active = 1
            ORDER BY CAST(roll_no AS INTEGER), roll_no, name`,
      args: [schoolId, sectionId],
    })
  ).rows;
}

export async function sectionLabel(schoolId, sectionId) {
  const row = (
    await db.execute({
      sql: `SELECT s.name AS section_name, c.name AS class_name
            FROM sections s JOIN classes c ON c.id = s.class_id AND c.school_id=s.school_id AND c.active=1
            WHERE s.school_id = ? AND s.id = ?`,
      args: [schoolId, sectionId],
    })
  ).rows[0];
  return row ? `${row.class_name} ${row.section_name}` : "?";
}

// whatsapp number of a staff admin who should get bot-side extras (optional)
export async function resolveStaffAdmin(schoolId, waId) {
  const row = (
    await db.execute({
      sql: "SELECT id, name, role FROM staff_users WHERE school_id = ? AND wa_id = ? AND active = 1 AND role = 'admin'",
      args: [schoolId, waId],
    })
  ).rows[0];
  return row || null;
}
