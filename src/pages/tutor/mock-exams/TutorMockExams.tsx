// Mock Exams v1 — TASK-8: tutor list page.
//
// Job: R1 (быстро назначить и проверить пробник ЕГЭ по физике).
// AC-1: tutor видит список своих mock-exams со статистикой.
// Spec: docs/delivery/features/mock-exams-v1/spec.md
// Mockup: SokratAI/docs/delivery/features/mock-exams-v1/mockup.html (Screen 1)
//
// Анти-патерны исключены (см. .claude/rules/90-design-system.md):
//   • Lucide icons вместо emoji в chrome
//   • shadcn Card / Button / Badge
//   • `transition-shadow` (не `transition-all`) — performance.md
//   • `React.memo` на list-item Card-компонентах — performance.md
//   • `animate={false}` на Card в grid — 10-safe-change-policy.md
//   • Mobile-responsive (375px+): KPI grid складывается из 5 → 3 → 2 столбцов

import { memo, useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { parseISO } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';
import {
  ClipboardCheck,
  Plus,
  Clock,
  Info,
  ChevronRight,
  GraduationCap,
  FileText,
  Sparkles,
  MoreVertical,
  Trash2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
import { MockExamFeatureGate } from './MockExamFeatureGate';
import { useMockExamAssignments } from '@/hooks/useMockExamAssignments';
import { DeleteMockExamDialog } from '@/components/tutor/mock-exams/DeleteMockExamDialog';
import { getMockExamAssignment } from '@/lib/mockExamApi';
import { MOCK_EXAM_ASSIGNMENT_QUERY_KEY } from '@/hooks/useMockExamAssignment';
import type { MockExamAttemptListItem } from '@/types/mockExam';
import { cn } from '@/lib/utils';
import {
  formatDeadline,
  getDeadlineUrgency,
  URGENCY_CONFIG,
} from '@/lib/homeworkDeadline';
import type {
  MockExamAssignmentListItem,
  MockExamAssignmentStatus,
  MockExamAttemptStatus,
  MockExamMode,
} from '@/types/mockExam';

// ─── Status / mode config ────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  MockExamAssignmentStatus,
  { label: string; className: string }
> = {
  draft: {
    label: 'Черновик',
    className:
      'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
  active: {
    label: 'Активное',
    className:
      'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  },
  closed: {
    label: 'Завершено',
    className:
      'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400',
  },
};

const MODE_LABEL: Record<MockExamMode, string> = {
  blank: 'С бланком',
  form: 'Форма',
  manual_entry: 'Внесён вручную',
};

// ─── Тренировочный 1 — captured из seed (Phase 1: 1 variant). ────────────────
// Spec: supabase/seed/mock_exams_variant_1.sql §1. variant_id фиксирован
// в uuid5 и виден здесь для marketing-ready library card. Когда landed
// больше variants — заменить на API fetch.
const VARIANT_LIBRARY = [
  {
    id: '36cebc45-e2e8-5603-a753-01c818bba131',
    title: 'Тренировочный 1 (физика ЕГЭ-2026)',
    attribution: 'Источник: репетитор Егор Блинов',
    meta: '26 заданий · макс. 45 баллов · 3 ч 55 мин',
    isAvailable: true,
    badge: { label: 'Рекомендуем', className: 'bg-accent/10 text-accent' },
  },
  {
    id: 'fipi-demo-2026-placeholder',
    title: 'Демоверсия ФИПИ-2026',
    attribution: 'Источник: ФИПИ',
    meta: 'Добавим после Phase 2',
    isAvailable: false,
    badge: { label: 'скоро', className: 'bg-slate-100 text-slate-500' },
  },
];

// ─── Skeleton ────────────────────────────────────────────────────────────────

function MockExamListSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2].map((i) => (
        <Card key={i} animate={false}>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
              <Skeleton className="h-6 w-20" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 pt-3 border-t border-slate-100">
              {[1, 2, 3, 4].map((j) => (
                <div key={j} className="space-y-1.5">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-6 w-12" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <Card className="bg-muted/30 group">
      <CardContent className="flex flex-col items-center text-center gap-5 py-12">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted transition-transform duration-300 ease-out group-hover:-rotate-6">
          <ClipboardCheck
            className="h-8 w-8 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
        <div className="space-y-1.5">
          <h3 className="font-semibold tracking-tight text-xl">
            Пока нет назначенных пробников
          </h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
            Назначь первый пробник из готовой библиотеки — Часть 1 проверится
            автоматически, по Части 2 AI сделает черновик.
          </p>
        </div>
        <Button asChild className="group/cta">
          <Link to="/tutor/mock-exams/new">
            <Plus
              className="h-4 w-4 mr-2 transition-transform duration-300 ease-out group-hover/cta:rotate-90"
              aria-hidden="true"
            />
            Назначь первый пробник
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── KPI cell ────────────────────────────────────────────────────────────────

interface KpiCellProps {
  label: string;
  value: string;
  hint?: string | null;
  tone?: 'default' | 'amber' | 'emerald' | 'accent';
}

const KpiCell = memo(function KpiCell({
  label,
  value,
  hint,
  tone = 'default',
}: KpiCellProps) {
  const valueClass = cn(
    'text-lg font-semibold tabular-nums leading-tight',
    tone === 'amber' && 'text-amber-700 dark:text-amber-300',
    tone === 'emerald' && 'text-emerald-700 dark:text-emerald-300',
    tone === 'accent' && 'text-accent',
    tone === 'default' && 'text-slate-900 dark:text-slate-100',
  );
  return (
    <div className="space-y-0.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={valueClass}>
        {value}
        {hint ? (
          <span className="ml-1 text-sm font-normal text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </div>
    </div>
  );
});

// ─── Assignment card ─────────────────────────────────────────────────────────

interface AssignmentCardProps {
  item: MockExamAssignmentListItem;
}

const AssignmentCard = memo(function AssignmentCard({
  item,
}: AssignmentCardProps) {
  const statusCfg = STATUS_CONFIG[item.status];
  const modeLabel = MODE_LABEL[item.mode];
  const deadlineStr = formatDeadline(item.deadline);
  const queryClient = useQueryClient();

  // TASK-17: local delete dialog state per card. Synthesize minimal attempts
  // shape from counters для context-aware severity без extra fetch.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [prefetching, setPrefetching] = useState(false);
  const syntheticAttempts = useMemo(() => {
    const arr: { status: MockExamAttemptStatus; started_at: string | null }[] = [];
    const approvedCnt = item.attempts_approved ?? 0;
    const submittedCnt = (item.attempts_submitted ?? 0)
      + (item.attempts_awaiting_review ?? 0);
    const inProgressCnt = item.attempts_in_progress ?? 0;
    for (let i = 0; i < approvedCnt; i++) {
      arr.push({ status: 'approved', started_at: null });
    }
    for (let i = 0; i < submittedCnt; i++) {
      arr.push({ status: 'submitted', started_at: null });
    }
    for (let i = 0; i < inProgressCnt; i++) {
      arr.push({ status: 'in_progress', started_at: new Date().toISOString() });
    }
    return arr;
  }, [item]);

  // Prefetch full detail in background при hover/focus dropdown trigger —
  // если tutor нажмёт «Открыть» сразу после, страница уже warm в кеше.
  const handleDropdownTriggerHover = () => {
    if (prefetching) return;
    setPrefetching(true);
    void queryClient.prefetchQuery({
      queryKey: MOCK_EXAM_ASSIGNMENT_QUERY_KEY(item.id),
      queryFn: () => getMockExamAssignment(item.id),
      staleTime: 30_000,
    });
  };

  // TASK-11: backend теперь выдаёт all counters explicitly. Frontend читает
  // напрямую с `?? 0` fallback. Old subtraction формула рождала NaN при
  // отсутствии поля в response. Legacy field `attempts_approved` остался
  // (= approved+manually_entered = «подтверждённые tutor'ом»), но для
  // отображения «Сдали» теперь используем `attempts_completed_total`
  // (= submitted+ai_checking+awaiting_review+approved+manually_entered =
  // «все кто нажал submit»).
  const total = item.attempts_total ?? 0;
  const inProgress = item.attempts_in_progress
    ?? Math.max(
      total
        - (item.attempts_submitted ?? 0)
        - (item.attempts_awaiting_review ?? 0)
        - (item.attempts_approved ?? 0)
        - (item.attempts_not_started ?? 0),
      0,
    );
  const completedTotal = item.attempts_completed_total
    ?? ((item.attempts_submitted ?? 0)
      + (item.attempts_awaiting_review ?? 0)
      + (item.attempts_approved ?? 0));
  const pendingReview = item.attempts_pending_review
    ?? ((item.attempts_submitted ?? 0) + (item.attempts_awaiting_review ?? 0));

  // Variant attribution — for blank/form: variant title. Для manual_entry:
  // variant_title идёт через display_title, source label не нужен.
  const variantSubline =
    item.mode === 'manual_entry'
      ? 'Внесён вручную'
      : item.display_title;

  return (
    <Link
      to={`/tutor/mock-exams/${item.id}`}
      className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg"
    >
      <Card
        animate={false}
        className="cursor-pointer hover:shadow-md hover:border-slate-300 transition-[box-shadow,border-color] duration-200 ease-out"
      >
        <CardContent className="p-5 space-y-4">
          {/* Header: title + status. ChevronRight on right hints clickability. */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-lg leading-snug tracking-tight text-slate-900 dark:text-slate-100 line-clamp-2">
                  {item.title}
                </h3>
                <Badge variant="outline" className={statusCfg.className}>
                  {statusCfg.label}
                </Badge>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap text-sm text-muted-foreground">
                <span className="line-clamp-1">{variantSubline}</span>
                {deadlineStr && item.mode !== 'manual_entry' && (() => {
                  const urgency = getDeadlineUrgency(item.deadline);
                  const urgencyCfg = URGENCY_CONFIG[urgency];
                  return (
                    <>
                      <span aria-hidden="true">·</span>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1',
                          urgencyCfg.className,
                        )}
                        title="Дедлайн"
                      >
                        <Clock
                          className={cn('h-3.5 w-3.5', urgencyCfg.iconClassName)}
                          aria-hidden="true"
                        />
                        {urgencyCfg.label
                          ? `${urgencyCfg.label} · ${deadlineStr}`
                          : deadlineStr}
                      </span>
                    </>
                  );
                })()}
                <span aria-hidden="true">·</span>
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {modeLabel}
                </span>
              </div>
            </div>
            {/* TASK-17: dropdown menu (replaces chevron). stopPropagation
                чтобы клик по «⋮» не triggered Link navigation. */}
            <div className="flex-shrink-0 mt-1 flex items-center">
              <DropdownMenu>
                <DropdownMenuTrigger
                  asChild
                  onClick={(e) => e.preventDefault()}
                  onMouseEnter={handleDropdownTriggerHover}
                  onFocus={handleDropdownTriggerHover}
                >
                  <button
                    type="button"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    aria-label="Действия с пробником"
                    className="inline-flex items-center justify-center min-w-9 min-h-9 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 touch-manipulation"
                  >
                    <MoreVertical className="h-5 w-5" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-48"
                  onClick={(e) => e.stopPropagation()}
                >
                  <DropdownMenuItem asChild className="cursor-pointer">
                    <Link to={`/tutor/mock-exams/${item.id}`}>
                      <ChevronRight className="h-4 w-4 mr-2" aria-hidden="true" />
                      Открыть
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDeleteOpen(true);
                    }}
                    className="text-rose-600 focus:text-rose-700 focus:bg-rose-50 dark:focus:bg-rose-950/40 cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />
                    Удалить пробник
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* KPI row: Учеников · Сдали · В процессе · Требует проверки.
              Mobile: 2 cols, sm: 3 cols, md+: 4 cols. tabular-nums keeps
              numbers on a fixed grid (no jitter on refetch). */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <KpiCell
              label="Учеников"
              value={String(total)}
            />
            <KpiCell
              label="Сдали"
              value={String(completedTotal)}
              hint={`/ ${total}`}
              tone={completedTotal > 0 ? 'accent' : 'default'}
            />
            <KpiCell
              label="В процессе"
              value={String(inProgress)}
              tone={inProgress > 0 ? 'amber' : 'default'}
            />
            <KpiCell
              label="Требует проверки"
              value={String(pendingReview)}
              tone={pendingReview > 0 ? 'amber' : 'default'}
            />
          </div>
        </CardContent>
      </Card>
      {/* TASK-17: delete dialog mounted рядом с Link, чтобы клик по «Удалить»
          в dropdown не triggered Link navigation. Dialog имеет stopPropagation
          через AlertDialog Portal — портал mounted в document.body, не в Link. */}
      <DeleteMockExamDialog
        assignmentId={item.id}
        assignmentTitle={item.title}
        attempts={syntheticAttempts}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </Link>
  );
});

// ─── Variant library card ────────────────────────────────────────────────────

interface VariantLibraryCardProps {
  title: string;
  attribution: string;
  meta: string;
  isAvailable: boolean;
  badge: { label: string; className: string };
}

const VariantLibraryCard = memo(function VariantLibraryCard({
  title,
  attribution,
  meta,
  isAvailable,
  badge,
}: VariantLibraryCardProps) {
  const innerCard = (
    <Card
      animate={false}
      className={cn(
        'h-full',
        isAvailable
          ? 'cursor-pointer border-2 border-accent/40 hover:border-accent hover:shadow-md transition-[box-shadow,border-color] duration-200 ease-out'
          : 'opacity-60 cursor-not-allowed',
      )}
    >
      <CardContent className="p-4 flex items-start gap-3">
        <div
          className={cn(
            'h-10 w-10 rounded-md flex items-center justify-center flex-shrink-0',
            isAvailable
              ? 'bg-accent/10 text-accent'
              : 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500',
          )}
          aria-hidden="true"
        >
          {isAvailable ? (
            <GraduationCap className="h-5 w-5" />
          ) : (
            <FileText className="h-5 w-5" />
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <h4
              className={cn(
                'font-semibold text-sm leading-snug',
                isAvailable
                  ? 'text-slate-900 dark:text-slate-100'
                  : 'text-slate-500 dark:text-slate-400',
              )}
            >
              {title}
            </h4>
            <Badge
              variant="outline"
              className={cn(
                'flex-shrink-0 text-[10px] uppercase tracking-wide font-medium border-transparent',
                badge.className,
              )}
            >
              {badge.label}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">{attribution}</p>
          <p className="text-xs text-muted-foreground/80">{meta}</p>
        </div>
      </CardContent>
    </Card>
  );

  if (!isAvailable) {
    return innerCard;
  }

  return (
    <Link
      to="/tutor/mock-exams/new"
      className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg"
    >
      {innerCard}
    </Link>
  );
});

// ─── Beta banner ─────────────────────────────────────────────────────────────

function BetaBanner() {
  return (
    <div
      role="note"
      className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30"
    >
      <Info
        className="h-5 w-5 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400"
        aria-hidden="true"
      />
      <div className="space-y-1">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
          Бета
        </p>
        <p className="text-sm text-amber-800 dark:text-amber-300/90 leading-relaxed">
          Часть 1 — автопроверка по критериям ФИПИ. Часть 2 — AI-черновик,
          финальная оценка за тобой. Свои варианты можно создавать по любому предмету.
        </p>
      </div>
    </div>
  );
}

// ─── Main content ────────────────────────────────────────────────────────────

function TutorMockExamsContent() {
  const {
    assignments,
    loading,
    error,
    refetch,
    isFetching,
  } = useMockExamAssignments();

  const sorted = useMemo(() => sortByCreatedDesc(assignments), [assignments]);

  const hasData = assignments.length > 0;
  const showSkeleton = loading && !hasData && !error;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6" aria-hidden="true" />
            Пробники
          </h1>
          <p className="text-muted-foreground text-sm mt-1.5">
            Пробные варианты ЕГЭ с автопроверкой Части 1 и AI-черновиком Части 2
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild className="group">
            <Link to="/tutor/mock-exams/new">
              <Plus
                className="h-4 w-4 mr-2 transition-transform duration-300 ease-out group-hover:rotate-90"
                aria-hidden="true"
              />
              Назначить пробник
            </Link>
          </Button>
        </div>
      </div>

      {/* Beta banner — Phase 1 contract */}
      <BetaBanner />

      {/* Error / Recovery status */}
      <TutorDataStatus
        criticalError={error}
        isFetching={isFetching}
        onRetry={refetch}
      />

      {/* Assignments list (or skeleton / empty) */}
      {showSkeleton ? (
        <MockExamListSkeleton />
      ) : !hasData && !error ? (
        <EmptyState />
      ) : hasData ? (
        <div className="space-y-3">
          {sorted.map((item) => (
            <AssignmentCard key={item.id} item={item} />
          ))}
        </div>
      ) : null}

      {/* Library section — always visible (marketing-ready entry point) */}
      <section className="space-y-3 pt-4">
        <div className="flex items-center gap-2">
          <Sparkles
            className="h-5 w-5 text-accent"
            aria-hidden="true"
          />
          <h2 className="text-lg font-semibold tracking-tight">
            Готовые варианты в библиотеке
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {VARIANT_LIBRARY.map((variant) => (
            <VariantLibraryCard
              key={variant.id}
              title={variant.title}
              attribution={variant.attribution}
              meta={variant.meta}
              isAvailable={variant.isAvailable}
              badge={variant.badge}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

// Sort: created_at DESC (newest first). Pure function — no hook overhead;
// caller wraps in `useMemo` for stable identity per render cycle.
function sortByCreatedDesc(
  items: MockExamAssignmentListItem[],
): MockExamAssignmentListItem[] {
  return [...items].sort((a, b) => {
    const da = a.created_at ? parseISO(a.created_at).getTime() : 0;
    const db = b.created_at ? parseISO(b.created_at).getTime() : 0;
    return (isNaN(db) ? 0 : db) - (isNaN(da) ? 0 : da);
  });
}

// ─── Export ──────────────────────────────────────────────────────────────────

export default function TutorMockExams() {
  return (
    <MockExamFeatureGate>
      <TutorMockExamsContent />
    </MockExamFeatureGate>
  );
}
