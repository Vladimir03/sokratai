/**
 * Копирайт тарифа репетитора — вилка «по числу учеников» с лендинга.
 *
 * ВАЖНО (решение Vladimir, 2026-07-02): в бэкенде тариф бинарный
 * (free/premium, rule 99) — enforced-лимита учеников НЕ существует. Вилка ниже
 * — ЦЕНОВОЙ ОРИЕНТИР из маркетинга (src/components/sections/tutor/Pricing.tsx,
 * EXTRA_TIERS + AI-команда), не блокировка. Никогда не писать «лимит исчерпан»
 * / не дизейблить добавление учеников на её основе.
 *
 * Цены менять синхронно с Pricing.tsx (single copy-source — лендинг).
 */

/** Прямая связь с основателем — поддержка/вопросы (для 21+ учеников — и оплата AI-команды). */
export const TUTOR_SUPPORT_TELEGRAM_URL = 'https://t.me/Analyst_Vladimir';

/**
 * Сообщество репетиторов — ЧАТ, не канал. Единственный источник ссылок,
 * инлайн-хардкод запрещён. Потребители: CommunityJoinCard (/tutor/home),
 * SocialProof + Footer (лендинг), EgorLanding (/egor — QR-страница).
 *
 * ⚠️ НЕ путать с «Каналом Егора» (`https://t.me/sokrat_rep`) — тот живёт инлайн
 * в 5 местах лендинга (Hero, ProductTour3, SocialProof.FOUNDERS, FinalCTA,
 * Footer) и это ДРУГАЯ сущность: канал с анонсами, а не общение репетиторов.
 * До 2026-07-20 здесь стояла ручка канала — кнопка уводила в анонсы (баг).
 *
 *  - Telegram — ПРЯМАЯ invite-ссылка в чат (владелец выдал 2026-07-20; до этого
 *    стоял обходной путь через пост `/sokrat_rep/16` = вход в 2 клика, из-за чего
 *    в UI писали «Сообщество в Telegram»). Теперь вход в 1 клик → в UI честно
 *    «Чат в Telegram».
 *  - VK — прямая инвайт-ссылка в чат.
 */
export const SOKRAT_COMMUNITY_TELEGRAM_URL = 'https://t.me/+PbTN16zp_kRlZjli';
export const SOKRAT_COMMUNITY_VK_URL =
  'https://vk.me/join/WooW6wjwjhNwG7R0rzmKxpEBunNfHq1C3QQ=';

/** Фичи AI-слоя — копия обещания лендинга (Pricing.tsx, тариф «AI-старт»).
 *  Используется в TutorTariffSection (карточка тарифа) и TutorPaymentModal (benefits). */
export const AI_FEATURES = [
  'AI-проверка домашних заданий',
  'Сократовский AI-диалог с учениками',
  'Конструктор ДЗ с привязкой к ФИПИ',
  'Отчёты родителям',
];

export interface StudentBand {
  /** «до 10 учеников» */
  label: string;
  /** «1 000 ₽/мес» */
  price: string;
}

export function getStudentBand(activeCount: number): StudentBand {
  if (activeCount > 20) {
    return { label: '20+ учеников', price: 'AI-команда, от 3 000 ₽/мес' };
  }
  if (activeCount > 10) {
    return { label: 'до 20 учеников', price: '2 000 ₽/мес' };
  }
  return { label: 'до 10 учеников', price: '1 000 ₽/мес' };
}
