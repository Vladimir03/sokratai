/**
 * Утилиты для отправки событий в Яндекс.Метрику
 * 
 * Используйте эти функции для отслеживания:
 * - Достижения целей (reachGoal)
 * - Поисковых запросов (trackSearch)
 * - Событий авторизации (trackAuth)
 * - Скролла до конца страницы (trackScrollToBottom)
 * - Кликов по внешним ссылкам (trackExternalLink)
 * - Отправки форм (trackFormSubmit)
 */

import { YA_METRIKA_ID, YA_METRIKA_ENABLED } from '@/config/analytics';

/**
 * Отправка достижения цели в Метрику
 * @param target - Идентификатор цели
 * @param params - Дополнительные параметры (опционально)
 */
export const reachGoal = (target: string, params?: Record<string, unknown>) => {
  if (!YA_METRIKA_ENABLED) {
    console.log('[Yandex.Metrika] Goal (dev):', target, params);
    return;
  }

  if (window.ym) {
    window.ym(YA_METRIKA_ID, 'reachGoal', target, params);
    console.log('[Yandex.Metrika] Goal:', target, params);
  }
};

/**
 * Отправка поискового запроса
 * @param query - Текст поискового запроса
 */
export const trackSearch = (query: string) => {
  if (!query.trim()) return;
  
  reachGoal('site_search', { 
    search_query: query,
    timestamp: new Date().toISOString(),
  });
};

/**
 * Отслеживание событий авторизации
 * @param action - Тип действия: login, signup, logout
 * @param method - Метод авторизации (опционально): email, telegram, google
 */
export const trackAuth = (
  action: 'login' | 'signup' | 'logout',
  method?: 'email' | 'telegram' | 'google'
) => {
  reachGoal(`auth_${action}`, { 
    method,
    timestamp: new Date().toISOString(),
  });
};

/**
 * Отслеживание скролла до конца страницы
 * Используйте с IntersectionObserver на Footer
 */
export const trackScrollToBottom = () => {
  reachGoal('scroll_to_bottom', {
    page: window.location.pathname,
    timestamp: new Date().toISOString(),
  });
};

/**
 * Отслеживание клика по внешней ссылке
 * @param url - URL внешней ссылки
 * @param linkText - Текст ссылки (опционально)
 */
export const trackExternalLink = (url: string, linkText?: string) => {
  reachGoal('external_link_click', {
    url,
    link_text: linkText,
    source_page: window.location.pathname,
  });
};

/**
 * Отслеживание отправки формы
 * @param formName - Название формы (например: 'contact', 'feedback', 'subscription')
 * @param success - Успешна ли отправка
 */
export const trackFormSubmit = (formName: string, success: boolean = true) => {
  reachGoal('form_submit', {
    form_name: formName,
    success,
    page: window.location.pathname,
  });
};

/**
 * Отслеживание начала пробного периода
 */
export const trackTrialStart = () => {
  reachGoal('trial_start', {
    timestamp: new Date().toISOString(),
  });
};

/**
 * Отслеживание покупки подписки
 * @param plan - Тип плана подписки
 * @param price - Цена (опционально)
 */
export const trackSubscriptionPurchase = (plan: string, price?: number) => {
  reachGoal('subscription_purchase', {
    plan,
    price,
    timestamp: new Date().toISOString(),
  });
};

/**
 * Отслеживание начала онбординга
 */
export const trackOnboardingStart = () => {
  reachGoal('onboarding_start');
};

/**
 * Отслеживание завершения онбординга
 */
export const trackOnboardingComplete = () => {
  reachGoal('onboarding_complete');
};

/**
 * Отслеживание отправки сообщения в чат
 * @param inputMethod - Способ ввода: text, voice, image
 */
export const trackChatMessage = (inputMethod: 'text' | 'voice' | 'image') => {
  reachGoal('chat_message', {
    input_method: inputMethod,
  });
};
