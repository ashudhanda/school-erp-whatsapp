import { config } from './config.js';
// Best-effort operator alerting over Telegram. Silently no-ops when TELEGRAM_BOT_TOKEN or
// TELEGRAM_CHAT_ID is unset (so alerts.js never breaks flows in environments without it),
// enforces a 5s timeout and caps the message at 3500 chars. All failures return false.
export async function sendAlert(message) {
  if (!config.telegramToken || !config.telegramChatId) return false;
  try {
    const result = await fetch('https://' + 'api.telegram.org/bot' + config.telegramToken + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.telegramChatId, text: String(message).slice(0, 3500) }),
      signal: AbortSignal.timeout(5000)
    });
    return result.ok;
  } catch { return false; }
}
