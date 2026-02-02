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
 * Генерирует веб-ссылку для приглашения (страница с инструкцией)
 */
export const getTutorInviteWebLink = (inviteCode: string): string => {
  return `${PRODUCTION_URL}/invite/${inviteCode}`;
};

export const telegramLinks = {
  headerTry: getTelegramLink('header_try'),
  planFree: getTelegramLink('plan_free'),
  planPremium: getTelegramLink('plan_premium'),
  planPro: getTelegramLink('plan_pro'),
  parentTrial: getTelegramLink('parent_trial'),
};
