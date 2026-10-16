const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  verifyToken: env.META_VERIFY_TOKEN || "",
  appSecret: env.META_APP_SECRET || "",
  waToken: env.WHATSAPP_TOKEN || "",
  telegramToken: env.TELEGRAM_BOT_TOKEN || "",
  telegramChatId: env.TELEGRAM_CHAT_ID || "",
  // AI fallback (per-school opt-in via schools.js): max paid AI calls per day
  // across the whole deploy — tracked in ai_usage, enforced before any key use.
  aiDailyBudget: Number(env.AI_DAILY_BUDGET || 200),
  // JSON array of API keys rotated round-robin by the AI key pool; "[]" = no keys.
  aiKeysJson: env.AI_KEYS_JSON || "[]",

  // phase 2 — database (turso) + staff panel
  tursoUrl: env.TURSO_DATABASE_URL || "",
  tursoToken: env.TURSO_AUTH_TOKEN || "",
  demoPhoneNumberId: env.DEMO_PHONE_NUMBER_ID || "",
  demoParentNumbers: env.DEMO_PARENT_NUMBERS || "",
  superEmail: env.PANEL_SUPERADMIN_EMAIL || "",
  superPassword: env.PANEL_SUPERADMIN_PASSWORD || "",
  demoAdminEmail: env.DEMO_ADMIN_EMAIL || "",
  demoAdminPassword: env.DEMO_ADMIN_PASSWORD || "",

  // phase 3+ — staff on whatsapp (teachers have no panel; their number is the login)
  demoTeacherNumber: env.DEMO_TEACHER_NUMBER || "", // demo teacher's whatsapp number (flow testing)
  demoAdminWaId: env.DEMO_ADMIN_WAID || "", // demo school admin's whatsapp number (bot-side admin extras)

  // approved utility templates for OUTSIDE the 24h window (blank = free-form only,
  // which works when the parent messaged within 24h — good enough for the demo)
  waTemplateAbsent: env.WA_TEMPLATE_ABSENT || "",
  waTemplatePresent: env.WA_TEMPLATE_PRESENT || "",
  waTemplateLeave: env.WA_TEMPLATE_LEAVE || "",
};

/**
 * Collect startup warnings for required-but-missing environment variables.
 * Pure config read — never throws; the caller decides whether to log or abort.
 * Each warning names the exact env var to set and what breaks without it.
 * @returns {string[]} human-readable warnings; empty when everything required is set.
 */
export function bootWarnings() {
  const warnings = [];
  if (!config.verifyToken) warnings.push("META_VERIFY_TOKEN missing — webhook verification will fail");
  if (!config.appSecret) warnings.push("META_APP_SECRET missing — POST signatures will be rejected");
  if (!config.waToken) warnings.push("WHATSAPP_TOKEN missing — replies will not be sent");
  if (!config.tursoUrl)
    warnings.push("TURSO_DATABASE_URL missing — using local file ./dev.db (data WIPES on render redeploys; dev only)");
  if (!config.superEmail || !config.superPassword)
    warnings.push("PANEL_SUPERADMIN_EMAIL / PANEL_SUPERADMIN_PASSWORD missing — no panel login will be seeded");
  return warnings;
}
