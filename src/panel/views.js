// server-rendered staff panel pages — one layout, inline css, zero build step.
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function csrfField(csrf) {
  return `<input type="hidden" name="_csrf" value="${esc(csrf)}">`;
}

export function schoolField(user, schoolId) {
  return user.role === "superadmin" ? `<input type="hidden" name="school" value="${esc(schoolId)}">` : "";
}

const CSS = `
:root{--ink:#17171c;--mut:#6b6b74;--line:#e7e5e0;--bg:#f6f5f2;--card:#fff;--acc:#2ea334;--dan:#b3261e}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:var(--bg);color:var(--ink);font-size:15px;line-height:1.5}
a{color:inherit}
code{background:#eeece8;padding:1px 6px;border-radius:6px;font-size:13px}
.wrap{display:flex;min-height:100vh}
.side{width:224px;background:var(--ink);padding:22px 14px;flex:none;display:flex;flex-direction:column}
.side h1{font-size:16px;color:#fff;margin:0 8px 22px}
.side a{display:block;padding:9px 12px;border-radius:8px;text-decoration:none;font-weight:600;margin-bottom:2px;color:#b9b7b0}
.side a.on{background:#2a2a31;color:#fff}
.side a:hover{color:#fff}
.side .out{margin-top:auto;padding-top:20px}
.main{flex:1;padding:28px 32px;max-width:1140px;min-width:0}
.top{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:22px;flex-wrap:wrap}
.top h2{font-size:22px;letter-spacing:-.01em}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:18px}
table{width:100%;border-collapse:collapse;font-size:14px}
th{text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);padding:8px 10px;border-bottom:1px solid var(--line)}
td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:0}
input,select,textarea{font:inherit;padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:#fff;width:100%}
textarea{min-height:150px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px}
select[multiple]{min-height:180px}
label{display:block;font-size:13px;font-weight:600;color:var(--mut);margin:14px 0 5px}
.btn{display:inline-flex;align-items:center;gap:7px;font:inherit;font-weight:600;padding:9px 16px;border-radius:8px;border:1px solid var(--line);background:#fff;cursor:pointer;text-decoration:none;color:var(--ink)}
.btn:hover{border-color:#c9c7c0}
.btn-p{background:var(--ink);color:#fff;border-color:var(--ink)}
.btn-g{background:var(--acc);color:#fff;border-color:var(--acc)}
.btn-d{color:var(--dan)}
.btn-sm{padding:5px 10px;font-size:13px;border-radius:7px}
.btn[disabled]{opacity:.5;pointer-events:none}
.flash{padding:11px 15px;border-radius:9px;margin-bottom:16px;font-size:14px;font-weight:600}
.flash-ok{background:#e6f4e8;color:#1e7a28;border:1px solid #c8e6cd}
.flash-err{background:#fbe9e7;color:var(--dan);border:1px solid #f5c6c0}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:22px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.stat b{display:block;font-size:26px;letter-spacing:-.02em}
.stat span{font-size:13px;color:var(--mut)}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:700;white-space:nowrap}
.pill-g{background:#e6f4e8;color:#1e7a28}
.pill-y{background:#fdf3d7;color:#8a6d00}
.pill-r{background:#fbe9e7;color:#b3261e}
.pill-n{background:#eeece8;color:#6b6b74}
.mut{color:var(--mut);font-size:13px}
.row{display:flex;gap:12px;flex-wrap:wrap}
.row>*{flex:1;min-width:170px}
.inline{display:inline}
.inline2{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.login-wrap{min-height:100vh;display:grid;place-items:center;padding:20px}
.login-card{width:100%;max-width:380px}
.login-card h1{font-size:20px;margin-bottom:6px}
.table-wrap{overflow-x:auto}
@media(max-width:820px){
  .wrap{flex-direction:column}
  .side{width:auto;flex-direction:row;flex-wrap:wrap;align-items:center;gap:4px;padding:12px}
  .side h1{margin:4px 10px 4px 4px}
  .side a{margin:0;padding:7px 10px;font-size:14px}
  .side .out{margin:0 0 0 auto;padding:0}
  .main{padding:18px}
}
`;

export function loginPage(error) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Staff Panel — Login</title><style>${CSS}</style></head>
<body><div class="login-wrap"><form class="card login-card" method="post" action="/panel/login">
<h1>🏫 School Staff Panel</h1>
<p class="mut">Sign in to manage students, parents and link requests.</p>
${error ? `<div class="flash flash-err" style="margin-top:14px">${esc(error)}</div>` : ""}
<label>Email</label><input type="email" name="email" required autocomplete="username">
<label>Password</label><input type="password" name="password" required autocomplete="current-password">
<button class="btn btn-p" style="width:100%;margin-top:18px;justify-content:center">Sign in</button>
</form></div></body></html>`;
}

function navHtml(user, active, sq) {
  const items = [
    ["dash", "Dashboard", "/panel" + sq],
    ["students", "Students", "/panel/students" + sq],
    ["parents", "Parents", "/panel/parents" + sq],
  ];
  if (user.role !== "teacher") items.push(["import", "Bulk Import", "/panel/import" + sq]);
  items.push(["links", "Link Requests", "/panel/links" + sq]);
  if (user.role !== "teacher") {
    items.push(["audit", "Audit Log", "/panel/audit" + sq]);
    items.push(["staff", "Staff", "/panel/staff" + sq]);
  }
  if (user.role === "superadmin") {
    items.push(["keys", "🔑 AI Keys", "/panel/keys"]);
    items.push(["schools", "Schools", "/panel/schools"]);
  }
  return items.map(([k, label, href]) => `<a class="${k === active ? "on" : ""}" href="${href}">${label}</a>`).join("");
}

export function layout({ title, user, active, sq = "", flash, body }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} — Staff Panel</title><style>${CSS}</style></head>
<body><div class="wrap">
<nav class="side"><h1>🏫 Staff Panel</h1>${navHtml(user, active, sq)}
<form class="out" method="post" action="/panel/logout">${csrfField(user.csrf)}<button class="btn btn-sm" style="background:transparent;color:#b9b7b0;border-color:#3a3a41">Log out · ${esc(user.name)}</button></form>
</nav>
<main class="main">
${flash && flash.err ? `<div class="flash flash-err">${esc(flash.err)}</div>` : ""}
${flash && flash.ok ? `<div class="flash flash-ok">${esc(flash.ok)}</div>` : ""}
${body}
</main></div></body></html>`;
}

function stat(n, label) {
  return `<div class="stat"><b>${n}</b><span>${label}</span></div>`;
}

export function dashboardPage({ user, schoolId, schools, counts, flash, sq }) {
  const picker =
    user.role === "superadmin"
      ? `<form method="get" action="/panel" style="margin-bottom:18px;max-width:340px">
        <label>Viewing school</label>
        <select name="school" onchange="this.form.submit()">
          ${schools.map((s) => `<option value="${esc(s.id)}" ${s.id === schoolId ? "selected" : ""}>${esc(s.name)}</option>`).join("")}
        </select>
      </form>`
      : "";
  const body = `
  <div class="top"><h2>Dashboard</h2><span class="pill pill-n">${esc(schoolId)}</span></div>
  ${picker}
  <div class="stats">
    ${stat(counts.students, "Active students")}
    ${stat(counts.parentsConfirmed, "Confirmed parents")}
    ${stat(counts.parentsPending, "Parents pending YES")}
    ${stat(counts.linksPending, "Link requests pending")}
    ${stat(counts.msgsToday, "Messages today")}
  </div>
  <div class="card">
    <h3 style="margin-bottom:10px">Quick actions</h3>
    <div class="inline2">
      <a class="btn" href="/panel/students${sq}">Manage students</a>
      <a class="btn" href="/panel/parents${sq}">Manage parents</a>
      ${user.role !== "teacher" ? `<a class="btn" href="/panel/import${sq}">Bulk import CSV</a>` : ""}
      <a class="btn" href="/panel/links${sq}">Review link requests</a>
    </div>
    <p class="mut" style="margin-top:14px">Privacy rule: parents only ever see their own child's data — identity is checked in code on every message, and every personal-data query lands in the audit log.</p>
  </div>`;
  return layout({ title: "Dashboard", user, active: "dash", sq, flash, body });
}

export function studentsPage({ user, schoolId, sq, students, classes, q, editStudent, flash }) {
  const ro = user.role === "teacher";
  const form = ro
    ? ""
    : `<div class="card">
    <h3>${editStudent ? "Edit student" : "Add student"}</h3>
    <form method="post" action="${editStudent ? `/panel/students/${editStudent.id}/edit` : "/panel/students"}">
      ${csrfField(user.csrf)}${schoolField(user, schoolId)}
      <div class="row">
        <div><label>Name</label><input name="name" required value="${esc(editStudent?.name || "")}"></div>
        <div><label>Admission no</label><input name="admission_no" required value="${esc(editStudent?.admission_no || "")}"></div>
      </div>
      <div class="row">
        <div><label>Class</label><select name="class_id">
          <option value="">—</option>
          ${classes.map((c) => `<option value="${c.id}" ${editStudent && editStudent.class_id === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
        </select></div>
        <div><label>…or new class</label><input name="new_class" placeholder="e.g. 6A"></div>
      </div>
      <div class="row">
        <div><label>Attendance % (preview)</label><input type="number" min="0" max="100" name="attendance_pct" value="${editStudent ? editStudent.attendance_pct : 0}"></div>
        <div><label>Fees due ₹ (preview)</label><input type="number" min="0" name="fees_due" value="${editStudent ? editStudent.fees_due : 0}"></div>
      </div>
      <div style="margin-top:16px;display:flex;gap:10px">
        <button class="btn btn-p">${editStudent ? "Save changes" : "Add student"}</button>
        ${editStudent ? `<a class="btn" href="/panel/students${sq}">Cancel</a>` : ""}
      </div>
    </form>
  </div>`;

  const rows = students
    .map(
      (s) => `<tr>
    <td><b>${esc(s.admission_no)}</b></td>
    <td>${esc(s.name)}</td>
    <td>${esc(s.class_name || "—")}</td>
    <td>${s.attendance_pct}%</td>
    <td>${Number(s.fees_due) > 0 ? "₹" + Number(s.fees_due).toLocaleString("en-IN") : "—"}</td>
    <td><span class="pill ${s.active ? "pill-g" : "pill-n"}">${s.active ? "active" : "off"}</span></td>
    <td>${s.parent_count}</td>
    ${
      ro
        ? "<td></td>"
        : `<td style="white-space:nowrap">
      <a class="btn btn-sm" href="/panel/students${sq ? sq + "&" : "?"}edit=${s.id}">Edit</a>
      <form class="inline" method="post" action="/panel/students/${s.id}/toggle">${csrfField(user.csrf)}${schoolField(user, schoolId)}
        <button class="btn btn-sm ${s.active ? "btn-d" : ""}">${s.active ? "Deactivate" : "Activate"}</button>
      </form>
    </td>`
    }
  </tr>`
    )
    .join("");

  const body = `
  <div class="top"><h2>Students</h2>
    <form method="get" action="/panel/students" class="inline2">
      ${user.role === "superadmin" ? `<input type="hidden" name="school" value="${esc(schoolId)}">` : ""}
      <input name="q" placeholder="Search name / admission no" value="${esc(q)}" style="width:240px">
      <button class="btn">Search</button>
    </form>
  </div>
  ${form}
  <div class="card table-wrap">
    <table><thead><tr><th>Adm no</th><th>Name</th><th>Class</th><th>Attend.</th><th>Fees due</th><th>Status</th><th>Parents</th>${ro ? "" : "<th>Actions</th>"}</tr></thead>
    <tbody>${rows || `<tr><td colspan="8" class="mut">No students found.</td></tr>`}</tbody></table>
  </div>`;
  return layout({ title: "Students", user, active: "students", sq, flash, body });
}

export function parentsPage({ user, schoolId, sq, parents, students, editParent, linkedIds, flash }) {
  const ro = user.role === "teacher";
  const form = ro
    ? ""
    : `<div class="card">
    <h3>${editParent ? "Edit parent" : "Add parent"}</h3>
    <form method="post" action="${editParent ? `/panel/parents/${editParent.id}/edit` : "/panel/parents"}">
      ${csrfField(user.csrf)}${schoolField(user, schoolId)}
      <div class="row">
        <div><label>Parent name</label><input name="name" required value="${esc(editParent?.name || "")}"></div>
        <div><label>WhatsApp number</label><input name="wa_id" required placeholder="9876543210 ya 919876543210" value="${esc(editParent?.wa_id || "")}"></div>
      </div>
      <div style="margin-top:16px;display:flex;gap:10px">
        <button class="btn btn-p">${editParent ? "Save changes" : "Add parent"}</button>
        ${editParent ? `<a class="btn" href="/panel/parents${sq}">Cancel</a>` : ""}
      </div>
    </form>
    ${
      editParent
        ? `<hr style="border:0;border-top:1px solid var(--line);margin:20px 0">
    <h4 style="margin-bottom:6px">Linked students — ${esc(editParent.name)}</h4>
    <p class="mut">Hold Ctrl/Cmd to select multiple. Parent sees ONLY these students' data.</p>
    <form method="post" action="/panel/parents/${editParent.id}/links">
      ${csrfField(user.csrf)}${schoolField(user, schoolId)}
      <select name="student_ids" multiple>
        ${students.map((s) => `<option value="${s.id}" ${linkedIds.has(Number(s.id)) ? "selected" : ""}>${esc(s.name)} (${esc(s.class_name || "—")})</option>`).join("")}
      </select>
      <div style="margin-top:14px"><button class="btn btn-g">Save links</button></div>
    </form>`
        : ""
    }
  </div>`;

  const rows = parents
    .map(
      (p) => `<tr>
    <td><b>${esc(p.name)}</b></td>
    <td>${esc(p.wa_id)}</td>
    <td><span class="pill ${p.confirmed ? "pill-g" : "pill-y"}">${p.confirmed ? "confirmed" : "pending YES"}</span></td>
    <td>${esc(p.kids || "—")}</td>
    ${
      ro
        ? "<td></td>"
        : `<td style="white-space:nowrap">
      <a class="btn btn-sm" href="/panel/parents${sq ? sq + "&" : "?"}edit=${p.id}">Edit / Links</a>
      <form class="inline" method="post" action="/panel/parents/${p.id}/delete" onsubmit="return confirm('Delete this parent and all links?')">${csrfField(user.csrf)}${schoolField(user, schoolId)}
        <button class="btn btn-sm btn-d">Delete</button>
      </form>
    </td>`
    }
  </tr>`
    )
    .join("");

  const body = `
  <div class="top"><h2>Parents</h2><span class="pill pill-n">${parents.length} registered</span></div>
  ${form}
  <div class="card table-wrap">
    <table><thead><tr><th>Name</th><th>WhatsApp</th><th>Status</th><th>Linked students</th>${ro ? "" : "<th>Actions</th>"}</tr></thead>
    <tbody>${rows || `<tr><td colspan="5" class="mut">No parents yet — add one above or bulk import.</td></tr>`}</tbody></table>
  </div>`;
  return layout({ title: "Parents", user, active: "parents", sq, flash, body });
}

export function importPage({ user, schoolId, flash, sq }) {
  const body = `
  <div class="top"><h2>Bulk Import (CSV)</h2></div>
  <div class="card">
    <p>Format — one student per line:</p>
    <p style="margin:8px 0"><code>name, class, admission_no, parent_name, parent_phone</code></p>
    <p class="mut">Header row optional. Phone 10-digit ya +91 format dono chalega. Imported parents WhatsApp pe pehli baar message karne par <b>YES</b> confirm karte hain — tab tak unka data locked rehta hai (anti-stranger rule).</p>
    <form method="post" action="/panel/import/preview">
      ${csrfField(user.csrf)}${schoolField(user, schoolId)}
      <label>CSV data</label>
      <textarea name="csv" required placeholder="Aarav Sharma, 5A, DPS-1001, Rakesh Sharma, 9876543210&#10;Diya Verma, 3B, DPS-1002, Neha Verma, 9812345678"></textarea>
      <div style="margin-top:16px"><button class="btn btn-p">Preview import</button></div>
    </form>
  </div>`;
  return layout({ title: "Bulk Import", user, active: "import", sq, flash, body });
}

export function importPreviewPage({ user, schoolId, sq, csv, rows, counts, flash }) {
  const body = `
  <div class="top"><h2>Import Preview</h2></div>
  <div class="stats">
    ${stat(counts.valid, "Ready to import")}
    ${stat(counts.dupes, "Already in DB (skipped)")}
    ${stat(counts.invalid, "Rows with errors")}
  </div>
  <div class="card table-wrap">
    <table><thead><tr><th>#</th><th>Name</th><th>Class</th><th>Adm no</th><th>Parent</th><th>Phone</th><th>Status</th></tr></thead>
    <tbody>${rows
      .map(
        (r, i) => `<tr>
      <td class="mut">${i + 1}</td><td>${esc(r.name)}</td><td>${esc(r.className)}</td><td>${esc(r.admissionNo)}</td><td>${esc(r.parentName)}</td><td>${esc(r.parentPhone)}</td>
      <td>${r.errors.length ? `<span class="pill pill-r">${esc(r.errors.join("; "))}</span>` : r.dupe ? `<span class="pill pill-y">exists — skip</span>` : `<span class="pill pill-g">ready</span>`}</td>
    </tr>`
      )
      .join("")}</tbody></table>
  </div>
  <form method="post" action="/panel/import/commit" class="inline2">
    ${csrfField(user.csrf)}${schoolField(user, schoolId)}
    <input type="hidden" name="csv" value="${esc(csv)}">
    <button class="btn btn-g" ${counts.valid ? "" : "disabled"}>Import ${counts.valid} students</button>
    <a class="btn" href="/panel/import${sq}">Cancel</a>
  </form>`;
  return layout({ title: "Import Preview", user, active: "import", sq, flash, body });
}

export function linksPage({ user, schoolId, sq, requests, students, flash }) {
  const ro = user.role === "teacher";
  const rows = requests
    .map((r) => {
      const pending = r.status === "pending";
      return `<tr>
      <td class="mut">${esc(r.created_at)}</td>
      <td><b>${esc(r.wa_id)}</b></td>
      <td>${esc(r.note)}</td>
      <td><span class="pill ${pending ? "pill-y" : r.status === "approved" ? "pill-g" : "pill-r"}">${r.status}</span></td>
      <td>${
        pending && !ro
          ? `<form method="post" action="/panel/links/${r.id}/approve" class="inline2">
          ${csrfField(user.csrf)}${schoolField(user, schoolId)}
          <input name="parent_name" placeholder="Parent name" required style="width:150px">
          <select name="student_id" required style="width:190px">
            <option value="">Select student…</option>
            ${students.map((s) => `<option value="${s.id}">${esc(s.name)} (${esc(s.class_name || "—")})</option>`).join("")}
          </select>
          <button class="btn btn-sm btn-g">Approve</button>
        </form>
        <form method="post" action="/panel/links/${r.id}/reject" style="margin-top:6px">
          ${csrfField(user.csrf)}${schoolField(user, schoolId)}
          <button class="btn btn-sm btn-d">Reject</button>
        </form>`
          : r.resolved_by
            ? `<span class="mut">by ${esc(r.resolved_by)}</span>`
            : ""
      }</td>
    </tr>`;
    })
    .join("");

  const body = `
  <div class="top"><h2>Link Requests</h2></div>
  <div class="card table-wrap">
    <p class="mut" style="margin-bottom:12px">Parents WhatsApp pe <code>LINK &lt;child name&gt; &lt;class&gt;</code> bhejte hain. Verify offline (call/visit), then approve — approval links the number to the student and confirms it.</p>
    <table><thead><tr><th>When</th><th>WhatsApp number</th><th>Note</th><th>Status</th><th>Action</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="5" class="mut">No link requests yet.</td></tr>`}</tbody></table>
  </div>`;
  return layout({ title: "Link Requests", user, active: "links", sq, flash, body });
}

export function auditPage({ user, schoolId, sq, logs, actions, action, flash }) {
  const rows = logs
    .map(
      (l) => `<tr>
    <td class="mut">${esc(l.created_at)}</td>
    <td>${esc(l.actor)}</td>
    <td><span class="pill pill-n">${esc(l.action)}</span></td>
    <td>${esc(l.details)}</td>
  </tr>`
    )
    .join("");

  const body = `
  <div class="top"><h2>Audit Log</h2>
    <form method="get" action="/panel/audit" class="inline2">
      ${user.role === "superadmin" ? `<input type="hidden" name="school" value="${esc(schoolId)}">` : ""}
      <select name="action">
        <option value="">All actions</option>
        ${actions.map((a) => `<option value="${esc(a)}" ${a === action ? "selected" : ""}>${esc(a)}</option>`).join("")}
      </select>
      <button class="btn">Filter</button>
    </form>
  </div>
  <div class="card table-wrap">
    <table><thead><tr><th>When (UTC)</th><th>Actor</th><th>Action</th><th>Details</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="4" class="mut">Nothing logged yet.</td></tr>`}</tbody></table>
  </div>`;
  return layout({ title: "Audit Log", user, active: "audit", sq, flash, body });
}

export function staffPage({ user, schoolId, sq, staff, schools, flash }) {
  const rows = staff
    .map(
      (u) => `<tr>
    <td><b>${esc(u.name)}</b></td>
    <td>${esc(u.email)}</td>
    <td><span class="pill ${u.role === "superadmin" ? "pill-r" : u.role === "admin" ? "pill-g" : "pill-n"}">${esc(u.role)}</span></td>
    <td>${esc(u.school_id || "all schools")}</td>
    <td><span class="pill ${u.active ? "pill-g" : "pill-n"}">${u.active ? "active" : "off"}</span></td>
    <td>${
      u.id === user.staff_id
        ? `<span class="mut">you</span>`
        : `<form class="inline" method="post" action="/panel/staff/${u.id}/toggle">${csrfField(user.csrf)}${schoolField(user, schoolId)}
        <button class="btn btn-sm ${u.active ? "btn-d" : ""}">${u.active ? "Deactivate" : "Activate"}</button>
      </form>`
    }</td>
  </tr>`
    )
    .join("");

  const schoolSelect =
    user.role === "superadmin"
      ? `<div><label>School (blank = superadmin)</label><select name="school_id">
        <option value="">— superadmin (no school) —</option>
        ${schools.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}
      </select></div>`
      : "";

  const body = `
  <div class="top"><h2>Staff</h2></div>
  <div class="card">
    <h3>Add staff member</h3>
    <form method="post" action="/panel/staff">
      ${csrfField(user.csrf)}${schoolField(user, schoolId)}
      <div class="row">
        <div><label>Name</label><input name="name" required></div>
        <div><label>Email</label><input type="email" name="email" required></div>
      </div>
      <div class="row">
        <div><label>Password (min 8 chars)</label><input type="password" name="password" required minlength="8"></div>
        <div><label>Role</label><select name="role">
          <option value="teacher">teacher (read-only)</option>
          <option value="admin">admin (full school access)</option>
          ${user.role === "superadmin" ? `<option value="superadmin">superadmin (all schools)</option>` : ""}
        </select></div>
        ${schoolSelect}
      </div>
      <div style="margin-top:16px"><button class="btn btn-p">Add staff</button></div>
    </form>
  </div>
  <div class="card table-wrap">
    <table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>School</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="6" class="mut">No staff yet.</td></tr>`}</tbody></table>
  </div>`;
  return layout({ title: "Staff", user, active: "staff", sq, flash, body });
}

export function schoolsPage({ user, schools, editSchool, flash }) {
  const rows = schools
    .map(
      (s) => `<tr>
    <td><b>${esc(s.id)}</b></td>
    <td>${esc(s.name)}</td>
    <td>${esc(s.phone_number_id || "—")}</td>
    <td><span class="pill ${s.active ? "pill-g" : "pill-n"}">${s.active ? "active" : "off"}</span></td>
    <td><a class="btn btn-sm" href="/panel/schools?edit=${esc(s.id)}">Edit</a></td>
  </tr>`
    )
    .join("");

  const body = `
  <div class="top"><h2>Schools (superadmin)</h2></div>
  <div class="card">
    <h3>${editSchool ? "Edit school — " + esc(editSchool.name) : "Add school"}</h3>
    <form method="post" action="${editSchool ? `/panel/schools/${encodeURIComponent(editSchool.id)}/edit` : "/panel/schools"}">
      ${csrfField(user.csrf)}
      ${
        editSchool
          ? ""
          : `<div class="row"><div><label>School id (slug)</label><input name="id" required placeholder="green-valley-school" pattern="[a-z0-9][a-z0-9-]{1,40}"></div></div>`
      }
      <div class="row">
        <div><label>Name</label><input name="name" required value="${esc(editSchool?.name || "")}"></div>
        <div><label>WhatsApp phone_number_id</label><input name="phone_number_id" value="${esc(editSchool?.phone_number_id || "")}" placeholder="Meta dashboard se"></div>
      </div>
      <div class="row">
        <div><label>Office phone (parents ko replies me dikhta hai)</label><input name="office_phone" value="${esc(editSchool?.office_phone || "")}" placeholder="+91 172 400 1234"></div>
      </div>
      <label>Timings — instant canned reply (blank = AI answers from KB)</label>
      <textarea name="timings" style="min-height:70px">${esc(editSchool?.timings || "")}</textarea>
      <label>Holidays — instant canned reply (blank = AI answers from KB)</label>
      <textarea name="holidays" style="min-height:70px">${esc(editSchool?.holidays || "")}</textarea>
      <label>Notices — current notices (blank = "abhi koi naya notice nahi")</label>
      <textarea name="notices" style="min-height:70px">${esc(editSchool?.notices || "")}</textarea>
      <label>Knowledge base (AI isi se jawab deta hai — fees, timings, rules)</label>
      <textarea name="kb" style="min-height:110px">${esc(editSchool?.kb || "")}</textarea>
      ${editSchool ? `<label style="margin-top:14px"><input type="checkbox" name="active" value="1" ${editSchool.active ? "checked" : ""} style="width:auto"> Active</label>` : ""}
      <div style="margin-top:16px;display:flex;gap:10px">
        <button class="btn btn-p">${editSchool ? "Save changes" : "Add school"}</button>
        ${editSchool ? `<a class="btn" href="/panel/schools">Cancel</a>` : ""}
      </div>
    </form>
  </div>
  <div class="card table-wrap">
    <table><thead><tr><th>Id</th><th>Name</th><th>phone_number_id</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="5" class="mut">No schools.</td></tr>`}</tbody></table>
  </div>`;
  return layout({ title: "Schools", user, active: "schools", sq: "", flash, body });
}

// superadmin key manager — paste any provider's key, the system auto-detects the
// provider, auto-picks a model, live-tests the key, and only then connects it.
// health dashboard: live/cooling/dead per key + wake-up countdown + the exact
// problem (last error) + proof of life (last successful call).
export function keysPage({ user, envKeys, dbKeys, summary, flash }) {
  const healthCell = (k) => {
    if (k.state === "active")
      return `<span class="pill pill-g">🟢 live</span>${k.lastOkText ? `<div class="mut" style="margin-top:3px">last OK: ${esc(k.lastOkText)}</div>` : ""}`;
    if (k.state === "cooling")
      return `<span class="pill pill-y">🟡 cooling</span>${k.wakeText ? `<div class="mut" style="margin-top:3px">wapas: ${esc(k.wakeText)}</div>` : ""}`;
    if (k.state === "dead") return `<span class="pill pill-r">🔴 dead</span><div class="mut" style="margin-top:3px">replace karo</div>`;
    return `<span class="pill pill-n">${esc(k.state)}</span>`;
  };

  const problemCell = (k) =>
    `<td class="mut"${k.state === "dead" || k.state === "cooling" ? ' style="color:var(--dan)"' : ""}>${esc(k.lastError || "—")}</td>`;

  const envRows = envKeys
    .map(
      (k) => `<tr>
    <td><b>${esc(k.label)}</b> <span class="pill pill-n">env</span></td>
    <td>${esc(k.provider)}</td>
    <td>${esc(k.model || "—")}</td>
    <td><code>${esc(k.key)}</code></td>
    <td>${healthCell(k)}</td>
    ${problemCell(k)}
    <td>${k.calls}</td>
    <td class="mut">Render env se manage hoti hai</td>
  </tr>`
    )
    .join("");

  const dbRows = dbKeys
    .map(
      (k) => `<tr>
    <td><b>${esc(k.label || "key #" + k.id)}</b></td>
    <td>${esc(k.provider)}</td>
    <td>${esc(k.model || "—")}</td>
    <td><code>${esc(k.masked)}</code></td>
    <td>${healthCell(k)}</td>
    ${problemCell(k)}
    <td>${k.calls}</td>
    <td style="white-space:nowrap">
      <form class="inline" method="post" action="/panel/keys/${k.id}/test">${csrfField(user.csrf)}<button class="btn btn-sm">Test</button></form>
      <form class="inline" method="post" action="/panel/keys/${k.id}/toggle">${csrfField(user.csrf)}<button class="btn btn-sm">${k.active ? "Disable" : "Enable"}</button></form>
      <form class="inline" method="post" action="/panel/keys/${k.id}/delete" onsubmit="return confirm('Delete this key permanently?')">${csrfField(user.csrf)}<button class="btn btn-sm btn-d">Delete</button></form>
    </td>
  </tr>`
    )
    .join("");

  const summaryStrip = summary
    ? `<div class="stats">
    <div class="stat"><b style="color:#1e7a28">${summary.live}</b><span>🟢 Live keys</span></div>
    <div class="stat"><b style="color:#8a6d00">${summary.cooling}</b><span>🟡 Cooling (auto-resume)</span></div>
    <div class="stat"><b style="color:#b3261e">${summary.dead}</b><span>🔴 Dead (replace karo)</span></div>
    <div class="stat"><b>${summary.disabled}</b><span>⚪ Disabled</span></div>
  </div>`
    : "";

  const body = `
  <div class="top"><h2>🔑 AI Keys (superadmin)</h2></div>
  ${summaryStrip}
  <div class="card">
    <h3>Add key — paste karo, baaki system khud samajh lega</h3>
    <p class="mut" style="margin:6px 0 0">Provider <b>Auto-detect</b> pe chhodo — key ke pattern se system khud pehchan leta hai (Gemini / Groq / OpenRouter / NVIDIA / OpenAI). Model blank chhodo to best model auto-pick hota hai — OpenRouter ka free-model list bot khud internet se refresh karta hai (6h cache). Save hone se pehle <b>live test</b> hota hai — fail = save nahi hogi. 429 (quota khatam) wali key save ho jaati hai — reset pe khud chalu ho jayegi.</p>
    <form method="post" action="/panel/keys">
      ${csrfField(user.csrf)}
      <label>API key</label>
      <input name="key" required placeholder="AIza... / gsk_... / sk-or-... / nvapi-... / sk-..." autocomplete="off">
      <div class="row">
        <div><label>Provider</label><select name="provider">
          <option value="auto">✨ Auto-detect (recommended)</option>
          <option value="gemini">gemini</option>
          <option value="groq">groq</option>
          <option value="openrouter">openrouter</option>
          <option value="nim">nim</option>
          <option value="openai">openai</option>
          <option value="custom">custom (OpenAI-compatible)</option>
        </select></div>
        <div><label>Model (blank = auto-pick)</label><input name="model" placeholder="gemini-2.0-flash / llama-3.3-70b-versatile / ..."></div>
      </div>
      <div class="row">
        <div><label>Label (optional)</label><input name="label" placeholder="groq-backup-1"></div>
        <div><label>Base URL (sirf custom provider ke liye)</label><input name="base_url" placeholder="https://api.example.com/v1"></div>
      </div>
      <label>GCP project (optional — sirf Gemini; same-project keys EK quota share karti hain, isliye alag projects likho)</label>
      <input name="project" placeholder="my-gcp-project">
      <div style="margin-top:16px"><button class="btn btn-p">Test &amp; Add key</button></div>
    </form>
  </div>
  <div class="card table-wrap">
    <table><thead><tr><th>Label</th><th>Provider</th><th>Model</th><th>Key</th><th>Health</th><th>Problem</th><th>Calls</th><th>Actions</th></tr></thead>
    <tbody>${dbRows || ""}${envRows || ""}${!dbRows && !envRows ? `<tr><td colspan="8" class="mut">No keys yet — upar se add karo.</td></tr>` : ""}</tbody></table>
    <p class="mut" style="margin-top:10px">🟢 live = chal rahi hai (last OK time dikhta hai) · 🟡 cooling = quota khatam, <b>wapas-active time</b> likha aata hai, reset pe khud chalu · 🔴 dead = invalid/revoked — replace karo. Problem column me asli error dikhta hai (quota exceeded / invalid key / timeout etc.). Har cooling/death pe Telegram alert bhi aata hai. Keys DB me save hoti hain, UI me masked, sirf superadmin ko dikhti hain. Env wali keys yahan se delete nahi hoti (Render env me hatani hongi).</p>
  </div>`;
  return layout({ title: "AI Keys", user, active: "keys", sq: "", flash, body });
}
