# Changelog

## 0.4.0 - Staff on WhatsApp redesign

### Teachers (WhatsApp only, no panel access)
- Attendance for assigned sections with `Only Present`, `Only Absent` and `Back`. Roll input accepts spaces, commas, new lines, extra spaces, leading zeros and Devanagari digits; unspecified rolls receive the opposite status.
- A preview lists present students first and absent students below, and nothing is written or notified until the teacher confirms. A changed roster invalidates a stale preview.
- Marks upload: assigned class, then assigned subject, then instructions, then typed marks or a photo of a handwritten or printed sheet, with an optional test-name caption. The structured preview shows subject, test name, maximum marks and every roll, name and mark, and supports corrections such as `roll 1 is 35` before confirmation.
- Past uploads are viewable by the teacher who created them. Editing requires the school admin's `marks_edit` permission and is audited.
- Homework posting and test announcements.
- Every step of every flow offers `Back`, and long lists paginate.

### Parents and students
- Leave requests with `Sick`, `Other` and `Back`, plus a reason that becomes the request title. Requests reach only that student's current class teacher, who can approve or reject with an optional note; the applicant is told the decision.
- Attendance (today and this month), marks, fees, homework, notices, timings, holidays and the date sheet, all subject to the school's configured menu and sub-options.
- A parent must confirm the link with `YES` before any student data is shown, and only for their own children.

### School admins
- Classes and sections with the school's own names, individual student entry, and CSV or XLSX bulk import with worksheet and column mapping, a validated preview and an idempotent commit.
- Dashboards for today's homework by teacher, attendance with name, roll, only-absent and only-present filters, parent phone numbers, and leave requests with their titles.
- Teacher records with a per-permission matrix, multiple admins per school, events and holidays, date sheet uploads as text or PDF, JPEG or PNG, parent menu options and their sub-options, notification templates and privacy settings.

### Superadmin
- Adds schools, maps WhatsApp senders, sets service entitlements and AI budgets, and manages AI keys including an explicit vision capability. No source changes are needed to onboard a school.

### Platform
- Durable `inbox` and `outbox` queues, signature verification before parsing, persistence before acknowledgement, retries, delivery receipts that never downgrade, and the 24-hour window and approved-template checks at send time.
- Conversation state in `flow_sessions` with a complete payload, a 10-minute TTL, per-screen nonces that reject replayed buttons, and a Back history stack.
- Tenant isolation enforced by SQL triggers as well as queries; permissions are rechecked at confirmation time.
- Idempotent migrations that keep existing rows intact and never invent roll numbers.

## Upgrade steps
1. Back up Turso.
2. Deploy and confirm `/health`; migrations run on boot.
3. In the panel, assign sections and roll numbers to existing students, create teachers with permissions, and confirm parent links.
4. Add AI keys, marking a vision-capable key explicitly before enabling photo marks.
5. Configure approved Meta utility templates for absent, present, leave request and leave result notifications.
6. Run a real-phone smoke test for teacher attendance, marks photo, leave approval and parent pulls.
