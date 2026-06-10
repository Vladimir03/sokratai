import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { formatCurrency } from '@/lib/formatters';
import { getMonthIncome } from '@/lib/tutorBalanceApi';

// Доход за месяц над календарём (запрос Егора): «Июнь: 35 000 ₽ из 52 000 ₽» + прогресс-бар.
// «Заработано» = Σ активных lesson-списаний ledger за месяц; «ожидается» = + цены booked.
// Месяц = месяц видимой недели (середина недели, weekStart+3д). Query key намеренно под
// ['tutor','ledger'] — существующие money-инвалидации (invalidateBalanceCaches в TutorSchedule,
// ConfirmLessonsSheet, LedgerFeed) обновляют цифру без новой проводки (rule 60).
export default function MonthIncomeStrip({ weekStart }: { weekStart: Date }) {
  const anchor = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 3); // середина недели (чт) определяет месяц
    return d;
  }, [weekStart]);

  const ym = format(anchor, 'yyyy-MM');
  const monthLabel = useMemo(() => {
    const raw = format(anchor, 'LLLL', { locale: ru }); // «июнь»
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }, [anchor]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['tutor', 'ledger', 'month-income', ym],
    queryFn: () => getMonthIncome(anchor.getFullYear(), anchor.getMonth()),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  // Degraded — тихо (rule 95: упавший блок при живой странице ≠ баннер).
  if (isError) return null;

  if (isLoading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
        <div className="h-5 w-56 animate-pulse rounded bg-slate-100" />
        <div className="mt-2 h-1.5 w-full animate-pulse rounded-full bg-slate-100" />
      </div>
    );
  }

  const earned = data?.earned ?? 0;
  const expected = data?.expected ?? 0;
  if (earned === 0 && expected === 0) return null; // нет занятий в месяце — не показываем пустышку

  const pct = expected > 0 ? Math.min(100, Math.round((earned / expected) * 100)) : 100;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <p className="text-sm font-medium text-slate-700">
          {monthLabel}:{' '}
          <span className="text-lg font-semibold tabular-nums text-slate-900">{formatCurrency(earned)}</span>
          <span className="text-muted-foreground"> из </span>
          <span className="font-medium tabular-nums text-slate-700">{formatCurrency(expected)}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          ожидается, если пройдут все запланированные занятия
        </p>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
