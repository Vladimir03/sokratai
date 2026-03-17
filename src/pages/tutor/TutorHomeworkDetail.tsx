import { useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, Users, BarChart3, Clock, CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronUp, ImageIcon, WifiOff, Paperclip, ExternalLink, Edit, Trash2, ZoomIn } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import TutorGuard from '@/components/TutorGuard';
import { TutorLayout } from '@/components/tutor/TutorLayout';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
import { GuidedThreadViewer } from '@/components/tutor/GuidedThreadViewer';
import {
  getTutorHomeworkAssignment,
  getHomeworkImageSignedUrl,
  getTaskImageSignedUrl,
  getMaterialSignedUrl,
  getTutorHomeworkResults,
  updateTutorHomeworkAssignment,
  deleteTutorHomeworkAssignment,
  type TutorHomeworkAssignmentDetails,
  type TutorHomeworkResultsResponse,
  type TutorHomeworkSubmissionItem,
  type HomeworkAssignmentStatus,
  type HomeworkSubject,
  type DeliveryStatus,
  type HomeworkMaterial,
} from '@/lib/tutorHomeworkApi';
import { getSubjectLabel } from '@/types/homework';
import { parseISO } from 'date-fns';
import { MathText } from '@/components/kb/ui/MathText';
import {
  createTutorRetry,
  TUTOR_STALE_TIME_MS,
  TUTOR_GC_TIME_MS,
  tutorRetryDelay,
  withTutorTimeout,
  toTutorErrorMessage,
} from '@/hooks/tutorQueryOptions';

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<HomeworkAssignmentStatus, { label: string; className: string }> = {
  draft: { label: 'Черновик', className: 'bg-muted text-muted-foreground border-muted' },
  active: { label: 'Активное', className: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800' },
  closed: { label: 'Завершено', className: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700' },
};

const HOMEWORK_SUBJECTS: { value: HomeworkSubject; label: string }[] = [
  { value: 'math', label: 'Математика' },
  { value: 'physics', label: 'Физика' },
  { value: 'history', label: 'История' },
  { value: 'social', label: 'Обществознание' },
  { value: 'english', label: 'Английский' },
  { value: 'cs', label: 'Информатика' },
];

/** Convert an ISO/UTC date string to a local datetime-local input value (YYYY-MM-DDTHH:mm). */
function toLocalDatetimeString(isoString: string): string {
  const d = parseISO(isoString);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  try {
    return parseISO(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return '—'; }
}

function DeliveryBadge({ status }: { status: DeliveryStatus | undefined }) {
  if (!status || status === 'pending') return null;
  if (status === 'delivered') {
    return (
      <span className="text-xs text-green-600 flex items-center gap-0.5">
        <CheckCircle2 className="h-3 w-3" /> Доставлено
      </span>
    );
  }
  if (status === 'failed_not_connected') {
    return (
      <span className="text-xs text-amber-500 flex items-center gap-0.5">
        <WifiOff className="h-3 w-3" /> Нет Telegram
      </span>
    );
  }
  return (
    <span className="text-xs text-red-500 flex items-center gap-0.5">
      <XCircle className="h-3 w-3" /> Ошибка доставки
    </span>
  );
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
              <MathText text={task.task_text} className="text-sm whitespace-pre-wrap break-words" />
              <TaskImagePreview assignmentId={details.assignment.id} taskId={task.id} taskImageUrl={task.task_image_url} />
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                <span>Макс. баллов: {task.max_score}</span>
                {task.correct_answer && <span>Ответ: <MathText text={task.correct_answer} as="span" className="font-mono" /></span>}
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function TaskImagePreview({ assignmentId, taskId, taskImageUrl }: { assignmentId: string; taskId: string; taskImageUrl: string | null }) {
  const [open, setOpen] = useState(false);
  const isExternal = Boolean(taskImageUrl && /^https?:\/\//i.test(taskImageUrl));

  const imageQuery = useQuery<string | null>({
    queryKey: ['tutor', 'homework', 'task-image-preview', assignmentId, taskId],
    queryFn: () => getTaskImageSignedUrl(assignmentId, taskId),
    enabled: Boolean(taskImageUrl) && !isExternal,
    staleTime: TUTOR_STALE_TIME_MS,
    gcTime: TUTOR_GC_TIME_MS,
    retry: 1,
  });

  if (!taskImageUrl) return null;

  const resolvedUrl = isExternal ? taskImageUrl : (imageQuery.data ?? null);

  if (imageQuery.isLoading) {
    return <Skeleton className="mt-2 h-24 w-40 rounded-md" />;
  }

  if (!resolvedUrl) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Фото задачи недоступно
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative mt-2 inline-block rounded-md border bg-background p-1 hover:opacity-90 transition-opacity"
        title="Открыть фото задачи"
      >
        <img
          src={resolvedUrl}
          alt="Фото задачи"
          className="h-24 w-auto max-w-[220px] rounded-sm object-cover"
          loading="lazy"
        />
        <span className="absolute right-1 top-1 inline-flex items-center gap-1 rounded-md bg-background/90 px-1.5 py-0.5 text-[10px] opacity-0 transition-opacity group-hover:opacity-100">
          <ZoomIn className="h-3 w-3" />
          Увеличить
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl p-4">
          <DialogHeader>
            <DialogTitle>Фото задачи</DialogTitle>
            <DialogDescription>Изображение условия задачи</DialogDescription>
          </DialogHeader>
          <img
            src={resolvedUrl}
            alt="Фото задачи"
            className="max-h-[75vh] w-full rounded-md object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Materials Section ───────────────────────────────────────────────────────

function MaterialsList({ assignmentId, materials }: { assignmentId: string; materials: HomeworkMaterial[] }) {
  if (materials.length === 0) return null;

  const handleOpen = async (material: HomeworkMaterial) => {
    if (material.type === 'link' && material.url) {
      window.open(material.url, '_blank', 'noreferrer');
      return;
    }
    try {
      const url = await getMaterialSignedUrl(assignmentId, material.id);
      if (url) window.open(url, '_blank', 'noreferrer');
    } catch {
      alert('Не удалось открыть материал');
    }
  };

  return (
    <Card animate={false}>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Paperclip className="h-4 w-4" />
          Материалы ({materials.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {materials.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-2 p-2 rounded-lg border bg-muted/20">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{m.title}</p>
              <p className="text-xs text-muted-foreground">{m.type.toUpperCase()}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => void handleOpen(m)}>
              <ExternalLink className="h-3.5 w-3.5 mr-1" />
              Открыть
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ─── Students List ───────────────────────────────────────────────────────────

// ─── Student Image ──────────────────────────────────────────────────────────

function StudentImage({ imageRef }: { imageRef: string }) {
  const imageQuery = useQuery<string | null>({
    queryKey: ['tutor', 'homework', 'student-image', imageRef],
    queryFn: () => getHomeworkImageSignedUrl(imageRef, { defaultBucket: 'homework-images' }),
    staleTime: TUTOR_STALE_TIME_MS,
    gcTime: TUTOR_GC_TIME_MS,
    retry: 1,
  });

  if (imageQuery.isLoading) return <Skeleton className="h-20 w-20 rounded-md" />;
  if (!imageQuery.data) return <div className="h-20 w-20 rounded-md bg-muted flex items-center justify-center"><ImageIcon className="h-5 w-5 text-muted-foreground" /></div>;

  return (
    <a href={imageQuery.data} target="_blank" rel="noreferrer" className="inline-block rounded-md border bg-background p-0.5 hover:opacity-90 transition-opacity">
      <img src={imageQuery.data} alt="Ответ ученика" className="h-20 w-auto max-w-[140px] rounded-sm object-cover" loading="lazy" />
    </a>
  );
}

// ─── Submission Detail Row ──────────────────────────────────────────────────

function SubmissionItemRow({ item }: { item: TutorHomeworkSubmissionItem }) {
  const isCorrect = item.tutor_override_correct ?? item.ai_is_correct;
  const score = item.ai_score;

  return (
    <div className="p-3 rounded-lg bg-muted/20 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Задача {item.task_order_num}</span>
        <div className="flex items-center gap-2">
          {isCorrect != null && (
            <Badge variant="outline" className={isCorrect
              ? 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400'
            }>
              {isCorrect ? '✓ Верно' : '✗ Неверно'}
            </Badge>
          )}
          {score != null && (
            <span className="text-xs text-muted-foreground">{score}/{item.max_score}</span>
          )}
          {item.ai_confidence != null && (
            <span className="text-xs text-muted-foreground">({Math.round(item.ai_confidence * 100)}%)</span>
          )}
        </div>
      </div>

      {/* Student images */}
      {item.student_image_urls && item.student_image_urls.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {item.student_image_urls.map((url, i) => (
            <StudentImage key={i} imageRef={url} />
          ))}
        </div>
      )}

      {/* Student text */}
      {item.student_text && (
        <MathText text={item.student_text} className="text-sm bg-background rounded p-2 border whitespace-pre-wrap break-words" />
      )}

      {/* AI feedback */}
      {item.ai_feedback && (
        <MathText text={item.ai_feedback} className="text-xs text-muted-foreground italic whitespace-pre-wrap leading-relaxed" />
      )}

      {/* Error type */}
      {item.ai_error_type && item.ai_error_type !== 'correct' && (
        <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 text-xs">
          {item.ai_error_type}
        </Badge>
      )}
    </div>
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
  const [expandedStudents, setExpandedStudents] = useState<Set<string>>(new Set());
  const { assigned_students } = details;
  const isGuidedChat = details.assignment.workflow_mode === 'guided_chat';

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

  const toggleExpand = (studentId: string) => {
    setExpandedStudents(prev => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  return (
    <Card animate={false}>
      <CardHeader>
        <CardTitle className="text-lg">Ученики</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="divide-y">
          {assigned_students.map((student) => {
            const sub = submissionMap.get(student.student_id);
            const isExpanded = expandedStudents.has(student.student_id);
            const hasItems = sub && sub.submission_items && sub.submission_items.length > 0;

            return (
              <div key={student.student_id} className="py-3">
                <div
                  className={`flex items-center justify-between gap-2 ${hasItems || isGuidedChat ? 'cursor-pointer hover:bg-muted/30 -mx-2 px-2 py-1 rounded-md transition-colors' : ''}`}
                  onClick={hasItems || isGuidedChat ? () => toggleExpand(student.student_id) : undefined}
                >
                  <div className="min-w-0 flex items-center gap-2">
                    {(hasItems || isGuidedChat) && (
                      isExpanded
                        ? <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    )}
                    <div>
                      <p className="font-medium text-sm truncate">{student.name || 'Без имени'}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {student.notified ? (
                          <span className="text-xs text-green-600 flex items-center gap-0.5">
                            <CheckCircle2 className="h-3 w-3" /> Уведомлён
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                            <AlertCircle className="h-3 w-3" /> Не уведомлён
                          </span>
                        )}
                        <DeliveryBadge status={student.delivery_status} />
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {isGuidedChat ? (
                      <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400">
                        Пошаговое ДЗ
                      </Badge>
                    ) : sub ? (
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

                {/* Guided chat thread viewer */}
                {isGuidedChat && isExpanded && (
                  <div className="mt-3">
                    <GuidedThreadViewer
                      assignmentId={details.assignment.id}
                      studentId={student.student_id}
                    />
                  </div>
                )}

                {/* Expanded submission details (classic mode) */}
                {!isGuidedChat && isExpanded && hasItems && (
                  <div className="mt-3 ml-6 space-y-2">
                    {sub.submission_items.map((item) => (
                      <SubmissionItemRow key={item.task_id} item={item} />
                    ))}
                  </div>
                )}
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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

  // ─── Delete dialog ──────────────────────────────────────────────────────────
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = useCallback(async () => {
    if (!id) return;
    setIsDeleting(true);
    try {
      await deleteTutorHomeworkAssignment(id);
      toast.success('ДЗ удалено');
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'homework'] });
      navigate('/tutor/homework');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось удалить ДЗ');
    } finally {
      setIsDeleting(false);
    }
  }, [id, navigate, queryClient]);

  // ─── Edit dialog ────────────────────────────────────────────────────────────
  const [editOpen, setEditOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [editTopic, setEditTopic] = useState('');
  const [editDeadline, setEditDeadline] = useState('');

  const openEditDialog = useCallback(() => {
    if (!details) return;
    setEditTitle(details.assignment.title);
    setEditSubject(details.assignment.subject);
    setEditTopic(details.assignment.topic ?? '');
    setEditDeadline(details.assignment.deadline ? toLocalDatetimeString(details.assignment.deadline) : '');
    setEditOpen(true);
  }, [details]);

  const handleSaveEdit = useCallback(async () => {
    if (!id || !editTitle.trim()) return;
    setIsSaving(true);
    try {
      await updateTutorHomeworkAssignment(id, {
        title: editTitle.trim(),
        subject: editSubject,
        topic: editTopic.trim() || null,
        deadline: editDeadline ? new Date(editDeadline).toISOString() : null,
      });
      toast.success('Сохранено');
      setEditOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'homework', 'detail', id] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось сохранить');
    } finally {
      setIsSaving(false);
    }
  }, [id, editTitle, editSubject, editTopic, editDeadline, queryClient]);

  return (
    <TutorLayout>
      <div className="space-y-6">
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
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/tutor/homework')}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <h1 className="text-2xl font-bold flex-1 truncate">{details.assignment.title}</h1>
              <Badge variant="outline" className={STATUS_CONFIG[details.assignment.status as HomeworkAssignmentStatus]?.className}>
                {STATUS_CONFIG[details.assignment.status as HomeworkAssignmentStatus]?.label ?? details.assignment.status}
              </Badge>
              <Button variant="outline" onClick={openEditDialog}>
                <Edit className="h-4 w-4 mr-2" />
                Редактировать
              </Button>
              <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="h-4 w-4 mr-2" />
                Удалить ДЗ
              </Button>
            </div>

            {/* Sub-header info */}
            <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
              <span>{getSubjectLabel(details.assignment.subject)}</span>
              {details.assignment.topic && <span>· {details.assignment.topic}</span>}
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                Дедлайн: {formatDate(details.assignment.deadline)}
              </span>
            </div>
            {details.assignment.description && (
              <p className="text-sm text-muted-foreground">{details.assignment.description}</p>
            )}

            {/* Stats */}
            <StatsCards details={details} results={results} />

            {/* Tasks */}
            <TasksList details={details} />

            {/* Materials */}
            {details.materials && details.materials.length > 0 && (
              <MaterialsList assignmentId={details.assignment.id as string} materials={details.materials} />
            )}

            {/* Students */}
            <StudentsList details={details} results={results} />
          </>
        ) : null}
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Удалить домашнее задание?</DialogTitle>
            <DialogDescription>
              ДЗ «{details?.assignment.title}» будет удалено вместе со всеми задачами, ответами учеников и материалами. Это действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDeleteOpen(false)}
              disabled={isDeleting}
            >
              Отмена
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={isDeleting}
            >
              {isDeleting ? 'Удаление...' : 'Удалить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Редактировать ДЗ</DialogTitle>
            <DialogDescription>
              Измените основные параметры задания.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-title">Название</Label>
              <Input
                id="edit-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="text-base"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-subject">Предмет</Label>
              <Select value={editSubject} onValueChange={setEditSubject}>
                <SelectTrigger id="edit-subject">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOMEWORK_SUBJECTS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-topic">Тема</Label>
              <Input
                id="edit-topic"
                value={editTopic}
                onChange={(e) => setEditTopic(e.target.value)}
                placeholder="Необязательно"
                className="text-base"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-deadline">Дедлайн</Label>
              <Input
                id="edit-deadline"
                type="datetime-local"
                value={editDeadline}
                onChange={(e) => setEditDeadline(e.target.value)}
                className="text-base"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditOpen(false)}
              disabled={isSaving}
            >
              Отмена
            </Button>
            <Button
              type="button"
              onClick={() => void handleSaveEdit()}
              disabled={isSaving || !editTitle.trim()}
            >
              {isSaving ? 'Сохранение...' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
