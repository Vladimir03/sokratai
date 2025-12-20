/**
 * Конфигурация аналитики Яндекс.Метрики
 * 
 * Все настройки счётчика централизованы в этом файле.
 * Для изменения ID счётчика или отключения аналитики — редактируйте только этот файл.
 */

// ID счётчика Яндекс.Метрики
export const YA_METRIKA_ID = 105827612;

// Включена ли аналитика (только на production)
export const YA_METRIKA_ENABLED = import.meta.env.PROD;

// Настройки инициализации счётчика
export const YA_METRIKA_OPTIONS = {
  clickmap: true,           // Карта кликов
  trackLinks: true,         // Отслеживание внешних ссылок
  accurateTrackBounce: true, // Точный показатель отказов
  webvisor: true,           // Вебвизор (запись сессий)
  trackHash: true,          // Отслеживание hash в URL
  ecommerce: false,         // E-commerce (отключено)
} as const;
