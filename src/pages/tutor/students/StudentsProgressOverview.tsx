import { memo, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, GraduationCap, Inbox, Loader2, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getStudentsProgressOverview,
  type ProgressOverviewItem,
} from '@/lib/tutorProgressApi';

// ─── Успеваемость — кросс-ученический обзор (student-progress R2, TASK-7) ──────
//
// Scale-agnostic: только сравнимые между учениками колонки (% к цели / % проверено
// / два сигнала). Сырого балла НЕТ (нельзя сравнить 100-шкалу и оценку 2–5).
// Два РАЗНЫХ сигнала (не сливать в одно «внимание», дизайн usp/data.js::compute):
//   · risk    — ученик отстаёт (далеко от цели / падающая динамика) → red
//   · backlog — требует МОЕЙ проверки (на проверке / просрочка) → amber
// 100+ учеников: React.memo строки + lightweight payload + group-by.

const BEHIND = 50; // % к цели ниже = отстаёт (mirror backend BEHIND_GOAL_PCT)

type SortMode = 'attention' | 'groups' | 'goal' | 'name';
type FilterMode = null | 'risk' | 'backlog';

interface ComputedItem extends ProgressOverviewItem {
  risk: boolean;
  backlog: boolean;
  riskReason: string | null;
  backlogReason: string | null;
  attnScore: number;
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return few;
  return many;
}

const TRACK_LABEL: Record<string, string> = { ege: 'ЕГЭ', oge: 'ОГЭ', school: 'Школа' };

function compute(item: ProgressOverviewItem): ComputedItem {
  const pct = item.pct_to_goal;
  const examTrack = item.track === 'ege' || item.track === 'oge';
  const behind = pct != null && pct < BEHIND;
  const declining = item.signals.declining;
  const risk = behind || (pct != null && pct < 62 && declining && examTrack);
  const backlog = item.signals.review_backlog > 0 || item.signals.overdue;

  let riskReason: string | null = null;
  if (risk) {
    const bits = [behind ? 'отстаёт от цели' : 'близко к срыву цели'];
    if (declining) bits.push('динамика ↓');
    riskReason = bits.join(' · ');
  }

  let backlogReason: string | null = null;
  const n = item.signals.review_backlog;
  if (n > 0 && item.signals.overdue) backlogReason = `${n} на проверке · просрочка`;
  else if (n > 0) backlogReason = `${n} ${pluralRu(n, 'работа', 'работы', 'работ')} на проверке`;
  else if (item.signals.overdue) backlogReason = 'есть просрочка';

  // risk dominates backlog (Elena's retention lens)
  const attnScore = (risk ? 10000 + (100 - (pct ?? 0)) * 10 + (declining ? 300 : 0) : 0) +
    (backlog ? n * 10 + (item.signals.overdue ? 25 : 0) : 0);

  return { ...item, risk, backlog, riskReason, backlogReason, attnScore };
}

const UNASSIGNED = '__unassigned__';

const OverviewRow = memo(function OverviewRow({
  item,
  onOpen,
}: {
  item: ComputedItem;
  onOpen: (id: string) => void;
}) {
  const dotColor = item.risk ? 'bg-red-500' : item.backlog ? 'bg-amber-500' : 'bg-transparent';
  const pct = item.pct_to_goal;
  // % к цели tint: низкий → red, средний → amber, высокий → accent.
  const goalTint = pct == null ? 'bg-slate-300'
    : pct < 50 ? 'bg-red-500'
    : pct < 80 ? 'bg-amber-500'
    : 'bg-accent';

  return (
    <button
      type="button"
      onClick={() => onOpen(item.tutor_student_id)}
      className="w-full flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left transition-shadow hover:shadow-md touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
    >
      <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', dotColor)} aria-hidden="true" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-slate-900 truncate">{item.name}</span>
          {/* нейтральный трек-чип (НЕ зелёный — rule 90) */}
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
            <GraduationCap className="h-3 w-3" aria-hidden="true" />
            {TRACK_LABEL[item.track] ?? item.track}
          </span>
          {item.grade_class ? (
            <span className="text-[11px] text-slate-400">{item.grade_class}</span>
          ) : null}
        </div>

        {/* два сигнал-чипа раздельно (могут стоять оба) */}
        {(item.risk || item.backlog) ? (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {item.risk ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-red-200">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                {item.riskReason}
              </span>
            ) : null}
            {item.backlog ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200">
                {item.backlogReason}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* % к цели — акцентный бар + стрелка тренда */}
      <div className="hidden sm:flex flex-col items-end gap-1 w-28 shrink-0">
        <div className="flex items-center gap-1 text-xs font-semibold tabular-nums text-slate-700">
          {pct != null ? `${pct}%` : '—'}
          {item.signals.declining ? (
            <ArrowDownRight className="h-3.5 w-3.5 text-red-500" aria-label="динамика вниз" />
          ) : pct != null ? (
            <ArrowUpRight className="h-3.5 w-3.5 text-emerald-500" aria-label="динамика вверх" />
          ) : (
            <Minus className="h-3.5 w-3.5 text-slate-300" aria-hidden="true" />
          )}
        </div>
        <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
          <div className={cn('h-full rounded-full', goalTint)} style={{ width: `${pct ?? 0}%` }} />
        </div>
        <span className="text-[10px] text-slate-400">к цели</span>
      </div>

      {/* % проверено — тихая серая мини-полоса */}
      <div className="hidden md:flex flex-col items-end gap-1 w-20 shrink-0">
        <span className="text-xs font-medium tabular-nums text-slate-500">
          {item.reviewed_pct != null ? `${item.reviewed_pct}%` : '—'}
        </span>
        <div className="h-1 w-full rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full rounded-full bg-slate-400" style={{ width: `${item.reviewed_pct ?? 0}%` }} />
        </div>
        <span className="text-[10px] text-slate-400">проверено</span>
      </div>
    </button>
  );
});

export function StudentsProgressOverview() {
  const navigate = useNavigate();
  const [sort, setSort] = useState<SortMode>('attention');
  const [filter, setFilter] = useState<FilterMode>(null);

  const query = useQuery({
    queryKey: ['tutor', 'students', 'overview'],
    queryFn: getStudentsProgressOverview,
    refetchOnWindowFocus: false,
    staleTime: 10 * 60 * 1000,
  });

  const computed = useMemo(
    () => (query.data?.items ?? []).map(compute),
    [query.data],
  );

  const hasGroups = useMemo(() => computed.some((s) => s.group_id !== null), [computed]);

  const filtered = useMemo(() => {
    if (filter === 'risk') return computed.filter((s) => s.risk);
    if (filter === 'backlog') return computed.filter((s) => s.backlog);
    return computed;
  }, [computed, filter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sort === 'name') arr.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    else if (sort === 'goal') arr.sort((a, b) => (a.pct_to_goal ?? 999) - (b.pct_to_goal ?? 999));
    else arr.sort((a, b) => b.attnScore - a.attnScore); // attention (and groups uses this within-group)
    return arr;
  }, [filtered, sort]);

  // group-by (reuse StudentsActivityBlock pattern): interleaved group header rows.
  const grouped = useMemo(() => {
    if (sort !== 'groups') return null;
    const byGroup = new Map<string, { label: string; items: ComputedItem[] }>();
    for (const s of sorted) {
      const key = s.group_id ?? UNASSIGNED;
      const label = s.group_name ?? (s.group_id ? 'Группа' : 'Без группы');
      if (!byGroup.has(key)) byGroup.set(key, { label, items: [] });
      byGroup.get(key)!.items.push(s);
    }
    const entries = [...byGroup.entries()];
    entries.sort((a, b) => {
      if (a[0] === UNASSIGNED) return 1;
      if (b[0] === UNASSIGNED) return -1;
      return a[1].label.localeCompare(b[1].label, 'ru');
    });
    for (const [, g] of entries) g.items.sort((a, b) => b.attnScore - a.attnScore);
    return entries;
  }, [sorted, sort]);

  const handleOpen = (tutorStudentId: string) => {
    // → карточка ученика (вкладка «Прогресс» открывается по умолчанию).
    navigate(`/tutor/students/${tutorStudentId}`);
  };

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
        Не удалось загрузить успеваемость. Обновите страницу.
      </div>
    );
  }

  if (computed.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-10 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
          <Inbox className="h-6 w-6 text-slate-400" />
        </div>
        <p className="text-sm font-medium text-slate-700">Пока нет данных по успеваемости</p>
        <p className="mt-1 text-xs text-slate-500">Назначьте ДЗ или пробник — здесь появится прогресс учеников.</p>
      </div>
    );
  }

  const riskCount = computed.filter((s) => s.risk).length;
  const backlogCount = computed.filter((s) => s.backlog).length;

  const sortOptions: { key: SortMode; label: string; disabled?: boolean }[] = [
    { key: 'attention', label: 'Внимание' },
    { key: 'groups', label: 'Группы', disabled: !hasGroups },
    { key: 'goal', label: '% к цели' },
    { key: 'name', label: 'А→Я' },
  ];

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Фильтр учеников" className="flex items-center gap-1">
          {([
            { key: null, label: 'Все' },
            { key: 'risk', label: `Отстают${riskCount ? ` · ${riskCount}` : ''}` },
            { key: 'backlog', label: `Ждут проверки${backlogCount ? ` · ${backlogCount}` : ''}` },
          ] as { key: FilterMode; label: string }[]).map((f) => (
            <button
              key={String(f.key)}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'min-h-[36px] rounded-md px-3 text-sm font-medium transition-colors touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30',
                filter === f.key ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1" role="group" aria-label="Сортировка">
          {sortOptions.map((o) => (
            <button
              key={o.key}
              type="button"
              disabled={o.disabled}
              aria-pressed={sort === o.key}
              onClick={() => setSort(o.key)}
              className={cn(
                'min-h-[36px] rounded-md px-2.5 text-xs font-medium transition-colors touch-manipulation disabled:opacity-40',
                sort === o.key ? 'bg-accent/10 text-accent' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {grouped ? (
        <div className="space-y-4">
          {grouped.map(([key, g]) => {
            const groupRisk = g.items.filter((s) => s.risk).length;
            return (
              <div key={key} className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <h3 className="text-sm font-semibold text-slate-700">{g.label}</h3>
                  <span className="text-xs text-slate-400">{g.items.length}</span>
                  {groupRisk > 0 ? (
                    <span className="text-xs font-medium text-red-600">· {groupRisk} отстают</span>
                  ) : null}
                </div>
                <div className="space-y-2">
                  {g.items.map((item) => (
                    <OverviewRow key={item.tutor_student_id} item={item} onOpen={handleOpen} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((item) => (
            <OverviewRow key={item.tutor_student_id} item={item} onOpen={handleOpen} />
          ))}
          {sorted.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">Нет учеников по этому фильтру.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default StudentsProgressOverview;
