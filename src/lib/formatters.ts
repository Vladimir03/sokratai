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
 * Format a number as Russian rubles currency
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
  }).format(amount);
}
