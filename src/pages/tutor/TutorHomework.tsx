import { memo, useState, useCallback, useMemo, useEffect, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { parseISO } from 'date-fns';
import {
  getDeadlineUrgency,
  URGENCY_CONFIG,
  formatDeadline,
} from '@/lib/homeworkDeadline';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Plus, BookOpen, Users, BarChart3, Clock, CheckCircle2, WifiOff, Library, Inbox } from 'lucide-react';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
import { useTutorHomeworkAssignments } from '@/hooks/useTutorHomework';
import { useTutor, useTutorGroups } from '@/hooks/useTutor';
import { trackGuidedHomeworkEvent } from '@/lib/homeworkTelemetry';
import { cn } from '@/lib/utils';
import { getSubjectLabel } from '@/types/homework';
import { HOMEWORK_STATUS_CONFIG, formatHomeworkScore } from '@/lib/homeworkStatus';
import type {
  HomeworkAssignmentsFilter,
  TutorHomeworkAssignmentListItem,
} from '@/lib/tutorHomeworkApi';

// ─── Constants ───────────────────────────────────────────────────────────────

const FILTER_TABS: { value: HomeworkAssignmentsFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'active', label: 'Активные' },
  { value: 'closed', label: 'Завершённые' },
];

// Subject labels + status badge palette are intentionally centralised:
//   - subject label → `getSubjectLabel()` in `@/types/homework` (handles
//     both current SUBJECTS ids and legacy `math`/`rus` fallbacks).
//   - status badge  → `HOMEWORK_STATUS_CONFIG` in `@/lib/homeworkStatus`
//     (shared with TutorHomeworkDetail so palette drift can't happen).
//
// No emoji on cards: per `.claude/rules/90-design-system.md` — Sokrat is a
// working surface for exam tutors, not a gamified product, so subject rows
// stay text-only.

// ─── Sort ────────────────────────────────────────────────────────────────────

type HomeworkSortKey = 'created_desc' | 'deadline_asc';

const SORT_OPTIONS: { value: HomeworkSortKey; label: string }[] = [
  { value: 'created_desc', label: 'Новые первыми' },
  { value: 'deadline_asc', label: 'По дедлайну' },
];

function sortAssignments(
  items: TutorHomeworkAssignmentListItem[],
  sortKey: HomeworkSortKey,
): TutorHomeworkAssignmentListItem[] {
  const sorted = [...items];
  switch (sortKey) {
    case 'created_desc':
      sorted.sort((a, b) => {
        const da = a.created_at ? parseISO(a.created_at).getTime() : 0;
        const db = b.created_at ? parseISO(b.created_at).getTime() : 0;
        return (isNaN(db) ? 0 : db) - (isNaN(da) ? 0 : da);
      });
      break;
    case 'deadline_asc':
      sorted.sort((a, b) => {
        const ta = a.deadline ? parseISO(a.deadline).getTime() : NaN;
        const tb = b.deadline ? parseISO(b.deadline).getTime() : NaN;
        const aValid = !isNaN(ta);
        const bValid = !isNaN(tb);
        if (!aValid && !bValid) return 0;
        if (!aValid) return 1;
        if (!bValid) return -1;
        return ta - tb;
      });
      break;
  }
  return sorted;
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function HomeworkListSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <Card key={i} animate={false}>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-16" />
            </div>
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <div className="flex justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({
  filter,
  hasGroupFilter,
}: {
  filter: HomeworkAssignmentsFilter;
  hasGroupFilter: boolean;
}) {
  const isFiltered = filter !== 'all' || hasGroupFilter;
  return (
    <Card className="bg-muted/30 group">
      <CardContent className="flex flex-col items-center text-center gap-5 py-12">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted transition-transform duration-300 ease-out group-hover:-rotate-6">
          <Inbox className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="space-y-1.5">
          <h3 className="font-semibold tracking-tight text-xl">
            {isFiltered ? 'Нет домашних заданий' : 'Пока нет домашних заданий'}
          </h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
            {isFiltered
              ? 'Попробуйте выбрать другой фильтр или создайте новое задание.'
              : 'Создайте первое домашнее задание для ваших учеников.'}
          </p>
        </div>
        <Button asChild className="group/cta">
          <Link to="/tutor/homework/create">
            <Plus
              className="h-4 w-4 mr-2 transition-transform duration-300 ease-out group-hover/cta:rotate-90"
              aria-hidden="true"
            />
            Создать ДЗ
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function toHexWithAlpha(color: string, alphaHex: string): string | null {
  const trimmed = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return `${trimmed}${alphaHex}`;
  }
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const expanded = `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
    return `${expanded}${alphaHex}`;
  }
  return null;
}

function getGroupBadgeStyle(color: string | null): CSSProperties | undefined {
  const trimmed = color?.trim();
  if (!trimmed) return undefined;

  const backgroundColor = toHexWithAlpha(trimmed, '1A');
  return {
    color: trimmed,
    borderColor: trimmed,
    ...(backgroundColor ? { backgroundColor } : {}),
  };
}

// ─── Assignment Card ─────────────────────────────────────────────────────────

// Memoised list-item per `.claude/rules/performance.md` ("List-item компоненты
// обёрнуты в React.memo… новые list-item компоненты тоже оборачивай в memo()").
// `animate={false}` is required by `.claude/rules/10-safe-change-policy.md`
// ("Card in grid: animate={false}") — otherwise every refetch (window-focus,
// filter switch, sort change) replays the slide-in for all 6+ visible cards.
// `transition-shadow` (not `transition-all`) per design system spec.
const AssignmentCard = memo(function AssignmentCard({ item }: { item: TutorHomeworkAssignmentListItem }) {
  const statusCfg = HOMEWORK_STATUS_CONFIG[item.status];
  const deadlineStr = formatDeadline(item.deadline);
  // Use the canonical subject helper so legacy ids (`math`, `rus`) and the
  // current SUBJECTS list both render correctly. The local `HomeworkSubject`
  // type is narrower than the runtime values that actually live in the DB,
  // so cast to `string` for the lookup.
  const subjectLabel = getSubjectLabel(item.subject as unknown as string);
  const showGroupBadge = Boolean(item.source_group_id && item.source_group_name);
  const groupBadgeStyle = getGroupBadgeStyle(item.source_group_color);

  return (
    <Link to={`/tutor/homework/${item.id}`} className="block">
      <Card
        animate={false}
        className="cursor-pointer hover:shadow-md hover:border-slate-300 transition-[box-shadow,border-color] duration-200 ease-out"
      >
        <CardContent className="p-4 space-y-3">
          {/* Header: subject (eyebrow) + status */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {subjectLabel}
              </span>
              {showGroupBadge && (
                <Badge
                  variant="outline"
                  className={cn(
                    'gap-1 border text-[11px] font-medium',
                    groupBadgeStyle
                      ? 'bg-transparent'
                      : 'border-slate-200 bg-slate-50 text-slate-600',
                  )}
                  style={groupBadgeStyle}
                >
                  <Users className="h-3 w-3" aria-hidden="true" />
                  {`Группа ${item.source_group_name}`}
                </Badge>
              )}
            </div>
            <Badge
              variant="outline"
              className={statusCfg.className}
            >
              {statusCfg.label}
            </Badge>
          </div>

          {/* Title */}
          <h3 className="font-semibold text-base tracking-tight leading-snug line-clamp-2">
            {item.title}
          </h3>

          {/* Topic */}
          {item.topic && (
            <p className="text-sm text-muted-foreground line-clamp-1">{item.topic}</p>
          )}

          {/* Stats row. `aria-label` carries the full sentence for screen
              readers (the icon alone is meaningless); `title` is kept for
              desktop hover tooltips. Lucide icons get `aria-hidden` so AT
              users hear the label once, not twice.
              `tabular-nums` keeps counts/scores on a fixed grid so they
              don't visually jitter while scrolling the list. */}
          <div className="flex items-center gap-3 text-sm text-muted-foreground tabular-nums pt-2 flex-wrap">
            {/* Progress: submitted(started)/total — hover tooltip explains three numbers.
                `started_count` is optional for backward compat; show bracket only when
                backend provided a value AND there is progress beyond submissions. */}
            <Tooltip delayDuration={150}>
              <TooltipTrigger asChild>
                <span
                  className="flex items-center gap-1"
                  title={
                    typeof item.started_count === 'number'
                      ? `Сдали ${item.submitted_count}, приступили ${item.started_count}, всего ${item.assigned_count}`
                      : `Сдали ${item.submitted_count} из ${item.assigned_count}`
                  }
                  aria-label={`Сдали ${item.submitted_count}${
                    typeof item.started_count === 'number'
                      ? `, приступили ${item.started_count}`
                      : ''
                  }, всего ${item.assigned_count}`}
                >
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                  {item.submitted_count}
                  {typeof item.started_count === 'number' && item.started_count > item.submitted_count && (
                    <span className="text-muted-foreground/70">({item.started_count})</span>
                  )}
                  /{item.assigned_count}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[240px]">
                <ul className="space-y-0.5 text-xs leading-relaxed">
                  <li><span className="font-semibold">{item.submitted_count}</span> — сдали ДЗ</li>
                  {typeof item.started_count === 'number' && (
                    <li><span className="font-semibold">({item.started_count})</span> — приступили к ДЗ</li>
                  )}
                  <li><span className="font-semibold">{item.assigned_count}</span> — всего учеников</li>
                </ul>
              </TooltipContent>
            </Tooltip>

            {/* Delivered */}
            {(item.delivered_count ?? 0) > 0 && (
              <span
                className="flex items-center gap-1 text-green-600"
                title="Доставлено"
                aria-label={`Доставлено ${item.delivered_count}`}
              >
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                {item.delivered_count}
              </span>
            )}

            {/* Not connected */}
            {(item.not_connected_count ?? 0) > 0 && (
              <span
                className="flex items-center gap-1 text-amber-500"
                title="Нет каналов доставки"
                aria-label={`Нет каналов доставки: ${item.not_connected_count}`}
              >
                <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
                {item.not_connected_count}
              </span>
            )}

            {/* Average score */}
            <span
              className="flex items-center gap-1"
              title="Средний балл"
              aria-label={`Средний балл: ${formatHomeworkScore(item.avg_score, item.max_score_total)}`}
            >
              <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
              {formatHomeworkScore(item.avg_score, item.max_score_total)}
            </span>

            {/* Deadline */}
            {deadlineStr && (() => {
              const urgency = getDeadlineUrgency(item.deadline);
              const cfg = URGENCY_CONFIG[urgency];
              const fullText = cfg.label ? `${cfg.label} · ${deadlineStr}` : deadlineStr;
              return (
                <span
                  className={cn('flex items-center gap-1 ml-auto', cfg.className)}
                  title="Дедлайн"
                  aria-label={`Дедлайн: ${fullText}`}
                >
                  <Clock className={cn('h-3.5 w-3.5', cfg.iconClassName)} aria-hidden="true" />
                  {fullText}
                </span>
              );
            })()}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
});

// ─── Main Content ────────────────────────────────────────────────────────────

function TutorHomeworkContent() {
  const [filter, setFilter] = useState<HomeworkAssignmentsFilter>('all');
  const [sortKey, setSortKey] = useState<HomeworkSortKey>('created_desc');
  const [groupId, setGroupId] = useState<string | null>(null);
  const { tutor } = useTutor();
  const miniGroupsEnabled = Boolean(tutor?.mini_groups_enabled);
  const { groups, loading: groupsLoading } = useTutorGroups(miniGroupsEnabled);

  const {
    assignments,
    loading,
    error,
    refetch,
    isFetching,
    isRecovering,
    failureCount,
  } = useTutorHomeworkAssignments({
    filter,
    groupId,
    sortKey,
  });

  const showGroupFilter = miniGroupsEnabled && groups.length > 0;

  useEffect(() => {
    if (groupsLoading || !groupId) return;
    if (groups.some((group) => group.id === groupId)) return;
    setGroupId(null);
  }, [groups, groupsLoading, groupId]);

  const sortedAssignments = useMemo(
    () => sortAssignments(assignments, sortKey),
    [assignments, sortKey],
  );

  const hasData = assignments.length > 0;
  const showSkeleton = loading && !hasData && !error;

  const handleRetry = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleGroupFilterChange = useCallback((nextValue: string) => {
    const nextGroupId = nextValue === 'all' ? null : nextValue;
    setGroupId(nextGroupId);
    trackGuidedHomeworkEvent('homework_filter_by_group', {
      group_id: nextGroupId,
    });
  }, []);

  return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <BookOpen className="h-6 w-6" />
              Домашние задания
            </h1>
            <p className="text-muted-foreground text-sm mt-1.5">
              Управляйте домашками и отслеживайте прогресс учеников
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild className="group">
              <Link to="/tutor/homework/templates">
                <Library
                  className="h-4 w-4 mr-2 transition-transform duration-200 ease-out group-hover:-translate-x-0.5"
                  aria-hidden="true"
                />
                Шаблоны
              </Link>
            </Button>
            <Button asChild className="group">
              <Link to="/tutor/homework/create">
                <Plus
                  className="h-4 w-4 mr-2 transition-transform duration-300 ease-out group-hover:rotate-90"
                  aria-hidden="true"
                />
                Создать ДЗ
              </Link>
            </Button>
          </div>
        </div>

        {/* Error / Recovery status */}
        <TutorDataStatus
          error={error}
          isFetching={isFetching}
          isRecovering={isRecovering}
          failureCount={failureCount}
          onRetry={handleRetry}
        />

        {/* Filter group + Sort.
            The filter is a toggle button group (not a tablist) — it
            re-filters the same list rather than revealing hidden panels, so
            ARIA Authoring Practices says use `role="group"` + `aria-pressed`,
            not `role="tablist"`. `min-h-[44px]` for iOS HIG touch target.
            Sort select stays at 16px on every viewport per
            `.claude/rules/80-cross-browser.md` (iOS auto-zoom prevention). */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div
            role="group"
            aria-label="Фильтр домашних заданий по статусу"
            className="flex gap-1 border-b overflow-x-auto"
          >
            {FILTER_TABS.map((tab) => {
              const isActive = filter === tab.value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setFilter(tab.value)}
                  aria-pressed={isActive}
                  className={cn(
                    'min-h-[44px] px-4 text-sm font-medium border-b-2 transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:rounded-sm',
                    isActive
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30',
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {showGroupFilter && (
              <select
                value={groupId ?? 'all'}
                onChange={(e) => handleGroupFilterChange(e.target.value)}
                aria-label="Фильтр домашних заданий по группе"
                className="min-h-[44px] w-full rounded-lg border border-input bg-background px-3 py-1.5 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:w-auto"
              >
                <option value="all">Все группы</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.short_name?.trim() || group.name}
                  </option>
                ))}
              </select>
            )}
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as HomeworkSortKey)}
              aria-label="Сортировка домашних заданий"
              className="min-h-[44px] w-full rounded-lg border border-input bg-background px-3 py-1.5 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:w-auto"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Content */}
        {showSkeleton ? (
          <HomeworkListSkeleton />
        ) : !hasData && !error ? (
          <EmptyState filter={filter} hasGroupFilter={groupId !== null} />
        ) : hasData ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedAssignments.map((item) => (
              <AssignmentCard key={item.id} item={item} />
            ))}
          </div>
        ) : null}
      </div>
  );
}

// ─── Export ──────────────────────────────────────────────────────────────────

export default function TutorHomework() {
  return <TutorHomeworkContent />;
}
