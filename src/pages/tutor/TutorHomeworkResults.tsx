import { useState, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ArrowLeft,
  ChevronDown,
  Users,
  BarChart3,
  CheckCircle,
  AlertTriangle,
  Loader2,
  Bell,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import TutorGuard from '@/components/TutorGuard';
import { TutorLayout } from '@/components/tutor/TutorLayout';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
import {
  getTutorHomeworkAssignment,
  getTutorHomeworkResults,
  notifyTutorHomeworkStudents,
  type TutorHomeworkAssignmentDetails,
  type TutorHomeworkResultsResponse,
} from '@/lib/tutorHomeworkApi';
import { GuidedThreadViewer } from '@/components/tutor/GuidedThreadViewer';
import {
  createTutorRetry,
  tutorRetryDelay,
  withTutorTimeout,
  TUTOR_STALE_TIME_MS,
  TUTOR_GC_TIME_MS,
} from '@/hooks/tutorQueryOptions';
import { parseISO } from 'date-fns';
import { getSubjectLabel } from '@/types/homework';

// ─── Constants ───────────────────────────────────────────────────────────────

const ERROR_LABELS: Record<string, string> = {
  calculation: 'Ошибка вычисления', concept: 'Ошибка в концепции',
  formatting: 'Оформление', incomplete: 'Неполное решение',
  factual_error: 'Фактическая ошибка', weak_argument: 'Слабая аргументация',
  wrong_answer: 'Неверный ответ', partial: 'Частично верно', correct: 'Верно',
};

// ─── Skeletons ───────────────────────────────────────────────────────────────

function ResultsSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-2/3" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-48" />
      <Skeleton className="h-64" />
    </div>
  );
}

// ─── Metric Card ─────────────────────────────────────────────────────────────

function MetricCard({ label, value, icon, sub }: { label: string; value: string; icon: React.ReactNode; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          {icon}
          <span className="text-xs font-medium">{label}</span>
        </div>
        <p className="text-2xl font-bold">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ─── Guided chat: student row with thread viewer ─────────────────────────────

function GuidedStudentRow({
  student,
  assignmentId,
}: {
  student: {
    student_id: string;
    name: string | null;
  };
  assignmentId: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-md">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/50 transition-colors"
      >
        <p className="font-medium text-sm flex-1">{student.name ?? 'Без имени'}</p>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="px-3 pb-3">
          <GuidedThreadViewer assignmentId={assignmentId} studentId={student.student_id} />
        </div>
      )}
    </div>
  );
}

// ─── Task chart ──────────────────────────────────────────────────────────────

function TaskBarChart({ perTask }: { perTask: TutorHomeworkResultsResponse['per_task'] }) {
  const data = useMemo(
    () =>
      perTask.map((t) => ({
        name: `#${t.order_num}`,
        avg_score: t.avg_score != null ? Math.round(t.avg_score * 100) / 100 : 0,
        max_score: t.max_score,
        correct_rate: t.correct_rate != null ? Math.round(t.correct_rate) : 0,
        errors: t.error_type_histogram.reduce((s, e) => s + e.count, 0),
      })),
    [perTask],
  );

  if (data.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Результаты по задачам</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <RechartsTooltip
              formatter={(value: number, name: string) => {
                const labels: Record<string, string> = {
                  avg_score: 'Средний балл',
                  correct_rate: '% верных',
                  errors: 'Ошибки',
                };
                return [value, labels[name] ?? name];
              }}
            />
            <Bar dataKey="avg_score" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="avg_score" />
            <Bar dataKey="errors" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} name="errors" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ─── Main content ────────────────────────────────────────────────────────────

function TutorHomeworkResultsContent() {
  const { id: assignmentId } = useParams<{ id: string }>();
  const qk = useMemo(() => ['tutor', 'homework', 'assignment', assignmentId] as const, [assignmentId]);
  const rkq = useMemo(() => ['tutor', 'homework', 'results', assignmentId] as const, [assignmentId]);

  const assignmentQuery = useQuery<TutorHomeworkAssignmentDetails>({
    queryKey: qk,
    queryFn: () => withTutorTimeout(qk, getTutorHomeworkAssignment(assignmentId!)),
    enabled: !!assignmentId,
    staleTime: TUTOR_STALE_TIME_MS,
    gcTime: TUTOR_GC_TIME_MS,
    retry: createTutorRetry(qk),
    retryDelay: tutorRetryDelay,
    refetchOnWindowFocus: true,
  });

  const resultsQuery = useQuery<TutorHomeworkResultsResponse>({
    queryKey: rkq,
    queryFn: () => withTutorTimeout(rkq, getTutorHomeworkResults(assignmentId!)),
    enabled: !!assignmentId,
    staleTime: TUTOR_STALE_TIME_MS,
    gcTime: TUTOR_GC_TIME_MS,
    retry: createTutorRetry(rkq),
    retryDelay: tutorRetryDelay,
    refetchOnWindowFocus: true,
  });

  const assignment = assignmentQuery.data?.assignment;
  const results = resultsQuery.data;
  const loading = (assignmentQuery.isLoading || resultsQuery.isLoading) && !assignment && !results;
  const error = assignmentQuery.error || resultsQuery.error;
  const isFetching = assignmentQuery.isFetching || resultsQuery.isFetching;

  const [notifying, setNotifying] = useState(false);

  const handleRetry = useCallback(() => {
    void assignmentQuery.refetch();
    void resultsQuery.refetch();
  }, [assignmentQuery, resultsQuery]);

  const handleRemindUnsubmitted = useCallback(async () => {
    if (!assignmentId) return;
    setNotifying(true);
    try {
      const res = await notifyTutorHomeworkStudents(assignmentId);
      if (res.sent > 0) {
        toast.success(`Напомнено ${res.sent} ученик${res.sent === 1 ? 'у' : 'ам'}`);
      } else {
        toast.info('Нет учеников для напоминания');
      }
    } catch (err) {
      toast.error(`Ошибка: ${err instanceof Error ? err.message : 'неизвестная'}`);
    } finally {
      setNotifying(false);
    }
  }, [assignmentId]);

  // Summary metrics derived from backend-returned aggregates
  const metrics = useMemo(() => {
    if (!results || !assignmentQuery.data) return null;
    const total = assignmentQuery.data.assigned_students.length;
    const submitted = assignmentQuery.data.submissions_summary?.total ?? 0;
    const avgScore = results.summary.avg_score;
    const topError = results.summary.common_error_types[0];
    return { submitted, total, avgScore, topError };
  }, [results, assignmentQuery.data]);

  return (
    <TutorLayout>
      <div className="space-y-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/tutor/homework">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Назад
            </Link>
          </Button>
          <div className="flex-1 min-w-0">
            {assignment ? (
              <>
                <h1 className="text-2xl font-bold truncate">{assignment.title}</h1>
                <p className="text-sm text-muted-foreground">
                  {getSubjectLabel(assignment.subject)}
                  {assignment.deadline && (
                    <> · Дедлайн: {(() => { try { const d = parseISO(assignment.deadline); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }); } catch { return '—'; } })()}</>
                  )}
                </p>
              </>
            ) : (
              <>
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-4 w-32 mt-1" />
              </>
            )}
          </div>
        </div>

        {/* Error */}
        <TutorDataStatus
          error={error ? (error instanceof Error ? error.message : String(error)) : null}
          isFetching={isFetching}
          onRetry={handleRetry}
        />

        {loading ? (
          <ResultsSkeleton />
        ) : results ? (
          <>
            {/* Summary card */}
            {metrics && (
              <Card className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-primary/20">
                <CardContent className="p-4">
                  <p className="text-sm font-medium text-primary mb-3">Сводка</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <MetricCard
                      label="Сдали"
                      value={`${metrics.submitted}/${metrics.total}`}
                      icon={<Users className="h-4 w-4" />}
                    />
                    <MetricCard
                      label="Средний балл"
                      value={metrics.avgScore != null ? `${Math.round(metrics.avgScore)}%` : '—'}
                      icon={<BarChart3 className="h-4 w-4" />}
                    />
                    <MetricCard
                      label="Задач"
                      value={String(results.per_task.length)}
                      icon={<CheckCircle className="h-4 w-4" />}
                    />
                    <MetricCard
                      label="Частая ошибка"
                      value={metrics.topError ? (ERROR_LABELS[metrics.topError.type] ?? metrics.topError.type) : '—'}
                      icon={<AlertTriangle className="h-4 w-4" />}
                      sub={metrics.topError ? `×${metrics.topError.count}` : undefined}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Students table */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Ученики</h2>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRemindUnsubmitted}
                  disabled={notifying}
                  className="gap-2 shrink-0"
                >
                  {notifying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Bell className="h-4 w-4" />
                  )}
                  Напомнить несдавшим
                </Button>
              </div>

              <div className="space-y-2">
                {assignmentQuery.data?.assigned_students.length === 0 ? (
                  <Card className="bg-muted/30">
                    <CardContent className="py-8 text-center">
                      <p className="text-sm text-muted-foreground">Нет назначенных учеников.</p>
                    </CardContent>
                  </Card>
                ) : (
                  assignmentQuery.data?.assigned_students.map((student) => (
                    <GuidedStudentRow
                      key={student.student_id}
                      student={student}
                      assignmentId={assignmentId!}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Task chart */}
            <TaskBarChart perTask={results.per_task} />
          </>
        ) : null}
      </div>
    </TutorLayout>
  );
}

// ─── Export with guard ───────────────────────────────────────────────────────

export default function TutorHomeworkResults() {
  return (
    <TutorGuard>
      <TutorHomeworkResultsContent />
    </TutorGuard>
  );
}
