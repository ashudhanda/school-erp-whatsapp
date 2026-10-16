// tiny csv parser — handles quoted fields, "" escapes, CRLF. no dependency.
// used by the bulk-import preview/commit flow in the staff panel.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const s = String(text || "");

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);

  return rows.map((r) => r.map((c) => c.trim()));
}

// expected import columns (header row optional):
// name, class, admission_no, parent_name, parent_phone
/**
 * Shape a parsed CSV into the student-import rows the panel expects.
 * Header-row detection is deliberately narrow: the first row is treated as a
 * header (and skipped) only when it contains the word "name" plus "class" or
 * "admission_no" — so a real student actually named "Name" still imports as
 * data. Columns are positional in order name, class, admission_no,
 * parent_name, parent_phone; extra columns are ignored and short rows leave
 * the missing fields empty. No validation happens here — the panel validates
 * each row against classes, rolls and parent numbers before the preview.
 * @param {string} text - raw CSV text
 * @returns {{rows: Array<{name: string, className: string, admissionNo: string, parentName: string, parentPhone: string}>, error: string|null}} shaped rows, or a non-empty-row error in Hindi
 */
export function parseStudentImport(text) {
  let rows = parseCsv(text);
  if (rows.length === 0) return { rows: [], error: "CSV khaali hai." };

  const first = rows[0].map((c) => c.toLowerCase());
  if (first.includes("name") && (first.includes("class") || first.includes("admission_no"))) {
    rows = rows.slice(1); // header row
  }

  return {
    rows: rows.map((r) => ({
      name: r[0] || "",
      className: r[1] || "",
      admissionNo: r[2] || "",
      parentName: r[3] || "",
      parentPhone: r[4] || "",
    })),
    error: null,
  };
}
