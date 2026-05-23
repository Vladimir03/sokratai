const TELEGRAM_BOT_USERNAME = 'sokratai_ru_bot';

// Продакшн URL приложения
const PRODUCTION_URL = 'https://sokratai.ru';

export const getTelegramLink = (utmSource: string): string => {
  return `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${utmSource}`;
};

/**
 * Генерирует ссылку для приглашения ученика от репетитора
 */
export const getTutorInviteTelegramLink = (inviteCode: string): string => {
  return `https://t.me/${TELEGRAM_BOT_USERNAME}?start=tutor_${inviteCode}`;
};

/**
 * Генерирует веб-ссылку для приглашения (страница с инструкцией).
 *
 * Используется только для **внутренней** навигации тутора (например, переход
 * после claim или redirect destination). Для **share-сценариев** (копирование
 * ученику, QR-код) используй `getTutorInvitePreviewLink`, который отдаёт
 * URL с invite-specific OpenGraph для Telegram link preview.
 */
export const getTutorInviteWebLink = (inviteCode: string): string => {
  return `${PRODUCTION_URL}/invite/${inviteCode}`;
};

/**
 * Генерирует share-ссылку для отправки ученику (через Telegram chat / WhatsApp).
 *
 * URL ведёт на edge function `invite-preview`, которая отдаёт HTML с invite-
 * specific OpenGraph meta-tags. Telegram bot scrape видит:
 *   - title «Тебя пригласили в Сократ AI»
 *   - description с именем репетитора + «AI-помощник для домашки»
 *   - НЕТ упоминания цены / «инструмент для репетитора»
 * (См. supabase/functions/invite-preview/index.ts).
 *
 * Браузер ученика после клика мгновенно редиректит на canonical `/invite/{code}`
 * (meta-refresh + window.location.replace fallback) — claim flow без изменений.
 *
 * Hardcoded `https://api.sokratai.ru` per CLAUDE.md §«Network & Infrastructure»
 * (RU bypass — direct `*.supabase.co` блокируется некоторыми RU-провайдерами).
 */
export const getTutorInvitePreviewLink = (inviteCode: string): string => {
  return `https://api.sokratai.ru/functions/v1/invite-preview?c=${encodeURIComponent(inviteCode)}`;
};

export const telegramLinks = {
  headerTry: getTelegramLink('header_try'),
  planFree: getTelegramLink('plan_free'),
  planPremium: getTelegramLink('plan_premium'),
  planPro: getTelegramLink('plan_pro'),
  parentTrial: getTelegramLink('parent_trial'),
};
