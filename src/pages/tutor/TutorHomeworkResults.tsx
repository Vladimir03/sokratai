import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Users,
  BarChart3,
  CheckCircle,
  AlertTriangle,
  Save,
  Loader2,
  ImageIcon,
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
  reviewTutorHomeworkSubmission,
  getHomeworkImageSignedUrl,
  notifyTutorHomeworkStudents,
  type TutorHomeworkAssignmentDetails,
  type TutorHomeworkResultsResponse,
  type TutorHomeworkResultsPerStudent,
  type TutorHomeworkSubmissionItem,
  type ReviewItem,
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
import { MathText } from '@/components/kb/ui/MathText';
import { stripLatex } from '@/components/kb/ui/stripLatex';

// ─── Constants ───────────────────────────────────────────────────────────────

const SUBJECT_LABELS: Record<string, string> = {
  math: 'Математика', physics: 'Физика', history: 'История',
  social: 'Обществознание', english: 'Английский', cs: 'Информатика',
};

const STATUS_LABELS: Record<string, { text: string; className: string }> = {
  in_progress: { text: 'В работе', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' },
  submitted: { text: 'Сдано', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' },
  ai_checked: { text: 'AI проверено', className: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400' },
  tutor_reviewed: { text: 'Проверено', className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' },
};

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

// ─── Student Image Viewer ────────────────────────────────────────────────────

function StudentImage({ objectPath }: { objectPath: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getHomeworkImageSignedUrl(objectPath).then((u) => {
      if (!cancelled) { setUrl(u); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [objectPath]);

  if (loading) return <Skeleton className="h-32 w-32 rounded-md" />;
  if (!url) return (
    <div className="h-32 w-32 rounded-md bg-muted flex items-center justify-center">
      <ImageIcon className="h-6 w-6 text-muted-foreground" />
    </div>
  );
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      <img src={url} alt="Ответ ученика" className="h-32 w-auto rounded-md border object-cover" loading="lazy" />
    </a>
  );
}

// ─── Expand Row: single student's task items + review ────────────────────────

function StudentExpandRow({
  student,
  assignmentId,
  workflowMode,
}: {
  student: TutorHomeworkResultsPerStudent;
  assignmentId: string;
  workflowMode?: 'classic' | 'guided_chat';
}) {
  const queryClient = useQueryClient();
  const [overrides, setOverrides] = useState<Record<string, boolean | null>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const ov: Record<string, boolean | null> = {};
    const cm: Record<string, string> = {};
    for (const it of student.submission_items) {
      ov[it.task_id] = it.tutor_override_correct;
      cm[it.task_id] = it.tutor_comment ?? '';
    }
    setOverrides(ov);
    setComments(cm);
  }, [student.submission_items]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const items: ReviewItem[] = student.submission_items.map((it) => ({
        task_id: it.task_id,
        tutor_override_correct: overrides[it.task_id] ?? undefined,
        tutor_comment: comments[it.task_id]?.trim() || null,
      }));
      await reviewTutorHomeworkSubmission(student.submission_id, { items });
      toast.success('Рецензия сохранена');
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'homework', 'results', assignmentId] });
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'homework', 'assignments'] });
    } catch (err) {
      toast.error(`Ошибка: ${err instanceof Error ? err.message : 'неизвестная'}`);
    } finally {
      setSaving(false);
    }
  }, [student, overrides, comments, assignmentId, queryClient]);

  return (
    <div className="space-y-4 p-4 bg-muted/30 rounded-md">
      {student.submission_items.map((item) => (
        <TaskItemReview
          key={item.task_id}
          item={item}
          overrideCorrect={overrides[item.task_id] ?? null}
          comment={comments[item.task_id] ?? ''}
          onOverrideChange={(v) => setOverrides((p) => ({ ...p, [item.task_id]: v }))}
          onCommentChange={(v) => setComments((p) => ({ ...p, [item.task_id]: v }))}
        />
      ))}
      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Сохранить
        </Button>
      </div>
      {workflowMode === 'guided_chat' && (
        <GuidedThreadViewer assignmentId={assignmentId} studentId={student.student_id} />
      )}
    </div>
  );
}

function TaskItemReview({
  item,
  overrideCorrect,
  comment,
  onOverrideChange,
  onCommentChange,
}: {
  item: TutorHomeworkSubmissionItem;
  overrideCorrect: boolean | null;
  comment: string;
  onOverrideChange: (v: boolean | null) => void;
  onCommentChange: (v: string) => void;
}) {
  const isCorrect = overrideCorrect ?? item.ai_is_correct;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium truncate min-w-0">
            Задача {item.task_order_num}: {(() => { const t = stripLatex(item.task_text); return t.length > 80 ? t.slice(0, 80) + '…' : t; })()}
          </span>
          <span className="text-xs text-muted-foreground">{item.ai_score ?? '—'}/{item.max_score}</span>
        </div>

        {/* Student answer */}
        {item.student_text && (
          <div className="text-sm bg-background p-2 rounded border">
            <span className="text-xs text-muted-foreground block mb-1">Ответ ученика:</span>
            <MathText text={item.student_text} className="whitespace-pre-wrap break-words" />
          </div>
        )}

        {/* Photos */}
        {item.student_image_urls && item.student_image_urls.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {item.student_image_urls.map((path, i) => (
              <StudentImage key={i} objectPath={path} />
            ))}
          </div>
        )}

        {/* AI results */}
        {item.ai_feedback && (
          <div className="text-sm bg-background p-2 rounded border">
            <span className="text-xs text-muted-foreground block mb-1">AI отзыв:</span>
            <MathText text={item.ai_feedback} className="whitespace-pre-wrap leading-relaxed" />
          </div>
        )}

        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {item.ai_confidence != null && (
            <span>Уверенность AI: {Math.round(item.ai_confidence * 100)}%</span>
          )}
          {item.ai_error_type && item.ai_error_type !== 'correct' && (
            <Badge variant="outline" className="text-xs">
              {ERROR_LABELS[item.ai_error_type] ?? item.ai_error_type}
            </Badge>
          )}
          {item.recognized_text && (
            <span title={item.recognized_text}>Распознан текст</span>
          )}
        </div>

        {/* Review controls */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-2 border-t">
          <div className="flex items-center gap-2">
            <Label htmlFor={`correct-${item.task_id}`} className="text-sm cursor-pointer">
              Верно
            </Label>
            <Switch
              id={`correct-${item.task_id}`}
              checked={isCorrect === true}
              onCheckedChange={(v) => onOverrideChange(v)}
            />
          </div>
          <div className="flex-1">
            <textarea
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[40px] resize-y"
              placeholder="Комментарий..."
              value={comment}
              onChange={(e) => onCommentChange(e.target.value)}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Guided chat: student row with thread viewer (no submission needed) ──────

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

// ─── Student table row ───────────────────────────────────────────────────────

function StudentRow({
  student,
  assignmentId,
  workflowMode,
  autoExpand,
  highlight,
}: {
  student: TutorHomeworkResultsPerStudent;
  assignmentId: string;
  workflowMode?: 'classic' | 'guided_chat';
  autoExpand?: boolean;
  highlight?: boolean;
}) {
  const [expanded, setExpanded] = useState(autoExpand === true);
  const rowRef = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState(highlight === true);
  const statusCfg = STATUS_LABELS[student.status] ?? { text: student.status, className: '' };

  const hasLowConfidence = student.submission_items.some(
    (it) => it.ai_confidence != null && it.ai_confidence < 0.6,
  );

  useEffect(() => {
    if (autoExpand && rowRef.current) {
      const timer = setTimeout(() => {
        rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [autoExpand]);

  useEffect(() => {
    if (flash) {
      const timer = setTimeout(() => setFlash(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [flash]);

  return (
    <div
      ref={rowRef}
      className={`border rounded-md transition-all duration-700 ${flash ? 'ring-2 ring-primary/60 bg-primary/5' : ''}`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/50 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{student.name ?? 'Без имени'}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant="outline" className={statusCfg.className}>
              {statusCfg.text}
            </Badge>
            {student.percent != null && (
              <span className="text-xs text-muted-foreground">
                {student.total_score}/{student.total_max_score} ({Math.round(student.percent)}%)
              </span>
            )}
            {hasLowConfidence && (
              <Badge variant="outline" className="text-xs bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400">
                ⚠️ Низкая уверенность AI
              </Badge>
            )}
          </div>
        </div>
        {student.top_error_types.length > 0 && (
          <div className="hidden sm:flex gap-1">
            {student.top_error_types.slice(0, 2).map((e) => (
              <Badge key={e.type} variant="outline" className="text-xs">
                {ERROR_LABELS[e.type] ?? e.type}
              </Badge>
            ))}
          </div>
        )}
        {expanded ? <ChevronUp className="h-4 w-4 flex-shrink-0" /> : <ChevronDown className="h-4 w-4 flex-shrink-0" />}
      </button>
      {expanded && (
        <StudentExpandRow
          student={student}
          assignmentId={assignmentId}
          workflowMode={workflowMode}
        />
      )}
    </div>
  );
}

// ─── Student attempt group ───────────────────────────────────────────────────

function StudentRowGroup({
  attempts,
  assignmentId,
  workflowMode,
  targetSubmissionId,
}: {
  attempts: TutorHomeworkResultsPerStudent[];
  assignmentId: string;
  workflowMode?: 'classic' | 'guided_chat';
  targetSubmissionId: string | null;
}) {
  const latest = attempts[0];
  const older = attempts.slice(1);
  const targetIsOlder = targetSubmissionId != null && older.some((a) => a.submission_id === targetSubmissionId);
  const [showHistory, setShowHistory] = useState(targetIsOlder);

  return (
    <div>
      <StudentRow
        student={latest}
        assignmentId={assignmentId}
        workflowMode={workflowMode}
        autoExpand={targetSubmissionId === latest.submission_id}
        highlight={targetSubmissionId === latest.submission_id}
      />
      {older.length > 0 && (
        <div className="ml-4">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1 px-1"
          >
            {showHistory ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showHistory ? 'Скрыть историю' : `История (${older.length})`}
          </button>
          {showHistory && (
            <div className="space-y-2 mt-1">
              {older.map((attempt) => (
                <StudentRow
                  key={attempt.submission_id}
                  student={attempt}
                  assignmentId={assignmentId}
                  workflowMode={workflowMode}
                  autoExpand={targetSubmissionId === attempt.submission_id}
                  highlight={targetSubmissionId === attempt.submission_id}
                />
              ))}
            </div>
          )}
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
  const [searchParams] = useSearchParams();
  const targetSubmissionId = searchParams.get('submission') || null;
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

  // Group per_student by student_id (multiple submissions), sort by submitted_at DESC
  const groupedStudents = useMemo(() => {
    if (!results) return [];
    const groups: Record<string, TutorHomeworkResultsPerStudent[]> = {};
    for (const s of results.per_student) {
      if (!groups[s.student_id]) groups[s.student_id] = [];
      groups[s.student_id].push(s);
    }
    for (const group of Object.values(groups)) {
      group.sort((a, b) => {
        const aTime = a.submitted_at ? parseISO(a.submitted_at).getTime() : 0;
        const bTime = b.submitted_at ? parseISO(b.submitted_at).getTime() : 0;
        return bTime - aTime;
      });
    }
    return Object.values(groups);
  }, [results]);

  // Compute metrics
  const metrics = useMemo(() => {
    if (!results) return null;
    const { summary, per_student } = results;
    const submitted = per_student.filter((s) => s.status !== 'in_progress').length;
    const total = per_student.length;

    let flawlessCount = 0;
    for (const s of per_student) {
      if (s.submission_items.length > 0) {
        const hasError = s.submission_items.some(
          (it) => it.ai_error_type && it.ai_error_type !== 'correct',
        );
        if (!hasError) flawlessCount++;
      }
    }
    const flawlessRate = submitted > 0 ? Math.round((flawlessCount / submitted) * 100) : null;

    const topError = summary.common_error_types[0];

    return { submitted, total, avgScore: summary.avg_score, flawlessRate, topError };
  }, [results]);

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
                  {SUBJECT_LABELS[assignment.subject] ?? assignment.subject}
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
                  <p className="text-sm font-medium text-primary mb-3">Сводка AI-проверки</p>
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
                      label="Без ошибок"
                      value={metrics.flawlessRate != null ? `${metrics.flawlessRate}%` : '—'}
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

              {/* Guided chat mode: show assigned students with threads directly */}
              {assignment?.workflow_mode === 'guided_chat' && assignmentQuery.data?.assigned_students ? (
                <div className="space-y-2">
                  {assignmentQuery.data.assigned_students.length === 0 ? (
                    <Card className="bg-muted/30">
                      <CardContent className="py-8 text-center">
                        <p className="text-sm text-muted-foreground">Нет назначенных учеников.</p>
                      </CardContent>
                    </Card>
                  ) : (
                    assignmentQuery.data.assigned_students.map((student) => (
                      <GuidedStudentRow
                        key={student.student_id}
                        student={student}
                        assignmentId={assignmentId!}
                      />
                    ))
                  )}
                </div>
              ) : (
                /* Classic mode: show submission-based results */
                groupedStudents.length === 0 ? (
                  <Card className="bg-muted/30">
                    <CardContent className="py-8 text-center">
                      <p className="text-sm text-muted-foreground">Пока нет работ от учеников.</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {groupedStudents.map((attempts) => (
                      <StudentRowGroup
                        key={attempts[0].student_id}
                        attempts={attempts}
                        assignmentId={assignmentId!}
                        workflowMode={assignment?.workflow_mode}
                        targetSubmissionId={targetSubmissionId}
                      />
                    ))}
                  </div>
                )
              )}
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
