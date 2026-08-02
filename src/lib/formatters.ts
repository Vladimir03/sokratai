import { formatDistanceToNow, format, isAfter, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';

/**
 * Format a date as relative time in Russian
 */
export function formatRelativeTime(date: string | null): string {
  if (!date) return '—';
  try {
    const parsed = typeof date === 'string' ? parseISO(date) : date;
    return formatDistanceToNow(parsed, { addSuffix: true, locale: ru });
  } catch {
    return '—';
  }
}

/**
 * Calculate progress percentage from current to target score
 */
export function calculateProgress(current: number | null, target: number | null): number {
  if (!target || target === 0) return 0;
  return Math.min(100, Math.max(0, Math.round(((current || 0) / target) * 100)));
}

/**
 * Get payment status based on paid_until date
 */
export function getPaymentStatus(paidUntil: string | null): { isPaid: boolean; label: string } {
  if (!paidUntil) return { isPaid: false, label: 'Не указано' };
  
  try {
    const paidUntilDate = parseISO(paidUntil);
    const isPaid = isAfter(paidUntilDate, new Date());
    return { 
      isPaid, 
      label: isPaid ? `до ${format(paidUntilDate, 'dd.MM')}` : 'Не оплачено' 
    };
  } catch {
    return { isPaid: false, label: 'Не указано' };
  }
}

/**
 * Get initials from a name
 */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map(part => part.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('');
}

/**
 * Format exam type for display
 */
export function formatExamType(examType: string | null): string {
  if (!examType) return '';
  return examType.toUpperCase();
}

/**
 * Балл пробника/ДЗ для показа человеку (2026-08-02, дробные баллы DELF).
 *
 * Целое остаётся целым («7», не «7,0»), дробь пишется по-русски запятой
 * («1,5», «0,5»). Хвост обрезается до 2 знаков — колонки `numeric(6,2)`,
 * больше в базе не бывает, а «1,50» читается как ошибка вёрстки.
 *
 * Отдельная функция, а не `toLocaleString` по месту: балл рисуется на четырёх
 * поверхностях (ученик, репетитор, публичный результат, heatmap), и «0,5» на
 * одной против «0.5» на другой — ровно тот дрейф, которым живут дубли.
 */
export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Разбор балла, введённого руками. Пара к `formatScore`: тот пишет «1,5»,
 * этот обязан «1,5» прочитать.
 *
 * ⚠️ Запятая — не косметика. `parseFloat('1,5')` возвращает **1**, молча теряя
 * половину балла, а форматтер выше сам показывает русскую запятую — то есть
 * репетитор копирует значение из интерфейса и получает другое число.
 * Возвращает NaN на пустой строке и мусоре, чтобы вызывающий сам решал.
 */
export function parseScoreInput(raw: string): number {
  const trimmed = raw.trim().replace(',', '.');
  if (trimmed === '') return NaN;
  return Number.parseFloat(trimmed);
}

/**
 * Format a number as Russian rubles currency
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
  }).format(amount);
}
