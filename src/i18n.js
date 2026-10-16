// every user-facing string in 3 languages — en (english, DEFAULT), hi (hindi,
// devanagari), hg (hinglish, roman script). the per-number preference lives in
// the user_prefs table (db.js). the ai's output language uses the same codes
// (see ai/brain.js LANG_RULES). menus come from menuRows(lang, opts).

export const LANG_IDS = ["en", "hi", "hg"];

// picker rows are the same for everyone — the user hasn't picked a language yet
export function langPickerRows() {
  return [
    ["lang_en", "English", "Simple English (default)"],
    ["lang_hi", "हिन्दी", "देवनागरी लिपि में"],
    ["lang_hg", "Hinglish", "Roman script me Hindi"],
  ];
}

export const isLangId = (id) => typeof id === "string" && id.startsWith("lang_") && LANG_IDS.includes(id.slice(5));
export const langFromId = (id) => id.slice(5);

// ---------- menus ----------
// parent menu: the ids the school admin can toggle/reorder (Panel → Menu Control).
// lang is always available — otherwise users would get stuck.
export const PARENT_MENU_IDS = ["attendance", "marks", "fees", "homework", "datesheet", "leave", "notices", "timings", "holidays"];

const PARENT_MENU = {
  en: [
    ["attendance", "📋 Attendance", "Daily presence & monthly %"],
    ["marks", "📊 Marks / Result", "Exam-wise marks"],
    ["fees", "💰 Fees", "Outstanding fee amount"],
    ["homework", "📝 Homework", "Today's homework"],
    ["datesheet", "🗓️ Date Sheet", "Exam dates & tests"],
    ["leave", "🛌 Leave", "Apply for leave"],
    ["notices", "📢 Notices", "School notices & events"],
    ["timings", "🕒 Timings", "School timing info"],
    ["holidays", "🌴 Holidays", "Holiday list"],
    ["lang", "🌐 Language", "English / हिन्दी / Hinglish"],
  ],
  hi: [
    ["attendance", "📋 उपस्थिति", "आज की हाजिरी और मासिक %"],
    ["marks", "📊 अंक / परिणाम", "परीक्षा के अंक"],
    ["fees", "💰 फीस", "बकाया फीस"],
    ["homework", "📝 होमवर्क", "आज का होमवर्क"],
    ["datesheet", "🗓️ डेट शीट", "परीक्षा तिथियां और टेस्ट"],
    ["leave", "🛌 अवकाश", "अवकाश के लिए आवेदन"],
    ["notices", "📢 सूचनाएं", "स्कूल सूचनाएं और इवेंट"],
    ["timings", "🕒 समय", "स्कूल का समय"],
    ["holidays", "🌴 छुट्टियां", "छुट्टियों की सूची"],
    ["lang", "🌐 भाषा", "English / हिन्दी / Hinglish"],
  ],
  hg: [
    ["attendance", "📋 Attendance", "Aaj ki hajri aur monthly %"],
    ["marks", "📊 Marks / Result", "Exam-wise marks"],
    ["fees", "💰 Fees", "Pending fee amount"],
    ["homework", "📝 Homework", "Aaj ka homework"],
    ["datesheet", "🗓️ Date Sheet", "Exam dates aur tests"],
    ["leave", "🛌 Leave", "Leave ke liye apply karein"],
    ["notices", "📢 Notices", "School notices aur events"],
    ["timings", "🕒 Timings", "School timing info"],
    ["holidays", "🌴 Holidays", "Chhuttiyon ki list"],
    ["lang", "🌐 Language", "English / हिन्दी / Hinglish"],
  ],
};

// unknown numbers see public school information only
const PUBLIC_MENU = {
  en: [
    ["admission", "🎓 Admission", "Process, documents, fees"],
    ["timings", "🕒 Timings", "School timing info"],
    ["holidays", "🌴 Holidays", "Holiday list"],
    ["notices", "📢 Notices", "School notices & events"],
    ["lang", "🌐 Language", "English / हिन्दी / Hinglish"],
  ],
  hi: [
    ["admission", "🎓 प्रवेश", "प्रक्रिया, दस्तावेज़, फीस"],
    ["timings", "🕒 समय", "स्कूल का समय"],
    ["holidays", "🌴 छुट्टियां", "छुट्टियों की सूची"],
    ["notices", "📢 सूचनाएं", "स्कूल सूचनाएं और इवेंट"],
    ["lang", "🌐 भाषा", "English / हिन्दी / Hinglish"],
  ],
  hg: [
    ["admission", "🎓 Admission", "Process, documents, fees"],
    ["timings", "🕒 Timings", "School timing info"],
    ["holidays", "🌴 Holidays", "Chhuttiyon ki list"],
    ["notices", "📢 Notices", "School notices aur events"],
    ["lang", "🌐 Language", "English / हिन्दी / Hinglish"],
  ],
};

// teachers get their own menu — they never see the panel, everything is here
const TEACHER_MENU = {
  en: [
    ["t_att", "📋 Mark Attendance", "Today's class attendance"],
    ["t_marks", "📊 Upload Marks", "Type or photo — exam marks"],
    ["t_hw", "📝 Post Homework", "Send today's homework"],
    ["t_test", "🗓️ Test Date", "Announce a test"],
    ["t_hist", "🗂️ My Uploads", "Marks history & edits"],
    ["lang", "🌐 Language", "English / हिन्दी / Hinglish"],
  ],
  hi: [
    ["t_att", "📋 उपस्थिति लगाएं", "आज की कक्षा उपस्थिति"],
    ["t_marks", "📊 अंक अपलोड करें", "टाइप करें या फोटो भेजें"],
    ["t_hw", "📝 होमवर्क भेजें", "आज का होमवर्क"],
    ["t_test", "🗓️ टेस्ट तिथि", "टेस्ट की घोषणा"],
    ["t_hist", "🗂️ मेरे अपलोड", "अंक इतिहास और सुधार"],
    ["lang", "🌐 भाषा", "English / हिन्दी / Hinglish"],
  ],
  hg: [
    ["t_att", "📋 Attendance Lagayein", "Aaj ki class attendance"],
    ["t_marks", "📊 Marks Upload", "Type karein ya photo bhejein"],
    ["t_hw", "📝 Homework Bhejein", "Aaj ka homework"],
    ["t_test", "🗓️ Test Date", "Test announce karein"],
    ["t_hist", "🗂️ Mere Uploads", "Marks history aur edits"],
    ["lang", "🌐 Language", "English / हिन्दी / Hinglish"],
  ],
};

// menuRows(lang, { audience, cfg })
// audience: "parent" (default) | "public" | "teacher"
// cfg: the school admin's menu config { rows: [ids] } — filters + reorders the parent menu
export function menuRows(lang, opts = {}) {
  const { audience = "parent", cfg = null } = opts;
  const pack = audience === "teacher" ? TEACHER_MENU : audience === "public" ? PUBLIC_MENU : PARENT_MENU;
  let rows = pack[lang] || pack.en;
  if (audience === "parent" && cfg && Array.isArray(cfg.rows)) {
    const byId = new Map(rows.map((r) => [r[0], r]));
    const picked = [];
    for (const id of cfg.rows) {
      if (id !== "lang" && byId.has(id)) picked.push(byId.get(id));
    }
    rows = picked;
  }
  // language can never be hidden — a user must always be able to switch back
  if (!rows.some((r) => r[0] === "lang")) {
    const langRow = (pack[lang] || pack.en).find((r) => r[0] === "lang") || PARENT_MENU.en.find((r) => r[0] === "lang");
    rows = [...rows, langRow];
  }
  return rows; // the transport paginates rather than silently hiding options
}

const STRINGS = {
  en: {
    unknownSchool: "This WhatsApp number is still being set up. Please try again in a little while 🙏",
    menuBody: "What would you like to know?",
    menuButton: "Open Menu",
    langPickerIntro: "🌐 Choose your language / अपनी भाषा चुनें / Apni bhasha chunein:",
    langSetConfirm: "Language set to *English* ✅",
    nonText: "Please send your question as a text message 🙂 — or use the menu.",
    greeting: "Hello 🙏 Welcome to *{school}*! I'm here to help with school information.",
    kidsLine: "\nYour linked children: *{names}*",
    confirmPrompt:
      "Hello 🙏 from *{school}*. This WhatsApp number has been registered by the school as a parent.\n\n➡️ If you are the parent, reply *YES*.\n➡️ If this number was added by mistake, reply *NO*.",
    privacyLocked:
      "🔒 These details are shared only with *registered parents*.\n\nIf you are a parent of this school, get your WhatsApp number linked — send:\n*LINK <child name> <class>*\n(e.g. LINK Aarav Sharma 5A)\n\nSchool staff will verify and approve.",
    comingSoon: "This module is coming soon 🙌 Right now *attendance* and *fees* info is available — pick from the menu.",
    stopReply:
      "Okay ✅ You will no longer receive proactive updates from the school. You can still ask questions anytime. To turn updates back on, send *START*.",
    startReply: "Updates are back on ✅",
    yesConfirmed: "Thank you! ✅ Your number is confirmed.",
    linkedKidsSuffix: " Linked children: *{names}*",
    noReply: "Okay 🙏 We have informed the school. No student details will be sent to this number.",
    alreadyLinked: "Your number is already registered ✅ To add another child, please contact {office} — staff will link them from the panel. 🙏",
    linkUsage: "To link your number, send:\n*LINK <child name> <class>*\nE.g. LINK Aarav Sharma 5A",
    linkRateLimited: "Your request is already being processed. Please contact {office} (9am–3pm). 🙏",
    linkCreated: "Request received ✅ School staff will verify and approve. Once approved, attendance and fees details will be available in this chat.",
    pullRateLimited: "Today's query limit is reached 🙏 Please try again tomorrow, or contact {office}.",
    noStudents: "Your number is registered, but no student is linked to it yet. Please contact {office} 🙏",
    officeContact: "the school office",
    officeContactPhone: "the school office ({phone})",
    officeLine: "\nOffice: {phone}",
    classUnknown: "class —",
    attendanceHeader: "*{school} — Attendance*",
    feesHeader: "*{school} — Fees*",
    feesDueLine: "💰 *{name}* ({class}): *₹{amt}* is due. Please pay at the office — the receipt will be given there.",
    feesClearLine: "💰 *{name}* ({class}): no fees due ✅",
    cannedTimings: "🕒 *{school} — Timings*\n{timings}{officeLine}",
    cannedHolidays: "🌴 *{school} — Holidays*\n{holidays}",
    cannedNotices: "📢 *{school} — Notices*\n{notices}",
    noNotices: "No new notices right now.",
    aiFallback: "Sorry, I can't answer that right now. Please contact {office} (9am–3pm). 🙏",

    // ----- flow engine / shared -----
    backBtn: "⬅️ Back",
    confirmBtn: "✅ Confirm",
    editBtn: "✏️ Edit",
    skipBtn: "⏭️ Skip",
    flowExpired: "⏳ That session timed out — starting fresh.",
    flowCancelled: "Cancelled ✅",
    genericInvalid: "I didn't get that 🙈 Please pick from the options, or tap Back.",
    pickSection: "Choose the class-section:",
    pickSubject: "Choose the subject ({section}):",
    notTeacher: "This feature is for school teachers 🙏",
    noPerm: "You don't have permission for this 🙏 Please ask the school admin to enable it.",

    // ----- teacher: attendance -----
    teacherMenuBody: "Hello *{name}* 🙏 What would you like to do?",
    attPickMode: "Attendance — *{section}* ({day})\nChoose the mode:",
    attModePresent: "✅ Only Present",
    attModeAbsent: "❌ Only Absent",
    attAskRollsPresent:
      "Send the roll numbers of *present* students — any format works:\n`4 7 12` or `4,7,12` or one per line. Extra spaces are fine.",
    attAskRollsAbsent:
      "Send the roll numbers of *absent* students — any format works:\n`4 7 12` or `4,7,12` or one per line. Extra spaces are fine.",
    attNoneParsed: "I couldn't find any roll numbers 🙈 Try like: `4 7 12`",
    attEmptySection: "That class has no active students.",
    attPreview:
      "*{section}* — {day}\nMode: {mode}\n\n✅ *Present ({pc}):*\n{plist}\n\n❌ *Absent ({ac}):*\n{alist}{invalid}\n\nSave this attendance?",
    attInvalidRolls: "\n⚠️ Unknown roll numbers (fix before confirming): {rolls}",
    attSaved: "Attendance saved ✅ *{section}* — {present} present, {absent} absent. Notification delivery is tracked separately.",
    attUpdatedNote: " (today's earlier entry was updated)",
    parentAbsent: "⚠️ *{school}*\n*{name}* ({cls}) is *absent* today ({day}).",
    parentPresent: "✅ *{school}*\n*{name}* ({cls}) is *present* today ({day}).",
    parentOnLeave: "📩 *{school}*\n*{name}* ({cls}) is on *approved leave* today ({day}).",

    // ----- parent: attendance / marks pulls -----
    attTodayLine: "{icon} *{name}* ({cls})\nToday: {status} · This month: {pct}%",
    attStatusPresent: "Present ✅",
    attStatusAbsent: "Absent ❌",
    attStatusLeave: "On leave 📩",
    attStatusNone: "Not marked yet",
    marksParentHeader: "📊 *{school} — Marks*",
    marksKidHeader: "\n*{name}* ({cls})",
    marksExamLine: "• {exam} ({subject}): *{marks}/{total}*",
    marksNone: "No marks uploaded yet.",

    // ----- leave flow (parent/student) -----
    leavePickType: "🛌 Leave application — choose the type:",
    leaveSick: "🤒 Sick Leave",
    leaveOther: "📩 Other Reason",
    leavePickKid: "Which child is the leave for?",
    leaveAskReason: "Please write the reason in one line (e.g. fever, family function):",
    leavePreview:
      "🛌 *Leave request*\nStudent: *{name}* ({cls})\nType: {type}\nReason: {reason}\nDate: {day}\n\nSend it to the class teacher?",
    leaveSent: "Leave request sent ✅ The class teacher will approve or reject it right here.",
    leaveTeacherAsk:
      "📩 *Leave request* — {school}\nStudent: *{name}* ({cls}, roll {roll})\nType: {type}\nReason: {reason}\nDate: {day}",
    leaveApproveBtn: "✅ Approve",
    leaveRejectBtn: "❌ Reject",
    leaveApprovedParent: "✅ *Leave approved* — {name} ({day}).",
    leaveRejectedParent: "❌ *Leave not approved* — {name} ({day}).{reason}",
    leaveRejectReasonSuffix: "\nReason: {note}",
    leaveRejectAsk: "Add a short reason for rejecting? (optional — tap Skip to send without one)",
    leaveDecisionDone: "Done ✅ The parent has been informed.",
    leaveAlreadyDecided: "This request was already {status}.",

    // ----- teacher: marks upload -----
    marksPickSection: "📊 Upload marks — choose the class-section:",
    marksAskMeta: "Send the *test name* and *total marks* together, like: `Weekly Test 50`",
    marksMetaBad: "Please send: test name + total marks — e.g. `Unit Test 25`",
    marksAskData:
      "Now send the marks for *{subject}* ({section}) — {name}, out of {total}:\n\n• Type `roll marks`, one per line (e.g. `1 45`)\n• Or send a clear *photo* of the mark sheet 📸",
    marksPhotoWorking: "Reading the photo… 🔍",
    marksPhotoBad: "Couldn't read that photo 🙈 Send a clearer one (good light, flat page) — or type the marks instead.",
    marksNoneParsed: "No marks found 🙈 Type `roll marks` one per line (e.g. `1 45`), or send a photo.",
    marksInvalidRolls: "\n⚠️ Unknown roll numbers (fix before confirming): {rolls}",
    marksMissing: "\nℹ️ Missing: {names}",
    marksPreview: "*{subject} — {name}* (out of {total})\n{section}\n\n{lines}{invalid}{missing}\n\nSave these marks?",
    marksLine: "{roll}. {name} — {marks}",
    marksSaved: "Marks saved ✅ *{subject} — {name}* ({count} students).",
    marksEditAsk: "Send corrections like `roll 5 is 35` — or type the full list again.",
    marksHistEmpty: "No uploads yet — your uploads will show here.",
    marksHistPick: "🗂️ Your uploads — pick one to view or edit:",
    marksHistBtn: "{name} · {subject} · {section}",
    marksViewHeader: "*{subject} — {name}* (out of {total})\n{section} · {day}\n\n{lines}",
    marksEditDenied: "Editing marks needs the school admin's permission 🙏 You can view, but not edit.",
    marksEditHow: "Send corrections for *{name}* like: `roll 5 is 35`. Or tap Back.",
    marksEdited: "Marks updated ✅ {name} — {count} change(s). Parents now see the new values.",
    marksEditNone: "No corrections found 🙈 Try: `roll 5 is 35`",

    // ----- teacher: homework / tests -----
    hwPickSection: "📝 Homework — choose the class-section:",
    hwAskText: "Type the homework for *{subject}* ({section}):",
    hwSaved: "Homework posted ✅ {subject} — {section}. Parents can see it under Homework.",
    hwParentHeader: "📝 *{school} — Homework ({day})*",
    hwKidLine: "\n*{name}* ({cls}):",
    hwItem: "• {subject}: {text}",
    hwNone: "No homework posted today.",
    tdPickSection: "🗓️ Test date — choose the class-section:",
    tdAskMeta: "Send the *test name* and *date* together, like: `Science Test 2026-09-15`",
    tdBadMeta: "Please send: test name + date (YYYY-MM-DD) — e.g. `Maths Test 2026-09-12`",
    tdSaved: "Test announced ✅ *{name}* — {subject} ({section}) on {date}. Parents will see it under Date Sheet.",

    // ----- date sheet (everyone) -----
    dsHeader: "🗓️ *{school} — Date Sheet*",
    dsUpcoming: "\n\n*Upcoming tests:*\n{tests}",
    dsTestLine: "• {date}: {name} ({subject}, {cls})",
    dsNone: "No date sheet uploaded yet. Please ask the school office 🙏",
    dsPdfCaption: "🗓️ {school} — Date Sheet: {title}",
    dsSavedText: "Date sheet saved ✅ Parents will now see it under Date Sheet.",
    dsSavedPdf: "Date sheet PDF saved ✅ ({name}) — parents will receive it as a document.",
    dsUploadHint: "To upload the official date sheet: send it here as a *PDF document* (or paste the text). Latest upload replaces the old one.",

    // ----- school admin bot extras -----
    adminMenuRow: "🏫 Admin Today",
    adminSummary: "🏫 *{school} — Today ({day})*\n✅ Present: {present}\n❌ Absent: {absent}\n📩 On leave: {leave}\n🕒 Leaves pending: {pending}\n📝 Homework posts: {homework}",
  },
  hi: {
    unknownSchool: "यह WhatsApp नंबर अभी सेटअप हो रहा है। कृपया थोड़ी देर बाद प्रयास करें 🙏",
    menuBody: "आप क्या जानना चाहते हैं?",
    menuButton: "मेनू खोलें",
    langPickerIntro: "🌐 Choose your language / अपनी भाषा चुनें / Apni bhasha chunein:",
    langSetConfirm: "भाषा *हिन्दी* हो गई ✅",
    nonText: "कृपया अपना सवाल टेक्स्ट में लिखें 🙂 — या मेनू का उपयोग करें।",
    greeting: "नमस्ते 🙏 *{school}* में आपका स्वागत है! मैं स्कूल की जानकारी के लिए यहां हूं।",
    kidsLine: "\nआपके जुड़े बच्चे: *{names}*",
    confirmPrompt:
      "नमस्ते 🙏 *{school}* से। आपका यह WhatsApp नंबर स्कूल ने एक अभिभावक के रूप में दर्ज किया है।\n\n➡️ यदि आप अभिभावक हैं तो *YES* लिखें।\n➡️ यदि यह नंबर गलती से दर्ज हुआ है तो *NO* लिखें।",
    privacyLocked:
      "🔒 यह जानकारी केवल *पंजीकृत अभिभावकों* को दी जाती है।\n\nयदि आप इस स्कूल के अभिभावक हैं तो अपना WhatsApp नंबर लिंक करवाएं — लिखें:\n*LINK <बच्चे का नाम> <कक्षा>*\n(जैसे: LINK Aarav Sharma 5A)\n\nस्कूल स्टाफ सत्यापित करके मंजूरी देगा।",
    comingSoon: "यह मॉड्यूल जल्द आ रहा है 🙌 अभी *attendance* और *fees* की जानकारी उपलब्ध है — मेनू से चुनें।",
    stopReply: "ठीक है ✅ अब आपको स्कूल की ओर से कोई अपडेट नहीं भेजा जाएगा। आप अपने सवाल फिर भी पूछ सकते हैं। अपडेट वापस शुरू करने के लिए *START* लिखें।",
    startReply: "अपडेट वापस चालू हो गए ✅",
    yesConfirmed: "धन्यवाद! ✅ आपका नंबर कन्फर्म हो गया है।",
    linkedKidsSuffix: " जुड़े बच्चे: *{names}*",
    noReply: "ठीक है 🙏 हमने स्कूल को सूचित कर दिया है। इस नंबर पर कोई छात्र जानकारी नहीं भेजी जाएगी।",
    alreadyLinked: "आपका नंबर पहले से पंजीकृत है ✅ नया बच्चा जुड़वाने के लिए {office} से संपर्क करें — स्टाफ पैनल से लिंक कर देगा। 🙏",
    linkUsage: "नंबर लिंक करवाने के लिए लिखें:\n*LINK <बच्चे का नाम> <कक्षा>*\nजैसे: LINK Aarav Sharma 5A",
    linkRateLimited: "आपका अनुरोध पहले से प्रक्रिया में है। कृपया {office} से संपर्क करें (9am–3pm)। 🙏",
    linkCreated: "अनुरोध मिल गया ✅ स्कूल स्टाफ सत्यापित करके मंजूरी देगा। मंजूरी के बाद attendance और fees की जानकारी इसी चैट में मिलेगी।",
    pullRateLimited: "आज की क्वेरी सीमा पूरी हो गई 🙏 कल फिर प्रयास करें, या {office} से संपर्क करें।",
    noStudents: "आपका नंबर पंजीकृत है, पर अभी कोई छात्र लिंक नहीं है। कृपया {office} से संपर्क करें 🙏",
    officeContact: "स्कूल कार्यालय",
    officeContactPhone: "स्कूल कार्यालय ({phone})",
    officeLine: "\nकार्यालय: {phone}",
    classUnknown: "कक्षा —",
    attendanceHeader: "*{school} — उपस्थिति*",
    feesHeader: "*{school} — फीस*",
    feesDueLine: "💰 *{name}* ({class}): *₹{amt}* बकाया है। कृपया कार्यालय में जमा करें — रसीद वहीं मिलेगी।",
    feesClearLine: "💰 *{name}* ({class}): कोई फीस बकाया नहीं ✅",
    cannedTimings: "🕒 *{school} — समय*\n{timings}{officeLine}",
    cannedHolidays: "🌴 *{school} — छुट्टियां*\n{holidays}",
    cannedNotices: "📢 *{school} — सूचनाएं*\n{notices}",
    noNotices: "अभी कोई नई सूचना नहीं है।",
    aiFallback: "क्षमा करें, अभी मैं उत्तर नहीं दे पा रहा। कृपया {office} से संपर्क करें (9am–3pm)। 🙏",

    backBtn: "⬅️ वापस",
    confirmBtn: "✅ कन्फर्म",
    editBtn: "✏️ बदलें",
    skipBtn: "⏭️ छोड़ें",
    flowExpired: "⏳ सेशन का समय पूरा हो गया — फिर से शुरू कर रहे हैं।",
    flowCancelled: "रद्द किया गया ✅",
    genericInvalid: "समझ नहीं पाया 🙈 कृपया विकल्प चुनें, या वापस जाएं।",
    pickSection: "कक्षा-सेक्शन चुनें:",
    pickSubject: "विषय चुनें ({section}):",
    notTeacher: "यह सुविधा स्कूल के शिक्षकों के लिए है 🙏",
    noPerm: "इस सुविधा की अनुमति आपके पास नहीं है 🙏 कृपया स्कूल एडमिन से चालू करवाएं।",

    teacherMenuBody: "नमस्ते *{name}* जी 🙏 क्या करना चाहेंगे?",
    attPickMode: "उपस्थिति — *{section}* ({day})\nमोड चुनें:",
    attModePresent: "✅ सिर्फ उपस्थित",
    attModeAbsent: "❌ सिर्फ अनुपस्थित",
    attAskRollsPresent: "*उपस्थित* छात्रों के रोल नंबर भेजें — कोई भी format चलेगा:\n`4 7 12` या `4,7,12` या एक लाइन में एक।",
    attAskRollsAbsent: "*अनुपस्थित* छात्रों के रोल नंबर भेजें — कोई भी format चलेगा:\n`4 7 12` या `4,7,12` या एक लाइन में एक।",
    attNoneParsed: "रोल नंबर नहीं मिले 🙈 ऐसे लिखें: `4 7 12`",
    attEmptySection: "इस कक्षा में कोई सक्रिय छात्र नहीं है।",
    attPreview:
      "*{section}* — {day}\nमोड: {mode}\n\n✅ *उपस्थित ({pc}):*\n{plist}\n\n❌ *अनुपस्थित ({ac}):*\n{alist}{invalid}\n\nक्या यह उपस्थिति सहेजें?",
    attInvalidRolls: "\n⚠️ अज्ञात रोल नंबर (छोड़े गए): {rolls}",
    attSaved: "उपस्थिति सहेजी गई ✅ *{section}* — {present} उपस्थित, {absent} अनुपस्थित। सूचनाओं की वितरण स्थिति पैनल में देखें।",
    attUpdatedNote: " (आज की पुरानी एंट्री अपडेट हुई)",
    parentAbsent: "⚠️ *{school}*\n*{name}* ({cls}) आज ({day}) *अनुपस्थित* है।",
    parentPresent: "✅ *{school}*\n*{name}* ({cls}) आज ({day}) *उपस्थित* है।",
    parentOnLeave: "📩 *{school}*\n*{name}* ({cls}) आज ({day}) *स्वीकृत अवकाश* पर है।",

    attTodayLine: "{icon} *{name}* ({cls})\nआज: {status} · इस महीने: {pct}%",
    attStatusPresent: "उपस्थित ✅",
    attStatusAbsent: "अनुपस्थित ❌",
    attStatusLeave: "अवकाश पर 📩",
    attStatusNone: "अभी दर्ज नहीं",
    marksParentHeader: "📊 *{school} — अंक*",
    marksKidHeader: "\n*{name}* ({cls})",
    marksExamLine: "• {exam} ({subject}): *{marks}/{total}*",
    marksNone: "अभी कोई अंक अपलोड नहीं हुए।",

    leavePickType: "🛌 अवकाश आवेदन — प्रकार चुनें:",
    leaveSick: "🤒 बीमारी की छुट्टी",
    leaveOther: "📩 अन्य कारण",
    leavePickKid: "अवकाश किस बच्चे के लिए है?",
    leaveAskReason: "कृपया कारण एक लाइन में लिखें (जैसे: बुखार, पारिवारिक कार्यक्रम):",
    leavePreview:
      "🛌 *अवकाश आवेदन*\nछात्र: *{name}* ({cls})\nप्रकार: {type}\nकारण: {reason}\nतिथि: {day}\n\nकक्षा शिक्षक को भेजें?",
    leaveSent: "अवकाश आवेदन भेजा गया ✅ कक्षा शिक्षक यहीं स्वीकार/अस्वीकार करेंगे।",
    leaveTeacherAsk:
      "📩 *अवकाश आवेदन* — {school}\nछात्र: *{name}* ({cls}, रोल {roll})\nप्रकार: {type}\nकारण: {reason}\nतिथि: {day}",
    leaveApproveBtn: "✅ स्वीकार",
    leaveRejectBtn: "❌ अस्वीकार",
    leaveApprovedParent: "✅ *अवकाश स्वीकृत* — {name} ({day})।",
    leaveRejectedParent: "❌ *अवकाश स्वीकृत नहीं* — {name} ({day})।{reason}",
    leaveRejectReasonSuffix: "\nकारण: {note}",
    leaveRejectAsk: "अस्वीकार करने का छोटा कारण जोड़ें? (वैकल्पिक — बिना कारण भेजने के लिए Skip दबाएं)",
    leaveDecisionDone: "हो गया ✅ अभिभावक को सूचित कर दिया गया है।",
    leaveAlreadyDecided: "यह अनुरोध पहले ही {status} हो चुका है।",

    marksPickSection: "📊 अंक अपलोड — कक्षा-सेक्शन चुनें:",
    marksAskMeta: "*टेस्ट का नाम* और *पूर्णांक* साथ में भेजें, जैसे: `Weekly Test 50`",
    marksMetaBad: "कृपया भेजें: टेस्ट नाम + पूर्णांक — जैसे `Unit Test 25`",
    marksAskData:
      "अब *{subject}* ({section}) के अंक भेजें — {name}, {total} में से:\n\n• `रोल अंक` एक लाइन में एक (जैसे `1 45`)\n• या मार्कशीट की साफ *फोटो* भेजें 📸",
    marksPhotoWorking: "फोटो पढ़ी जा रही है… 🔍",
    marksPhotoBad: "फोटो पढ़ी नहीं गई 🙈 साफ फोटो भेजें (अच्छी रोशनी, सीधा पेज) — या अंक टाइप करें।",
    marksNoneParsed: "अंक नहीं मिले 🙈 `रोल अंक` एक लाइन में एक लिखें (जैसे `1 45`), या फोटो भेजें।",
    marksInvalidRolls: "\n⚠️ अज्ञात रोल नंबर (छोड़े गए): {rolls}",
    marksMissing: "\nℹ️ छूटे हुए: {names}",
    marksPreview: "*{subject} — {name}* ({total} में से)\n{section}\n\n{lines}{invalid}{missing}\n\nक्या ये अंक सहेजें?",
    marksLine: "{roll}. {name} — {marks}",
    marksSaved: "अंक सहेजे गए ✅ *{subject} — {name}* ({count} छात्र)।",
    marksEditAsk: "सुधार ऐसे भेजें: `roll 5 is 35` — या पूरी सूची फिर से लिखें।",
    marksHistEmpty: "अभी कोई अपलोड नहीं — आपके अपलोड यहां दिखेंगे।",
    marksHistPick: "🗂️ आपके अपलोड — देखने या सुधारने के लिए चुनें:",
    marksHistBtn: "{name} · {subject} · {section}",
    marksViewHeader: "*{subject} — {name}* ({total} में से)\n{section} · {day}\n\n{lines}",
    marksEditDenied: "अंक सुधारने की अनुमति स्कूल एडमिन देता है 🙏 आप देख सकते हैं, बदल नहीं सकते।",
    marksEditHow: "*{name}* के लिए सुधार भेजें, जैसे: `roll 5 is 35`. या वापस जाएं।",
    marksEdited: "अंक अपडेट हुए ✅ {name} — {count} बदलाव। अभिभावक अब नए अंक देखेंगे।",
    marksEditNone: "कोई सुधार नहीं मिला 🙈 ऐसे लिखें: `roll 5 is 35`",

    hwPickSection: "📝 होमवर्क — कक्षा-सेक्शन चुनें:",
    hwAskText: "*{subject}* ({section}) का होमवर्क लिखें:",
    hwSaved: "होमवर्क भेजा गया ✅ {subject} — {section}. अभिभावक इसे Homework में देख सकते हैं।",
    hwParentHeader: "📝 *{school} — होमवर्क ({day})*",
    hwKidLine: "\n*{name}* ({cls}):",
    hwItem: "• {subject}: {text}",
    hwNone: "आज कोई होमवर्क नहीं आया।",
    tdPickSection: "🗓️ टेस्ट तिथि — कक्षा-सेक्शन चुनें:",
    tdAskMeta: "*टेस्ट का नाम* और *तिथि* साथ में भेजें, जैसे: `Science Test 2026-09-15`",
    tdBadMeta: "कृपया भेजें: टेस्ट नाम + तिथि (YYYY-MM-DD) — जैसे `Maths Test 2026-09-12`",
    tdSaved: "टेस्ट घोषित ✅ *{name}* — {subject} ({section}), {date} को। अभिभावक इसे Date Sheet में देखेंगे।",

    dsHeader: "🗓️ *{school} — डेट शीट*",
    dsUpcoming: "\n\n*आगामी टेस्ट:*\n{tests}",
    dsTestLine: "• {date}: {name} ({subject}, {cls})",
    dsNone: "अभी कोई डेट शीट अपलोड नहीं हुई। कृपया स्कूल कार्यालय से पूछें 🙏",
    dsPdfCaption: "🗓️ {school} — डेट शीट: {title}",
    dsSavedText: "डेट शीट सहेजी गई ✅ अभिभावक अब इसे Date Sheet में देखेंगे।",
    dsSavedPdf: "डेट शीट PDF सहेजी गई ✅ ({name}) — अभिभावकों को दस्तावेज़ के रूप में मिलेगी।",
    dsUploadHint: "आधिकारिक डेट शीट अपलोड करने के लिए: यहां *PDF दस्तावेज़* भेजें (या टेक्स्ट पेस्ट करें)। नई अपलोड पुरानी की जगह ले लेती है।",

    adminMenuRow: "🏫 एडमिन टुडे",
    adminSummary: "🏫 *{school} — आज ({day})*\n✅ उपस्थित: {present}\n❌ अनुपस्थित: {absent}\n📩 अवकाश पर: {leave}\n🕒 लंबित अवकाश: {pending}\n📝 होमवर्क पोस्ट: {homework}",
  },
  hg: {
    unknownSchool: "Ye WhatsApp number abhi setup ho raha hai. Kripya thodi der baad try karein 🙏",
    menuBody: "Aap kya jaanna chahte hain?",
    menuButton: "Menu Kholo",
    langPickerIntro: "🌐 Choose your language / अपनी भाषा चुनें / Apni bhasha chunein:",
    langSetConfirm: "Bhasha *Hinglish* ho gayi ✅",
    nonText: "Aap apna sawaal text me likhiye 🙂 — ya menu use kariye.",
    greeting: "Namaste 🙏 *{school}* me aapka swagat hai! Main school ki jaankari ke liye yahan hoon.",
    kidsLine: "\nAapke linked bachche: *{names}*",
    confirmPrompt:
      "Namaste 🙏 *{school}* se. Aapka ye WhatsApp number school ne ek parent ke roop me register kiya hai.\n\n➡️ Agar aap parent hain to *YES* likhiye.\n➡️ Agar ye number galti se register hua hai to *NO* likhiye.",
    privacyLocked:
      "🔒 Ye details sirf *registered parents* ko milti hain.\n\nAgar aap is school ke parent hain to apna WhatsApp number link karwaiye — likhiye:\n*LINK <bachche ka naam> <class>*\n(jaise: LINK Aarav Sharma 5A)\n\nSchool staff verify karke approve karega.",
    comingSoon: "Ye module jald aa raha hai 🙌 Abhi *attendance* aur *fees* ki jaankari available hai — menu se choose kariye.",
    stopReply:
      "Theek hai ✅ Aapko school ki taraf se koi proactive update nahi bheja jayega. Aap apne sawaal ab bhi puch sakte hain. Updates wapas shuru karne ke liye *START* likhiye.",
    startReply: "Updates wapas on ho gaye ✅",
    yesConfirmed: "Shukriya! ✅ Aapka number confirm ho gaya hai.",
    linkedKidsSuffix: " Linked bachche: *{names}*",
    noReply: "Theek hai 🙏 Humne school ko inform kar diya hai. Aapko is number par koi student details nahi bheji jayengi.",
    alreadyLinked: "Aapka number pehle se registered hai ✅ Naya bachcha add karwane ke liye {office} se sampark karein — staff panel se link kar dega. 🙏",
    linkUsage: "Number link karwane ke liye likhiye:\n*LINK <bachche ka naam> <class>*\nJaise: LINK Aarav Sharma 5A",
    linkRateLimited: "Aapki request pehle se process me hai. {office} se sampark karein (9am–3pm). 🙏",
    linkCreated: "Request mil gayi ✅ School staff verify karke approve karega. Approval ke baad attendance aur fees ki details isi chat me milengi.",
    pullRateLimited: "Aaj ki query limit poori ho gayi 🙏 Kal phir try karein, ya {office} se sampark karein.",
    noStudents: "Aapka number registered hai, par abhi koi student linked nahi hai. {office} se sampark karein 🙏",
    officeContact: "school office",
    officeContactPhone: "school office ({phone})",
    officeLine: "\nOffice: {phone}",
    classUnknown: "class —",
    attendanceHeader: "*{school} — Attendance*",
    feesHeader: "*{school} — Fees*",
    feesDueLine: "💰 *{name}* ({class}): *₹{amt}* due hai. Office me jama karein — receipt wahin milegi.",
    feesClearLine: "💰 *{name}* ({class}): koi fees due nahi ✅",
    cannedTimings: "🕒 *{school} — Timings*\n{timings}{officeLine}",
    cannedHolidays: "🌴 *{school} — Holidays*\n{holidays}",
    cannedNotices: "📢 *{school} — Notices*\n{notices}",
    noNotices: "Abhi koi naya notice nahi hai.",
    aiFallback: "Maaf kijiye, abhi main jawab nahi de pa raha. Aap {office} se sampark karein (9am–3pm). 🙏",

    backBtn: "⬅️ Back",
    confirmBtn: "✅ Confirm",
    editBtn: "✏️ Edit",
    skipBtn: "⏭️ Skip",
    flowExpired: "⏳ Session ka time khatam ho gaya — fresh start kar rahe hain.",
    flowCancelled: "Cancel ho gaya ✅",
    genericInvalid: "Samajh nahi aaya 🙈 Options me se choose karein, ya Back dabayein.",
    pickSection: "Class-section choose karein:",
    pickSubject: "Subject choose karein ({section}):",
    notTeacher: "Ye feature school teachers ke liye hai 🙏",
    noPerm: "Aapke paas is feature ki permission nahi hai 🙏 School admin se ON karwayein.",

    teacherMenuBody: "Namaste *{name}* ji 🙏 Kya karna chahenge?",
    attPickMode: "Attendance — *{section}* ({day})\nMode choose karein:",
    attModePresent: "✅ Sirf Present",
    attModeAbsent: "❌ Sirf Absent",
    attAskRollsPresent: "*Present* students ke roll numbers bhejein — koi bhi format chalega:\n`4 7 12` ya `4,7,12` ya ek line me ek. Extra spaces chalega.",
    attAskRollsAbsent: "*Absent* students ke roll numbers bhejein — koi bhi format chalega:\n`4 7 12` ya `4,7,12` ya ek line me ek. Extra spaces chalega.",
    attNoneParsed: "Roll numbers nahi mile 🙈 Aise likhein: `4 7 12`",
    attEmptySection: "Is class me koi active student nahi hai.",
    attPreview:
      "*{section}* — {day}\nMode: {mode}\n\n✅ *Present ({pc}):*\n{plist}\n\n❌ *Absent ({ac}):*\n{alist}{invalid}\n\nYe attendance save karein?",
    attInvalidRolls: "\n⚠️ Unknown roll numbers (ignore kiye): {rolls}",
    attSaved: "Attendance save ho gayi ✅ *{section}* — {present} present, {absent} absent. Notification delivery panel mein check karein.",
    attUpdatedNote: " (aaj ki purani entry update ho gayi)",
    parentAbsent: "⚠️ *{school}*\n*{name}* ({cls}) aaj ({day}) *absent* hai.",
    parentPresent: "✅ *{school}*\n*{name}* ({cls}) aaj ({day}) *present* hai.",
    parentOnLeave: "📩 *{school}*\n*{name}* ({cls}) aaj ({day}) *approved leave* par hai.",

    attTodayLine: "{icon} *{name}* ({cls})\nAaj: {status} · Is mahine: {pct}%",
    attStatusPresent: "Present ✅",
    attStatusAbsent: "Absent ❌",
    attStatusLeave: "Leave par 📩",
    attStatusNone: "Abhi mark nahi hui",
    marksParentHeader: "📊 *{school} — Marks*",
    marksKidHeader: "\n*{name}* ({cls})",
    marksExamLine: "• {exam} ({subject}): *{marks}/{total}*",
    marksNone: "Abhi koi marks upload nahi hue.",

    leavePickType: "🛌 Leave application — type choose karein:",
    leaveSick: "🤒 Sick Leave",
    leaveOther: "📩 Other Reason",
    leavePickKid: "Leave kis bachche ke liye hai?",
    leaveAskReason: "Reason ek line me likhein (jaise: fever, family function):",
    leavePreview:
      "🛌 *Leave request*\nStudent: *{name}* ({cls})\nType: {type}\nReason: {reason}\nDate: {day}\n\nClass teacher ko bhejein?",
    leaveSent: "Leave request bhej di gayi ✅ Class teacher yahin approve/reject karenge.",
    leaveTeacherAsk:
      "📩 *Leave request* — {school}\nStudent: *{name}* ({cls}, roll {roll})\nType: {type}\nReason: {reason}\nDate: {day}",
    leaveApproveBtn: "✅ Approve",
    leaveRejectBtn: "❌ Reject",
    leaveApprovedParent: "✅ *Leave approved* — {name} ({day}).",
    leaveRejectedParent: "❌ *Leave approved nahi hui* — {name} ({day}).{reason}",
    leaveRejectReasonSuffix: "\nReason: {note}",
    leaveRejectAsk: "Reject karne ka chhota reason likhein? (optional — bina reason bhejne ke liye Skip dabayein)",
    leaveDecisionDone: "Ho gaya ✅ Parent ko inform kar diya gaya hai.",
    leaveAlreadyDecided: "Ye request pehle hi {status} ho chuki hai.",

    marksPickSection: "📊 Marks upload — class-section choose karein:",
    marksAskMeta: "*Test ka naam* aur *total marks* saath me bhejein, jaise: `Weekly Test 50`",
    marksMetaBad: "Kripya bhejein: test naam + total marks — jaise `Unit Test 25`",
    marksAskData:
      "Ab *{subject}* ({section}) ke marks bhejein — {name}, {total} me se:\n\n• `roll marks` ek line me ek (jaise `1 45`)\n• Ya mark sheet ki saaf *photo* bhejein 📸",
    marksPhotoWorking: "Photo padhi ja rahi hai… 🔍",
    marksPhotoBad: "Photo padh nahi paya 🙈 Saaf photo bhejein (acchi light, seedha page) — ya marks type karein.",
    marksNoneParsed: "Marks nahi mile 🙈 `roll marks` ek line me ek likhein (jaise `1 45`), ya photo bhejein.",
    marksInvalidRolls: "\n⚠️ Unknown roll numbers (ignore kiye): {rolls}",
    marksMissing: "\nℹ️ Missing: {names}",
    marksPreview: "*{subject} — {name}* ({total} me se)\n{section}\n\n{lines}{invalid}{missing}\n\nYe marks save karein?",
    marksLine: "{roll}. {name} — {marks}",
    marksSaved: "Marks save ho gaye ✅ *{subject} — {name}* ({count} students).",
    marksEditAsk: "Corrections aise bhejein: `roll 5 is 35` — ya poori list dubara likhein.",
    marksHistEmpty: "Abhi koi upload nahi — aapke uploads yahan dikhenge.",
    marksHistPick: "🗂️ Aapke uploads — dekhne ya edit karne ke liye choose karein:",
    marksHistBtn: "{name} · {subject} · {section}",
    marksViewHeader: "*{subject} — {name}* ({total} me se)\n{section} · {day}\n\n{lines}",
    marksEditDenied: "Marks edit karne ki permission school admin deta hai 🙏 Aap dekh sakte hain, badal nahi sakte.",
    marksEditHow: "*{name}* ke liye corrections bhejein, jaise: `roll 5 is 35`. Ya Back dabayein.",
    marksEdited: "Marks update ho gaye ✅ {name} — {count} change(s). Parents ab naye marks dekhenge.",
    marksEditNone: "Koi correction nahi mila 🙈 Aise likhein: `roll 5 is 35`",

    hwPickSection: "📝 Homework — class-section choose karein:",
    hwAskText: "*{subject}* ({section}) ka homework likhein:",
    hwSaved: "Homework post ho gaya ✅ {subject} — {section}. Parents ise Homework me dekh sakte hain.",
    hwParentHeader: "📝 *{school} — Homework ({day})*",
    hwKidLine: "\n*{name}* ({cls}):",
    hwItem: "• {subject}: {text}",
    hwNone: "Aaj koi homework nahi aaya.",
    tdPickSection: "🗓️ Test date — class-section choose karein:",
    tdAskMeta: "*Test ka naam* aur *date* saath me bhejein, jaise: `Science Test 2026-09-15`",
    tdBadMeta: "Kripya bhejein: test naam + date (YYYY-MM-DD) — jaise `Maths Test 2026-09-12`",
    tdSaved: "Test announce ho gaya ✅ *{name}* — {subject} ({section}), {date} ko. Parents ise Date Sheet me dekhenge.",

    dsHeader: "🗓️ *{school} — Date Sheet*",
    dsUpcoming: "\n\n*Aane wale tests:*\n{tests}",
    dsTestLine: "• {date}: {name} ({subject}, {cls})",
    dsNone: "Abhi koi date sheet upload nahi hui. School office se puchein 🙏",
    dsPdfCaption: "🗓️ {school} — Date Sheet: {title}",
    dsSavedText: "Date sheet save ho gayi ✅ Parents ab ise Date Sheet me dekhenge.",
    dsSavedPdf: "Date sheet PDF save ho gayi ✅ ({name}) — parents ko document ke roop me milegi.",
    dsUploadHint: "Official date sheet upload karne ke liye: yahan *PDF document* bhejein (ya text paste karein). Nayi upload purani ki jagah le leti hai.",

    adminMenuRow: "🏫 Admin Today",
    adminSummary: "🏫 *{school} — Aaj ({day})*\n✅ Present: {present}\n❌ Absent: {absent}\n📩 Leave par: {leave}\n🕒 Pending leaves: {pending}\n📝 Homework posts: {homework}",
  },
};

// t("hi", "greeting", { school: "DPS" }) — falls back to english for missing keys
export function t(lang, key, vars = {}) {
  const pack = STRINGS[lang] || STRINGS.en;
  let s = pack[key] ?? STRINGS.en[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.split("{" + k + "}").join(String(v));
  return s;
}
