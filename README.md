# School WhatsApp Bot — v0.4 redesign

A school-scoped WhatsApp bot with an English administration panel. Bot replies support English (default), Hindi and Hinglish.

## What is implemented

- Superadmins create schools, map WhatsApp phone-number IDs, enable/disable services and manage provider keys without source-code changes.
- School admins create custom class and section names, assign class teachers and subject teachers, set individual permissions, manage multiple admins, and add/edit students and parent links.
- CSV and genuine XLSX import: upload → worksheet/column mapping → row validation and paginated preview → explicit transactional confirmation. Limits: 2 MB, 1,000 data rows, 50 columns, 20 sheets. Password-protected files, macros, external links and formulas are rejected. Create the class/section names first.
- Teachers use WhatsApp only. Existing teacher panel sessions are invalidated. Every write rechecks active school, permission and assignment.
- Attendance: choose an assigned class and section → Only Present / Only Absent → roll list (spaces, commas, newlines) → present-first/absent-second preview → Confirm or Edit. Type `NONE` for an empty list. Unknown rolls block saving. Approved leave is displayed separately. Duplicate confirmations do not duplicate records.
- Leave: choose a linked child → Sick / Other → date → reason → preview → confirm. Only the currently assigned class teacher can approve/reject. Rejection note is optional. Decisions enqueue updates for still-authorized recipients.
- Marks: assigned class/section/subject → test name and maximum → text or JPEG/PNG photo → validated preview → confirm/correct. Past uploads are viewable; editing requires an explicit school-admin grant and records before/after changes. Missing marks are not converted to zero.
- Homework and test-date announcements are confirmed on WhatsApp and visible to the corresponding parents/students and school admin.
- Official date sheets: text, PDF, JPEG or PNG up to 1 MB, stored in the database and scoped to a school or section. Files are never placed on public local-disk URLs.
- Parent menu options and their sub-options can be configured independently. Language and Back remain accessible; long menus are paginated.
- Admin reports include attendance date/class/name/roll/status filters, parent numbers, leave titles/reasons/status, homework by teacher, marks, events/holidays, audit history and notification delivery status.
- Optional student-number access requires an explicit school-managed link, verified age eligibility and recorded consent. Unknown numbers do not get individual student information.

## Run locally

Use Node 24 LTS (production also supports the declared Node engine). Install dependencies with `npm install`. Copy `.env.example` to `.env`, configure the initial superadmin credentials, then run `npm start`. Open `/panel`. Never commit `.env`, real student data or provider credentials.

Local development uses `file:./dev.db`. Render or another ephemeral host **must use a persistent Turso database**. Back up the database before upgrading. Keep one application worker while using the current in-process dispatch coordination.

## One-time deployment configuration

Keep the existing Meta app secret, verify token and WhatsApp token. The token must be authorized for every sender mapped in the Schools screen. Adding a school in this app does not register or approve a WhatsApp sender with Meta. Connect the webhook at `/webhook`; `/health` is a minimal readiness endpoint.

`PANEL_SUPERADMIN_EMAIL` and `PANEL_SUPERADMIN_PASSWORD` bootstrap the first account. Additional school admins are created from the panel. Demo data is seeded only into an empty database; it never replaces an existing school's students. Disable demo seeding with `SKIP_DEMO_SEED=1` where appropriate.

The migration adds columns and tables before indexes, preserves existing IDs/links/fees, and does not invent real roll numbers or silently assign old students to new sections. The overview identifies records that need the school admin to set a section/roll.

## Notification policy

Inbound webhooks are signature-verified and durably inserted before acknowledgment. Message IDs are deduplicated. Confirmed attendance and leave changes write an outbox entry in the same transaction. Workers recheck school status, recipient authorization, opt-out, service settings and current record status before sending.

A service message can be used only inside the 24-hour customer-service window. Outside it, configure an **approved utility template** under Notifications & AI. Body parameter order:

| Template purpose | Text body parameters |
| --- | --- |
| Attendance absent / present / leave | student name, date, status |
| Leave result | student name, date, decision |
| Teacher leave request | school name, request ID |

Use the exact approved template name and language code. Present notifications are configurable. Missing templates are shown as `blocked`, not “delivered.” `sent` means Meta accepted the request; status callbacks can mark delivered/read/failed. Rate-limit retries are bounded. Ambiguous sends are `uncertain` and are not automatically repeated. Reconcile them in Meta before manual action. Templates and messages may incur provider charges.

## Photo AI and privacy

Photo extraction is off until the school explicitly approves it. The superadmin must also enable vision for a key/model verified to accept image input. The actual image contains student data; it is sent to the configured provider. Review that provider's retention, training, billing and processing terms before enabling it. Text marks work without AI.

OCR is not authoritative. Unclear, duplicate, unknown or out-of-range entries block saving; the teacher must correct them or use text. Full marks are never automatically saved from a photo. Do not place private student data or secrets in the public knowledge base.

API keys remain server-side and are masked in panel responses. Stored data inherits the database provider's security and access controls. Use HTTPS and restricted database credentials. No software can promise zero risk, zero latency or unlimited free API usage.

## Tests

- `npm run check`: syntax checks for source, scripts and tests.
- `npm run test:native`: full tests using Node's native SQLite adapter.
- `npm run test:libsql`: the same suite through the actual `@libsql/client` local-file adapter.
- `LOCAL_CORE_ONLY=1 npm run test:native`: domain/migration tests when package installation is unavailable. This does **not** test Express or XLSX dependencies.
- `npm run simulate`: core-only deterministic tests, no real AI or WhatsApp messages.

Tests cover tenant isolation, teacher panel denial, confirmation replay, stale roster changes, leave routing, marks permissions, import preview/commit, opt-out/window rules, authenticated webhooks, real HTTP forms and genuine XLSX parsing. Test runners isolate temporary databases and clear production credentials. The native adapter is test-only and is never used with Turso credentials.

Before merging/deploying, require both CI adapters to pass. After deployment, perform a real sender smoke test for all three languages, back at every step, a text/photo marks upload, one parent/student lookup, and notification/template delivery. API/provider authorization and real-phone delivery cannot be established by local mock tests.

## Code map

- `config.js`, `alerts.js`: env config with startup warnings, operator Telegram alerts.
- `identity.js`: parent linking (imported → YES/NO confirm), rate limits, opt-out.
- `intents.js`: two-pass keyword classification (exact + Levenshtein fuzzy) for en/hi.
- `i18n.js`: English/Hindi/Hinglish strings, menu rows, language picker.
- `router.js`: inbound message pipeline — identity gate, personal-data code paths, AI fallback.
- `schools.js`, `teachers.js`: school lookup by sender number, teacher WhatsApp workflows.
- `media.js`, `vision.js`: media upload plumbing, opt-in photo extraction.
- `localDb.js`, `seed.js`: local-file adapter for dev/test, empty-database demo seeding.
- `db.js`, `migrations.js`: additive schema initialization and tenant guards.
- `services.js`, `schoolAdmin.js`: scoped domain operations, transactional receipts and auditing.
- `bot.js`, `flows.js`: persisted conversations, Back/history and nonce-bound actions.
- `webhook.js`, `jobs.js`, `whatsapp.js`: authenticated ingress, queueing and delivery.
- `imports.js`, `spreadsheetWorker.js`: bounded CSV/XLSX parsing and transactional import.
- `scripts/check.js`, `scripts/test.js`, `scripts/simulate.js`: syntax check, sequential test runner with isolated temp databases and blanked credentials, deterministic core-only test entry point.
- `test/`: integration tests for domain logic, migrations and HTTP/XLSX platform behavior.
- `panel/routes.js`, `panel/ui.js`, `panel/auth.js`, `panel/views.js`, `panel/csv.js`, `panel/password.js`: server-rendered, CSRF-protected administration (page templates, routes, login, CSV parsing for bulk import, password hashing).
- `ai/`: text knowledge responses, key rotation/cooldowns and explicitly enabled vision.

State expires after 10 minutes. Upload previews expire after 10 minutes. Processed inbox bodies are cleared immediately; inbox deduplication records remain seven days. Pending/blocked notifications expire after seven days; delivery metadata and audit logs are retained for 90 days by the cleanup job. Inspect and adapt retention to school policy and applicable law.
