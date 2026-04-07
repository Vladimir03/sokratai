import { parseISO, isToday, isPast, isTomorrow, differenceInDays } from 'date-fns';

export type DeadlineUrgency = 'overdue' | 'today' | 'soon' | 'normal' | 'none';

export function getDeadlineUrgency(deadline: string | null): DeadlineUrgency {
  if (!deadline) return 'none';
  try {
    const d = parseISO(deadline);
    if (isNaN(d.getTime())) return 'none';
    if (isPast(d) && !isToday(d)) return 'overdue';
    if (isToday(d)) return 'today';
    if (isTomorrow(d) || differenceInDays(d, new Date()) <= 2) return 'soon';
    return 'normal';
  } catch {
    return 'none';
  }
}

export const URGENCY_CONFIG: Record<DeadlineUrgency, { label?: string; className: string; iconClassName: string }> = {
  overdue: {
    label: 'Просрочено',
    className: 'text-red-600 font-medium',
    iconClassName: 'text-red-500',
  },
  today: {
    label: 'Сегодня',
    className: 'text-amber-600 font-medium',
    iconClassName: 'text-amber-500',
  },
  soon: {
    className: 'text-amber-500',
    iconClassName: 'text-amber-400',
  },
  normal: {
    className: '',
    iconClassName: '',
  },
  none: {
    className: '',
    iconClassName: '',
  },
};

export function formatDeadline(deadline: string | null): string | null {
  if (!deadline) return null;
  try {
    const d = parseISO(deadline);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return null;
  }
}
