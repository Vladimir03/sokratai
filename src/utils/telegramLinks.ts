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
 * **Canonical share-ссылка для tutor invite UI** (Phase 9, 2026-05-25).
 *
 * Используется во ВСЕХ share-сценариях:
 *   - копирование в clipboard для отправки ученику (Telegram, WhatsApp, любой канал)
 *   - QR-код в `AddStudentDialog`
 *   - share-кнопка в `TutorStudents` / `TutorHome` / `TutorHomeworkCreate` /
 *     `AddStudentsToMockExamDialog`
 *
 * URL ведёт на canonical `sokratai.ru/invite/{code}` — React route claim-flow,
 * который всегда корректно рендерится в любом браузере (включая Telegram in-app
 * browser, Safari, Chrome). Telegram link preview-card использует global OG из
 * `index.html` (после landing AI-crawlers refactor 2026-05-19 — sokratai-logo +
 * generic title). Это generic preview без имени репетитора, trade-off в пользу
 * reliability.
 *
 * **Не используй для внутренней навигации тутора** — для этого тоже подходит,
 * но логичнее иметь dedicated tutor-routes (например, redirect на `/tutor/home`).
 *
 * История: до Phase 9 share UI использовал `getTutorInvitePreviewLink` (URL на
 * edge function `invite-preview` с invite-specific OG). Этот URL ломал UX когда
 * репетитор копировал и тестировал в браузере — видел raw HTML с broken encoding.
 * Заменён на canonical claim URL во всех 4 share callsites.
 */
export const getTutorInviteWebLink = (inviteCode: string): string => {
  return `${PRODUCTION_URL}/invite/${inviteCode}`;
};

/**
 * @deprecated Phase 9 (2026-05-25) — НЕ используй в новом коде для share UI.
 *
 * Этот URL ведёт на edge function `invite-preview`, которая отдаёт HTML с
 * invite-specific OpenGraph meta-tags для Telegram bot scrape. Но когда tutor
 * копировал URL и открывал в браузере для теста (или вставлял не в Telegram
 * chat), браузер либо моментально редиректил на `sokratai.ru/invite/{code}`
 * (meta-refresh + JS replace), либо показывал raw HTML с broken encoding
 * (см. .claude/rules/40-homework-system.md — Phase 9 issue 2).
 *
 * Endpoint **не удалён** — backward compat с Telegram preview-картинками,
 * которые могут лежать в Telegram cache недели после старого share.
 * (См. supabase/functions/invite-preview/index.ts).
 *
 * Для нового share UI используй `getTutorInviteWebLink(code)` — canonical
 * `sokratai.ru/invite/{code}` (всегда корректно рендерится в любом браузере).
 *
 * Hardcoded `https://api.sokratai.ru` per AGENTS.md (Network & RU bypass)
 * (RU bypass).
 */
export const getTutorInvitePreviewLink = (inviteCode: string): string => {
  return `https://api.sokratai.ru/functions/v1/invite-preview?c=${encodeURIComponent(inviteCode)}`;
};

/**
 * Онбординг-активация v2 — share-ссылка per-student claim (гейт «Подключить»).
 *
 * Ведёт на **SPA-роут** `sokratai.ru/c/{token}` (НЕ на edge напрямую) — зеркало
 * решения `getTutorInviteWebLink`. Причина: прямой GET на edge
 * `api.sokratai.ru/functions/v1/student-claim` из браузера/скрейпера идёт без
 * auth-заголовка → Supabase-gateway отдаёт 401 `UNAUTHORIZED_NO_AUTH_HEADER`
 * (функция задеплоена verify_jwt=true, rule 96 #11a). SPA-роут же обслуживается
 * nginx (VPS), грузит `StudentClaimPage`, который зовёт `student-claim` POST
 * через `supabase.functions.invoke` (шлёт anon-ключ → проходит gateway).
 * OG в Telegram — generic global (как у tutor-invite, reliability > custom OG).
 * Подходит для копирования в любой чат и для QR.
 */
export const getStudentClaimShareLink = (token: string): string => {
  return `${PRODUCTION_URL}/c/${encodeURIComponent(token)}`;
};

export const telegramLinks = {
  headerTry: getTelegramLink('header_try'),
  planFree: getTelegramLink('plan_free'),
  planPremium: getTelegramLink('plan_premium'),
  planPro: getTelegramLink('plan_pro'),
  parentTrial: getTelegramLink('parent_trial'),
};
