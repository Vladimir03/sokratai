const TELEGRAM_BOT_USERNAME = 'sokratai_ru_bot';

export const getTelegramLink = (utmSource: string): string => {
  return `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${utmSource}`;
};

export const telegramLinks = {
  headerTry: getTelegramLink('header_try'),
  planFree: getTelegramLink('plan_free'),
  planPremium: getTelegramLink('plan_premium'),
  planPro: getTelegramLink('plan_pro'),
  parentTrial: getTelegramLink('parent_trial'),
};
