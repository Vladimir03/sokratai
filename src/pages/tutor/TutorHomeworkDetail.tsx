import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, Users, BarChart3, Clock, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import TutorGuard from '@/components/TutorGuard';
import { TutorLayout } from '@/components/tutor/TutorLayout';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
import {
  getTutorHomeworkAssignment,
  getTutorHomeworkResults,
  type TutorHomeworkAssignmentDetails,
  type TutorHomeworkResultsResponse,
  type HomeworkAssignmentStatus,
  type HomeworkSubject,
} from '@/lib/tutorHomeworkApi';
import {
  createTutorRetry,
  TUTOR_STALE_TIME_MS,
  TUTOR_GC_TIME_MS,
  tutorRetryDelay,
  withTutorTimeout,
  toTutorErrorMessage,
} from '@/hooks/tutorQueryOptions';

// ─── Constants ───────────────────────────────────────────────────────────────

const SUBJECT_LABELS: Record<HomeworkSubject, string> = {
  math: 'Математика', physics: 'Физика', history: 'История',
  social: 'Обществознание', english: 'Английский', cs: 'Информатика',
};

const STATUS_CONFIG: Record<HomeworkAssignmentStatus, { label: string; className: string }> = {
  draft: { label: 'Черновик', className: 'bg-muted text-muted-foreground border-muted' },
  active: { label: 'Активное', className: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800' },
  closed: { label: 'Завершено', className: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700' },
};

function formatDate(d: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return '—'; }
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-48" />
      <Skeleton className="h-48" />
    </div>
  );
}

// ─── Stats Cards ─────────────────────────────────────────────────────────────

function StatsCards({
  details,
  results,
}: {
  details: TutorHomeworkAssignmentDetails;
  results: TutorHomeworkResultsResponse | undefined;
}) {
  const { submissions_summary, assigned_students } = details;
  const avgScore = results?.summary?.avg_score;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card animate={false}>
        <CardContent className="p-4 text-center">
          <Users className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
          <div className="text-2xl font-bold">{assigned_students.length}</div>
          <div className="text-xs text-muted-foreground">Назначено</div>
        </CardContent>
      </Card>
      <Card animate={false}>
        <CardContent className="p-4 text-center">
          <CheckCircle2 className="h-5 w-5 mx-auto mb-1 text-green-600" />
          <div className="text-2xl font-bold">{submissions_summary.total}</div>
          <div className="text-xs text-muted-foreground">Сдали</div>
        </CardContent>
      </Card>
      <Card animate={false}>
        <CardContent className="p-4 text-center">
          <BarChart3 className="h-5 w-5 mx-auto mb-1 text-blue-600" />
          <div className="text-2xl font-bold">
            {avgScore != null ? `${Math.round(avgScore)}%` : '—'}
          </div>
          <div className="text-xs text-muted-foreground">Средний балл</div>
        </CardContent>
      </Card>
      <Card animate={false}>
        <CardContent className="p-4 text-center">
          <BookOpen className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
          <div className="text-2xl font-bold">{details.tasks.length}</div>
          <div className="text-xs text-muted-foreground">Задач</div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Tasks List ──────────────────────────────────────────────────────────────

function TasksList({ details }: { details: TutorHomeworkAssignmentDetails }) {
  if (details.tasks.length === 0) return null;

  return (
    <Card animate={false}>
      <CardHeader>
        <CardTitle className="text-lg">Задачи</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {details.tasks.map((task, idx) => (
          <div key={task.id} className="flex gap-3 p-3 rounded-lg bg-muted/30">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium">
              {idx + 1}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm whitespace-pre-wrap break-words">{task.task_text}</p>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                <span>Макс. баллов: {task.max_score}</span>
                {task.correct_answer && <span>Ответ: {task.correct_answer}</span>}
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ─── Students List ───────────────────────────────────────────────────────────

function StudentsList({
  details,
  results,
}: {
  details: TutorHomeworkAssignmentDetails;
  results: TutorHomeworkResultsResponse | undefined;
}) {
  const { assigned_students } = details;
  if (assigned_students.length === 0) {
    return (
      <Card animate={false} className="bg-muted/30">
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Ученики ещё не назначены</p>
        </CardContent>
      </Card>
    );
  }

  const submissionMap = new Map(
    (results?.per_student ?? []).map(s => [s.student_id, s]),
  );

  return (
    <Card animate={false}>
      <CardHeader>
        <CardTitle className="text-lg">Ученики</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="divide-y">
          {assigned_students.map((student) => {
            const sub = submissionMap.get(student.student_id);
            return (
              <div key={student.student_id} className="flex items-center justify-between py-3 gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{student.name || 'Без имени'}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {student.notified ? (
                      <span className="text-xs text-green-600 flex items-center gap-0.5">
                        <CheckCircle2 className="h-3 w-3" /> Уведомлён
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                        <AlertCircle className="h-3 w-3" /> Не уведомлён
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  {sub ? (
                    <div>
                      <Badge variant="outline" className={
                        sub.status === 'ai_checked' || sub.status === 'tutor_reviewed'
                          ? 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400'
                      }>
                        {sub.status === 'ai_checked' ? 'Проверено AI' :
                         sub.status === 'tutor_reviewed' ? 'Проверено' :
                         sub.status === 'submitted' ? 'Сдано' :
                         sub.status}
                      </Badge>
                      {sub.total_score != null && sub.total_max_score != null && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {sub.total_score}/{sub.total_max_score}
                        </p>
                      )}
                    </div>
                  ) : (
                    <Badge variant="outline" className="bg-muted text-muted-foreground border-muted">
                      Не сдано
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Content ────────────────────────────────────────────────────────────

function TutorHomeworkDetailContent() {
  const { id } = useParams<{ id: string }>();

  const detailsQueryKey = ['tutor', 'homework', 'detail', id] as const;
  const resultsQueryKey = ['tutor', 'homework', 'results', id] as const;

  const detailsQuery = useQuery<TutorHomeworkAssignmentDetails>({
    queryKey: detailsQueryKey,
    queryFn: () => withTutorTimeout(detailsQueryKey, getTutorHomeworkAssignment(id!)),
    enabled: !!id,
    staleTime: TUTOR_STALE_TIME_MS,
    gcTime: TUTOR_GC_TIME_MS,
    retry: createTutorRetry(detailsQueryKey),
    retryDelay: tutorRetryDelay,
    refetchOnWindowFocus: true,
  });

  const resultsQuery = useQuery<TutorHomeworkResultsResponse>({
    queryKey: resultsQueryKey,
    queryFn: () => withTutorTimeout(resultsQueryKey, getTutorHomeworkResults(id!)),
    enabled: !!id && detailsQuery.isSuccess,
    staleTime: TUTOR_STALE_TIME_MS,
    gcTime: TUTOR_GC_TIME_MS,
    retry: createTutorRetry(resultsQueryKey),
    retryDelay: tutorRetryDelay,
    refetchOnWindowFocus: true,
  });

  const details = detailsQuery.data;
  const results = resultsQuery.data;
  const error = detailsQuery.error
    ? toTutorErrorMessage('Не удалось загрузить задание', detailsQuery.error)
    : null;
  const isLoading = detailsQuery.isLoading;

  return (
    <TutorLayout>
      <div className="space-y-6">
        {/* Back link */}
        <Button variant="ghost" size="sm" asChild className="gap-2 -ml-2">
          <Link to="/tutor/homework">
            <ArrowLeft className="h-4 w-4" />
            Назад к списку
          </Link>
        </Button>

        {/* Error */}
        <TutorDataStatus
          error={error}
          isFetching={detailsQuery.isFetching}
          isRecovering={detailsQuery.isFetching && detailsQuery.failureCount > 0}
          failureCount={detailsQuery.failureCount}
          onRetry={() => void detailsQuery.refetch()}
        />

        {isLoading && !details ? (
          <DetailSkeleton />
        ) : details ? (
          <>
            {/* Header */}
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold">{details.assignment.title}</h1>
                <Badge variant="outline" className={STATUS_CONFIG[details.assignment.status as HomeworkAssignmentStatus]?.className}>
                  {STATUS_CONFIG[details.assignment.status as HomeworkAssignmentStatus]?.label ?? details.assignment.status}
                </Badge>
              </div>
              <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground flex-wrap">
                <span>{SUBJECT_LABELS[details.assignment.subject] ?? details.assignment.subject}</span>
                {details.assignment.topic && <span>· {details.assignment.topic}</span>}
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  Дедлайн: {formatDate(details.assignment.deadline)}
                </span>
              </div>
              {details.assignment.description && (
                <p className="text-sm text-muted-foreground mt-2">{details.assignment.description}</p>
              )}
            </div>

            {/* Stats */}
            <StatsCards details={details} results={results} />

            {/* Tasks */}
            <TasksList details={details} />

            {/* Students */}
            <StudentsList details={details} results={results} />
          </>
        ) : null}
      </div>
    </TutorLayout>
  );
}

// ─── Export ──────────────────────────────────────────────────────────────────

export default function TutorHomeworkDetail() {
  return (
    <TutorGuard>
      <TutorHomeworkDetailContent />
    </TutorGuard>
  );
}
