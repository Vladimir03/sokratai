// Mock Exams v1 — TASK-10: tutor detail page (heatmap dashboard).
//
// Job: R1 — посмотреть прогресс назначенного пробника + drill-down в review.
// AC-5: tutor видит overview (KPI) + heatmap (students × tasks) + click row →
//       /tutor/mock-exams/:id/review/:studentId.
// Spec: docs/delivery/features/mock-exams-v1/spec.md AC-5
// Mockup: SokratAI/docs/delivery/features/mock-exams-v1/mockup.html (Screen 3)
//
// Анти-патерны исключены (см. .claude/rules/90-design-system.md):
//   • Lucide icons вместо emoji
//   • shadcn Card / Badge / Button
//   • `transition-shadow` (не `transition-all`) — performance.md
//   • Mobile-responsive: KPI grid 5 → 3 → 2 cols
//
// КРИТИЧНО (.claude/rules/80-cross-browser.md): heatmap — separate file,
// см. `src/components/tutor/mock-exams/MockExamHeatmap.tsx` для sticky+
// border-collapse Safari fix.

import { useCallback, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, ClipboardCheck, Info, Sparkles, FileWarning } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
import { MockExamFeatureGate } from './MockExamFeatureGate';
import { useMockExamAssignment } from '@/hooks/useMockExamAssignment';
import { MockExamHeatmap } from '@/components/tutor/mock-exams/MockExamHeatmap';
import { MockExamInviteLinksSection } from '@/components/tutor/mock-exams/MockExamInviteLinksSection';
import { formatDeadline } from '@/lib/homeworkDeadline';
import { cn } from '@/lib/utils';
import type {
  MockExamAssignmentDetail,
  MockExamAssignmentStatus,
  MockExamAttemptListItem,
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
    className: 'border-slate-200 bg-slate-100 text-slate-600',
  },
  active: {
    label: 'Активное',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
  closed: {
    label: 'Завершено',
    className: 'border-slate-200 bg-slate-50 text-slate-600',
  },
};

const MODE_LABEL: Record<MockExamMode, string> = {
  blank: 'С бланком',
  form: 'Форма',
  manual_entry: 'Внесён вручную',
};

// ─── KPI computation ─────────────────────────────────────────────────────────

interface KpiSnapshot {
  total: number;
  approved: number;
  inProgress: number;
  notStarted: number;
  awaitingReview: number;
  averagePart1: number | null;
  totalMax: number;
}

function deriveKpi(detail: MockExamAssignmentDetail): KpiSnapshot {
  const attempts = detail.attempts ?? [];
  let approved = 0;
  let inProgress = 0;
  let notStarted = 0;
  let awaitingReview = 0;
  let part1Sum = 0;
  let part1Count = 0;

  for (const a of attempts) {
    if (a.status === 'approved' || a.status === 'manually_entered') {
      approved += 1;
    } else if (a.status === 'in_progress') {
      // Backend создаёт mock_exam_attempts с status='in_progress' при assignment,
      // но started_at = NULL пока student не открыл /student/mock-exams/:id.
      // Real «в процессе» = status='in_progress' AND started_at IS NOT NULL.
      if (a.started_at === null) {
        notStarted += 1;
      } else {
        inProgress += 1;
      }
    } else if (a.status === 'awaiting_review' || a.status === 'submitted' || a.status === 'ai_checking') {
      awaitingReview += 1;
    }
    if (a.total_part1_score !== null) {
      part1Sum += a.total_part1_score;
      part1Count += 1;
    }
  }

  const averagePart1 = part1Count > 0 ? part1Sum / part1Count : null;

  return {
    total: attempts.length,
    approved,
    inProgress,
    notStarted,
    awaitingReview,
    averagePart1,
    totalMax: detail.total_max_score ?? 0,
  };
}

// ─── KPI card ────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  hint?: string | null;
  tone?: 'default' | 'amber' | 'accent' | 'amber-warn';
}

function KpiCard({ label, value, hint, tone = 'default' }: KpiCardProps) {
  const isWarn = tone === 'amber-warn';
  const wrapperClass = cn(
    'rounded-lg border p-4',
    isWarn
      ? 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900'
      : 'bg-white border-slate-200 dark:bg-slate-900 dark:border-slate-800',
  );
  const labelClass = cn(
    'text-[11px] font-medium uppercase tracking-wide',
    isWarn ? 'text-amber-800 dark:text-amber-300' : 'text-muted-foreground',
  );
  const valueClass = cn(
    'text-2xl font-semibold tabular-nums leading-tight mt-1',
    tone === 'amber' && 'text-amber-700 dark:text-amber-300',
    tone === 'amber-warn' && 'text-amber-700 dark:text-amber-300',
    tone === 'accent' && 'text-accent',
    tone === 'default' && 'text-slate-900 dark:text-slate-100',
  );
  return (
    <div className={wrapperClass}>
      <div className={labelClass}>{label}</div>
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
}

// ─── Header ──────────────────────────────────────────────────────────────────

function DetailHeader({ detail }: { detail: MockExamAssignmentDetail }) {
  const statusCfg = STATUS_CONFIG[detail.status];
  const modeLabel = MODE_LABEL[detail.mode];
  const deadlineStr = formatDeadline(detail.deadline);
  const studentCount = detail.attempts?.length ?? 0;

  return (
    <div className="space-y-3">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-slate-500" aria-label="Хлебные крошки">
        <Link
          to="/tutor/mock-exams"
          className="hover:text-slate-900 transition-colors"
        >
          Пробники
        </Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="text-slate-900 truncate">{detail.title}</span>
      </nav>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 leading-tight">
              {detail.title}
            </h1>
            <Badge variant="outline" className={statusCfg.className}>
              {statusCfg.label}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {detail.display_title}
            {deadlineStr ? <> · Дедлайн {deadlineStr}</> : null}
            <> · </>
            <span className="font-medium text-slate-700 dark:text-slate-300">
              {modeLabel}
            </span>
            <> · </>
            {studentCount}{' '}
            {studentCount === 1
              ? 'ученик'
              : studentCount < 5
                ? 'ученика'
                : 'учеников'}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── AI draft warning banner ─────────────────────────────────────────────────

function AiDraftBanner({ awaitingCount }: { awaitingCount: number }) {
  if (awaitingCount === 0) return null;
  return (
    <div
      role="note"
      className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30"
    >
      <FileWarning
        className="h-5 w-5 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400"
        aria-hidden="true"
      />
      <div className="space-y-1">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
          Часть 2: оценки AI — это черновик
        </p>
        <p className="text-sm text-amber-800 dark:text-amber-300/90 leading-relaxed">
          Ученики и родители НЕ видят их до твоего подтверждения. Кликни на ученика,
          чтобы открыть проверку. Анонимных лидов — обязательно проверь каждое
          задание вручную.
        </p>
      </div>
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="rounded-lg border border-slate-200 bg-white p-4 space-y-2"
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-16" />
          </div>
        ))}
      </div>
      <Skeleton className="h-72 w-full rounded-lg" />
    </div>
  );
}

// ─── Empty / not-found ───────────────────────────────────────────────────────

function NotFoundState() {
  return (
    <Card className="bg-muted/30">
      <CardContent className="flex flex-col items-center text-center gap-5 py-12">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <ClipboardCheck
            className="h-8 w-8 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
        <div className="space-y-1.5">
          <h3 className="font-semibold tracking-tight text-xl">
            Пробник не найден
          </h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
            Возможно, он был удалён или ссылка повреждена. Вернись к списку
            пробников.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/tutor/mock-exams">К списку пробников</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Main content ────────────────────────────────────────────────────────────

function TutorMockExamDetailContent() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { detail, loading, error, refetch, isFetching, isRecovering, failureCount } =
    useMockExamAssignment(id);

  const handleSelectAttempt = useCallback(
    (attempt: MockExamAttemptListItem) => {
      // Spec: `/tutor/mock-exams/:id/review/:studentId`.
      // Anonymous attempts (no student_id) пока fall back на anonymous_id —
      // review surface (TASK-11) разрулит. Phase 1 пилоты используют
      // авторизованных учеников, anonymous лидов меньше.
      const target = attempt.student_id ?? attempt.anonymous_id;
      if (!id || !target) return;
      navigate(
        `/tutor/mock-exams/${encodeURIComponent(id)}/review/${encodeURIComponent(target)}`,
      );
    },
    [id, navigate],
  );

  const kpi = useMemo(() => (detail ? deriveKpi(detail) : null), [detail]);

  // Phase 1 предположение: variant.part1_max и part2_max не приходят в detail
  // payload (только total_max_score). Backfill эвристически: ЕГЭ физика =
  // 28 (part1) + 17 (part2) = 45. Когда backend начнёт возвращать part1/part2
  // explicit — заменить на detail.part1_max / detail.part2_max.
  const part1Max = 28;
  const part2Max = 17;
  const totalMax = detail?.total_max_score ?? part1Max + part2Max;

  if (loading && !detail) {
    return <DetailSkeleton />;
  }

  if (error && !detail) {
    return (
      <div className="space-y-4">
        <TutorDataStatus
          error={error}
          isFetching={isFetching}
          isRecovering={isRecovering}
          failureCount={failureCount}
          onRetry={refetch}
        />
      </div>
    );
  }

  if (!detail) {
    return <NotFoundState />;
  }

  return (
    <div className="space-y-6">
      <DetailHeader detail={detail} />

      {/* Recovery / error status (non-blocking, shown above content) */}
      <TutorDataStatus
        error={error}
        isFetching={isFetching}
        isRecovering={isRecovering}
        failureCount={failureCount}
        onRetry={refetch}
      />

      {/* KPI cards: 5 metrics. Mobile: 2 cols, sm: 3, md+: 5. */}
      {kpi ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          <KpiCard
            label="Сдали"
            value={String(kpi.approved)}
            hint={`/ ${kpi.total}`}
            tone={kpi.approved > 0 ? 'accent' : 'default'}
          />
          <KpiCard
            label="В процессе"
            value={String(kpi.inProgress)}
            tone={kpi.inProgress > 0 ? 'amber' : 'default'}
          />
          <KpiCard
            label="Не приступали"
            value={String(kpi.notStarted)}
          />
          <KpiCard
            label="Средний первичный"
            value={
              kpi.averagePart1 !== null
                ? Math.round(kpi.averagePart1).toString()
                : '—'
            }
            hint={kpi.averagePart1 !== null ? `/ ${part1Max}` : null}
            tone={kpi.averagePart1 !== null ? 'accent' : 'default'}
          />
          <KpiCard
            label="Требует AI-проверки"
            value={String(kpi.awaitingReview)}
            hint={kpi.awaitingReview > 0 ? 'учеников' : null}
            tone={kpi.awaitingReview > 0 ? 'amber-warn' : 'default'}
          />
        </div>
      ) : null}

      {/* Heatmap section */}
      <MockExamHeatmap
        attempts={detail.attempts}
        part1Max={part1Max}
        part2Max={part2Max}
        totalMax={totalMax}
        onSelectAttempt={handleSelectAttempt}
      />

      {/* AI draft warning banner — only when есть awaiting_review attempts. */}
      <AiDraftBanner awaitingCount={kpi?.awaitingReview ?? 0} />

      {/* FIX-4b — публичные ссылки (lead-gen). Скрыто на manual_entry. */}
      {id ? (
        <MockExamInviteLinksSection assignmentId={id} mode={detail.mode} />
      ) : null}

      {/* Empty-state hint когда attempt'ов нет (assigned but no starts yet). */}
      {detail.attempts.length === 0 ? (
        <div
          role="note"
          className="flex gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4"
        >
          <Info
            className="h-5 w-5 flex-shrink-0 mt-0.5 text-slate-500"
            aria-hidden="true"
          />
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-900">
              Пока никто не приступил
            </p>
            <p className="text-sm text-slate-700 leading-relaxed">
              Когда ученики начнут проходить, ты увидишь их прогресс здесь.
            </p>
          </div>
        </div>
      ) : null}

      {/* Per-task hydration (cell-by-cell colored scores) — следующая итерация.
          Тут только привычный AI-черновик банер + structural heatmap. */}
      <p className="text-xs text-slate-400 text-center pt-4 flex items-center justify-center gap-1.5">
        <Sparkles className="h-3 w-3" aria-hidden="true" />
        Цветные клетки 1–26 появятся после прохождения учениками
      </p>
    </div>
  );
}

// ─── Export ──────────────────────────────────────────────────────────────────

export default function TutorMockExamDetail() {
  return (
    <MockExamFeatureGate>
      <TutorMockExamDetailContent />
    </MockExamFeatureGate>
  );
}
