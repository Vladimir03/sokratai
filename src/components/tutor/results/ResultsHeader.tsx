import { memo, type ComponentType, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Users,
  Award,
  UserMinus,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { getSubjectLabel } from '@/types/homework';
import {
  formatDeadline,
  getDeadlineUrgency,
  URGENCY_CONFIG,
  type DeadlineUrgency,
} from '@/lib/homeworkDeadline';
import type {
  TutorHomeworkAssignmentDetails,
  TutorHomeworkResultsResponse,
} from '@/lib/tutorHomeworkApi';

interface ResultsHeaderProps {
  assignment: TutorHomeworkAssignmentDetails['assignment'] | null;
  totalStudents: number;
  results: TutorHomeworkResultsResponse | null;
  isLoading: boolean;
  /**
   * Optional actions rendered in the top-right of Row 1. Used by the merged
   * TutorHomeworkDetail page for status badge + Edit + Delete buttons. On
   * mobile they wrap under the title block via flex-wrap.
   */
  rightSlot?: ReactNode;
  /** Back button destination. Defaults to the homework list. */
  backTo?: string;
}

function fmtAbs(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export const ResultsHeader = memo(function ResultsHeader({
  assignment,
  totalStudents,
  results,
  isLoading,
  rightSlot,
  backTo = '/tutor/homework',
}: ResultsHeaderProps) {
  const perStudent = results?.per_student ?? [];
  const submitted = perStudent.filter((s) => s.submitted).length;
  const notStarted = Math.max(0, totalStudents - submitted);
  // Backend computes `needs_attention` only for submitted students (low score
  // or hint overuse). Non-submitted students always get `false` there, so
  // "Требует внимания" in the header must also count them — otherwise the
  // metric disagrees with the action block below, which renders one row per
  // not-started student. No double-counting: not-started ∩ needs_attention = ∅.
  const attentionFromScores = perStudent.filter((s) => s.needs_attention).length;
  const needsAttention = notStarted + attentionFromScores;

  const submittedPerStudent = perStudent.filter((s) => s.submitted);
  // max_score_total is constant for all students in the same assignment.
  const maxScoreTotal = results?.per_student[0]?.max_score_total ?? 0;
  const avgAbsolute =
    submittedPerStudent.length > 0
      ? submittedPerStudent.reduce((sum, s) => sum + s.final_score_total, 0) /
        submittedPerStudent.length
      : null;
  const avgScoreLabel =
    avgAbsolute != null && maxScoreTotal > 0
      ? `${fmtAbs(avgAbsolute)}/${fmtAbs(maxScoreTotal)}`
      : '—';

  const showSkeleton = isLoading && !assignment;

  return (
    <Card className="border-slate-200">
      <CardContent className="p-4 md:p-6 space-y-4">
        {/* Row 1: back button + title + deadline badge + optional rightSlot */}
        <div className="flex items-start gap-3 flex-wrap md:flex-nowrap">
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="shrink-0 -ml-2"
          >
            <Link to={backTo}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Назад
            </Link>
          </Button>
          <div className="flex-1 min-w-0">
            {showSkeleton ? (
              <>
                <Skeleton className="h-7 w-48" />
                <Skeleton className="h-4 w-32 mt-2" />
              </>
            ) : assignment ? (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl md:text-2xl font-semibold text-slate-900 truncate">
                    {assignment.title}
                  </h1>
                  <DeadlineBadge deadline={assignment.deadline} />
                </div>
                <p className="text-sm text-slate-500 mt-1">
                  {getSubjectLabel(assignment.subject)}
                  {assignment.deadline && (
                    <> · {formatDeadline(assignment.deadline) ?? '—'}</>
                  )}
                </p>
              </>
            ) : null}
          </div>
          {rightSlot ? (
            <div className="flex items-center gap-2 shrink-0 md:ml-auto">
              {rightSlot}
            </div>
          ) : null}
        </div>

        {/* Row 2: metric strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-slate-200">
          <Metric
            icon={Users}
            label="Сдали"
            value={`${submitted}/${totalStudents}`}
          />
          <Metric icon={Award} label="Средний балл" value={avgScoreLabel} />
          <Metric
            icon={UserMinus}
            label="Не приступали"
            value={String(notStarted)}
            tone={notStarted > 0 ? 'warn' : 'neutral'}
          />
          <Metric
            icon={AlertTriangle}
            label="Требует внимания"
            value={String(needsAttention)}
            tone={needsAttention > 0 ? 'danger' : 'neutral'}
          />
        </div>
      </CardContent>
    </Card>
  );
});

// ─── Sub-components (NOT separate Cards) ─────────────────────────────────────

function DeadlineBadge({ deadline }: { deadline: string | null }) {
  const urgency = getDeadlineUrgency(deadline);
  if (urgency === 'none' || urgency === 'normal') return null;
  const cfg = URGENCY_CONFIG[urgency];
  const styles: Record<DeadlineUrgency, string> = {
    overdue: 'bg-red-50 text-red-700 border-red-200',
    today: 'bg-amber-50 text-amber-700 border-amber-200',
    soon: 'bg-amber-50 text-amber-600 border-amber-100',
    normal: '',
    none: '',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        styles[urgency],
      )}
    >
      <Clock className="h-3 w-3" />
      {cfg.label ?? 'Скоро'}
    </span>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: 'neutral' | 'warn' | 'danger';
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-slate-500 mb-1">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p
        className={cn(
          'text-2xl font-semibold tabular-nums',
          tone === 'neutral' && 'text-slate-900',
          tone === 'warn' && 'text-amber-600',
          tone === 'danger' && 'text-red-600',
        )}
      >
        {value}
      </p>
    </div>
  );
}
