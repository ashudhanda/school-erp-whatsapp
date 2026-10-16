import { schoolForPhoneNumberId } from "./schools.js";
import { classify } from "./intents.js";
import { answerQuestion } from "./ai/brain.js";
import { sendText, sendMenu, sendList } from "./whatsapp.js";
import { logMessage, audit, getUserLang, setUserLang } from "./db.js";
import { sendAlert } from "./alerts.js";
import {
  resolveIdentity,
  confirmParent,
  denyParent,
  setOptOut,
  pullRateLimited,
  linkRateLimited,
  createLinkRequest,
} from "./identity.js";
import { t, menuRows, langPickerRows, isLangId, langFromId } from "./i18n.js";

// fallback phrases: "menu" works even in a fresh chat; "language" re-opens the picker
const isMenuAsk = (x) => /(menu|options|option|मेनू)/i.test(String(x || ""));
const isLangAsk = (x) => /(language|bhasha|भाषा)/i.test(String(x || ""));

// Parent-confirm vocabulary (en/hi/hinglish): trimmed and fully anchored, so a message
// like "yes please send the marks" never accidentally confirms — only an exact YES/NO reply counts.
const isYes = (x) => /^(yes+|y|haan+|han|ji|ji haan|haanji|ok|okay|theek hai|confirm)[\s.!,]*$/i.test(String(x || "").trim());
const isNo = (x) => /^(no+|n|nahi+|nahin|nhi|galat|galat number|wrong|wrong number)[\s.!,]*$/i.test(String(x || "").trim());

// timetable is personal (class-specific) — coming-soon, not the ai (fix M3)
const PERSONAL_INTENTS = new Set(["attendance", "marks", "fees", "homework", "timetable"]);

const AI_QUESTION_FOR_INTENT = {
  admission: "Tell me about the admission process",
  timings: "What are the school timings?",
  holidays: "What are the upcoming holidays?",
  notices: "Any current notices?",
};

export async function handleWebhookPayload(payload) {
  // meta batches webhooks — every entry and every change must be processed (fix H4)
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value;
      const messages = value?.messages;
      if (!Array.isArray(messages) || messages.length === 0) continue; // delivery receipts etc.

      const phoneNumberId = value.metadata?.phone_number_id;
      const school = await schoolForPhoneNumberId(phoneNumberId);

      for (const msg of messages) {
        if (!school) {
          // unknown number: telegram alert already sent by schools.js — never demo data (fix H2)
          console.error("[router] no school for phone_number_id", phoneNumberId);
          if (msg.from) {
            await sendText(phoneNumberId, msg.from, t("en", "unknownSchool")); // prefs unknown here — default english
          }
          continue;
        }
        console.log("[router]", msg.type, "from", msg.from, "— school:", school.id);
        try {
          await handleMessage(school, phoneNumberId, msg);
        } catch (err) {
          console.error("[router] message failed:", err);
        }
      }
    }
  }
}

// every non-menu reply ends with the menu — the user never scrolls back up for it.
// pass bodyOverride for a custom menu header (e.g. after language change).
async function sendReply(phoneNumberId, to, lang, body, bodyOverride) {
  await sendText(phoneNumberId, to, body);
  await sendMenu(phoneNumberId, to, bodyOverride || t(lang, "menuBody"), menuRows(lang), t(lang, "menuButton"));
}

// zero-cost instant answers — from the school's OWN data (fix H5), never
// hardcoded demo values. empty fields fall through to the ai + kb.
function cannedReply(intent, school, lang) {
  const officeLine = school.officePhone ? t(lang, "officeLine", { phone: school.officePhone }) : "";
  if (intent === "timings" && school.timings)
    return t(lang, "cannedTimings", { school: school.name, timings: school.timings, officeLine });
  if (intent === "holidays" && school.holidays) return t(lang, "cannedHolidays", { school: school.name, holidays: school.holidays });
  if (intent === "notices") return t(lang, "cannedNotices", { school: school.name, notices: school.notices || t(lang, "noNotices") });
  return null; // school hasn't filled this field yet — the ai answers from the kb below
}

function officeContact(school, lang) {
  return school.officePhone ? t(lang, "officeContactPhone", { phone: school.officePhone }) : t(lang, "officeContact");
}

// "Rohan (5 A), Siya (3 B)" — one line per linked child, used in greetings/confirmations
const kidsNames = (identity, lang) =>
  identity.students.map((s) => `${s.name} (${s.class_name || t(lang, "classUnknown")})`).join(", ");

/**
 * Route one inbound WhatsApp message through the full decision pipeline, in order:
 * 1. interactive taps (button/list ids) become the intent directly — zero typo risk
 * 2. language picker resolves before anything else so it works in any script
 * 3. non-text payloads get the menu + "send text" hint
 * 4. STOP/START flips the persisted opt-out flag (phase-3 reminders honor it)
 * 5. identity gate: unconfirmed parents confirm once with YES/NO; personal data
 *    stays locked until then, but public info still works
 * 6. LINK requests create a staff-verified link ticket (rate-limited)
 * 7. greetings, keyword intents (classify), then free-text "menu"/"language" fallbacks
 * 8. personal intents (attendance/fees/marks/homework/timetable) are served by CODE
 *    from the students table — never by the AI — after the confirmation + rate checks
 * 9. zero-cost canned answers from the school's own data, then the AI knowledge
 *    base, then the fallback message that points at the school office
 * Every reply (except the language picker) ends with the menu via sendReply.
 */
async function handleMessage(school, phoneNumberId, msg) {
  const from = msg.from; // meta-verified sender number — this IS the identity
  let text = "";
  let intent = null;

  if (msg.type === "interactive") {
    // button tap / list pick = exact intent, zero typo risk
    intent = msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id || null;
  } else if (msg.type === "text") {
    text = (msg.text?.body || "").trim();
  }

  // the language picker must work in ANY script, so resolve the lang id before
  // we know the user's language (picker rows are script-independent)
  let lang = (await getUserLang(school.id, from)) || "en"; // default: english
  if (intent && isLangId(intent)) {
    lang = langFromId(intent);
    await setUserLang(school.id, from, lang);
    await audit(school.id, from, "lang_set", lang);
    await sendReply(phoneNumberId, from, lang, t(lang, "langSetConfirm"), t(lang, "greeting", { school: school.name }));
    return;
  }

  if (msg.type !== "text" && msg.type !== "interactive") {
    await sendReply(phoneNumberId, from, lang, t(lang, "nonText"));
    return;
  }

  await logMessage(school.id, from, intent, text);
  let identity = await resolveIdentity(school.id, from);

  // STOP / START are persisted (fix M4) — phase 3 reminders will honor opted_out
  if (/^(stop|unsubscribe|band karo)\b/i.test(text)) {
    if (identity) await setOptOut(school.id, from, true);
    await sendReply(phoneNumberId, from, lang, t(lang, "stopReply"));
    return;
  }
  if (/^(start|subscribe|shuru karo)\b/i.test(text)) {
    if (identity) await setOptOut(school.id, from, false);
    await sendReply(phoneNumberId, from, lang, t(lang, "startReply"));
    return;
  }

  // ---------- identity gate (the hard rule, in code — never in the ai) ----------
  // imported parents stay locked until they confirm once with YES (red-team fix #10)
  let needsConfirm = false;
  if (identity && !identity.confirmed) {
    if (isYes(text)) {
      await confirmParent(school.id, from);
      const names = kidsNames(identity, lang);
      await sendReply(phoneNumberId, from, lang, t(lang, "yesConfirmed") + (names ? t(lang, "linkedKidsSuffix", { names }) : ""));
      return;
    }
    if (isNo(text)) {
      // wrong number in the csv — remember it, tell staff, never re-prompt (fix M5)
      await denyParent(school.id, from);
      await sendAlert(`⚠️ ${school.name}: number ${from} replied NO to the parent-confirm prompt — likely a mistyped number. Check Panel → Parents.`);
      await sendReply(phoneNumberId, from, lang, t(lang, "noReply"));
      return;
    }
    if (identity.optedOut) {
      identity = null; // said NO earlier — treat as unknown, no re-prompts
    } else {
      needsConfirm = true; // personal data stays locked; public info still works below
    }
  }

  // link request: LINK <child name> <class> — staff verifies offline, then approves in panel
  const linkMatch = text.match(/^link\b[\s:,-]*(.*)$/i);
  if (linkMatch && identity && identity.confirmed) {
    // already linked (fix L5) — don't dump this into the ai
    await sendReply(phoneNumberId, from, lang, t(lang, "alreadyLinked", { office: officeContact(school, lang) }));
    return;
  }
  if (linkMatch && needsConfirm) {
    await sendReply(phoneNumberId, from, lang, t(lang, "confirmPrompt", { school: school.name }));
    return;
  }
  if (linkMatch && !identity) {
    const note = (linkMatch[1] || "").trim().slice(0, 120);
    if (!note) {
      await sendReply(phoneNumberId, from, lang, t(lang, "linkUsage"));
      return;
    }
    if (linkRateLimited(school.id, from)) {
      await sendReply(phoneNumberId, from, lang, t(lang, "linkRateLimited", { office: officeContact(school, lang) }));
      return;
    }
    await createLinkRequest(school.id, from, note);
    await sendReply(phoneNumberId, from, lang, t(lang, "linkCreated"));
    return;
  }

  if (!intent && /^(hi+|hello+|hey|namaste|namaskar|salaam|ram ram)\b/i.test(text)) {
    if (needsConfirm) {
      await sendReply(phoneNumberId, from, lang, t(lang, "confirmPrompt", { school: school.name }));
      return;
    }
    const kidsLine = identity && identity.students.length > 0 ? t(lang, "kidsLine", { names: kidsNames(identity, lang) }) : "";
    await sendReply(phoneNumberId, from, lang, t(lang, "greeting", { school: school.name }) + kidsLine);
    return;
  }

  if (!intent && text) {
    const c = classify(text);
    if (c.confidence >= 0.7) intent = c.intent;
  }

  // free-text fallbacks so "menu" / "language" always work, in any script
  if (!intent && isLangAsk(text)) intent = "lang";
  if (!intent && isMenuAsk(text)) intent = "menu";

  if (intent === "lang") {
    // the picker is the same for everyone — the user hasn't picked a language yet
    await sendList(phoneNumberId, from, t("en", "langPickerIntro"), "Choose", langPickerRows());
    return;
  }

  if (intent === "menu") {
    await sendMenu(phoneNumberId, from, t(lang, "menuBody"), menuRows(lang), t(lang, "menuButton"));
    return;
  }

  // ---------- personal data: code serves it, never the ai ----------
  if (intent && PERSONAL_INTENTS.has(intent)) {
    if (needsConfirm) {
      // registered but not yet confirmed — ask for YES first, reveal nothing (fix H1)
      await sendReply(phoneNumberId, from, lang, t(lang, "confirmPrompt", { school: school.name }));
      await audit(school.id, from, "personal_pull_blocked", "unconfirmed number, intent=" + intent);
      return;
    }
    if (!identity) {
      // unknown number: generic reply only — we don't even confirm any student exists
      await sendReply(phoneNumberId, from, lang, t(lang, "privacyLocked"));
      await audit(school.id, from, "personal_pull_denied", "intent=" + intent);
      return;
    }
    if (pullRateLimited(school.id, from)) {
      await sendReply(phoneNumberId, from, lang, t(lang, "pullRateLimited", { office: officeContact(school, lang) }));
      return;
    }
    if (identity.students.length === 0) {
      await sendReply(phoneNumberId, from, lang, t(lang, "noStudents", { office: officeContact(school, lang) }));
      return;
    }

    if (intent === "attendance") {
      await sendAttendance(phoneNumberId, from, school, identity.students, lang);
    } else if (intent === "fees") {
      await sendFees(phoneNumberId, from, school, identity.students, lang);
    } else {
      // marks / homework / timetable land in phase 5 — identity already proven above
      await sendReply(phoneNumberId, from, lang, t(lang, "comingSoon"));
      await audit(school.id, from, "personal_pull", "intent=" + intent + " students=" + identity.students.map((s) => s.id).join(","));
      return;
    }
    await audit(school.id, from, "personal_pull", "intent=" + intent + " students=" + identity.students.map((s) => s.id).join(","));
    return;
  }

  if (intent) {
    const canned = cannedReply(intent, school, lang);
    if (canned) {
      await sendReply(phoneNumberId, from, lang, canned);
      return;
    }
  }

  const question = text || AI_QUESTION_FOR_INTENT[intent] || "";
  if (!question) {
    await sendMenu(phoneNumberId, from, t(lang, "menuBody"), menuRows(lang), t(lang, "menuButton"));
    return;
  }

  const answer = await answerQuestion(school, question, lang);
  if (answer) {
    await sendReply(phoneNumberId, from, lang, answer);
  } else {
    await sendReply(phoneNumberId, from, lang, t(lang, "aiFallback", { office: officeContact(school, lang) }));
  }
}

// attendance preview from the students table — the full daily module lands in phase 3
// Read-only: renders one line per linked child (name, class, %), never reveals
// data for children that are not linked to this sender (enforced above in handleMessage).
async function sendAttendance(phoneNumberId, to, school, students, lang) {
  const lines = students.map((s) =>
    t(lang, "attendanceLine", { name: s.name, class: s.class_name || t(lang, "classUnknown"), pct: s.attendance_pct })
  );
  await sendReply(phoneNumberId, to, lang, t(lang, "attendanceHeader", { school: school.name }) + "\n\n" + lines.join("\n\n"));
}

// fees preview from the students table — dues/receipts/reminders land in phase 4
// Read-only: amounts render in en-IN format; fully-paid children get the "clear"
// line instead of a zero-amount dues line so parents aren't alarmed by a "₹0 due".
async function sendFees(phoneNumberId, to, school, students, lang) {
  const lines = students.map((s) =>
    s.fees_due > 0
      ? t(lang, "feesDueLine", { name: s.name, class: s.class_name || t(lang, "classUnknown"), amt: Number(s.fees_due).toLocaleString("en-IN") })
      : t(lang, "feesClearLine", { name: s.name, class: s.class_name || t(lang, "classUnknown") })
  );
  await sendReply(phoneNumberId, to, lang, t(lang, "feesHeader", { school: school.name }) + "\n\n" + lines.join("\n\n"));
}
