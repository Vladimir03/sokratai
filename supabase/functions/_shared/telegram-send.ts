/**
 * Отправка сообщения в Telegram (Bot API) — общий helper.
 *
 * Извлечён из tutor-plan-expiry-reminder (2026-07-15, Stage 2 CEO-дайджеста) —
 * третий потребитель (ceo-telegram-digest) сделал копипасту неприемлемой.
 * 1 ретрай на 429/5xx/network. Возвращает boolean, никогда не бросает.
 * Логи PII-free: без chat id и текста.
 */
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";

export async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) return false;
  const maxAttempts = 2;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const resp = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
        },
      );
      if (resp.ok) return true;
      const status = resp.status;
      if (attempt < maxAttempts - 1 && (status === 429 || status >= 500)) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      console.error(`telegram_send_failed status=${status}`);
      return false;
    } catch {
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      console.error("telegram_send_failed network");
      return false;
    }
  }
  return false;
}
