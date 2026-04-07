import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronUp, WifiOff, Paperclip, ExternalLink, Edit, Trash2, ZoomIn, Bell, Send, Mail, Lightbulb } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import TutorGuard from '@/components/TutorGuard';
import { TutorLayout } from '@/components/tutor/TutorLayout';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
import { GuidedThreadViewer } from '@/components/tutor/GuidedThreadViewer';
import { ResultsHeader } from '@/components/tutor/results/ResultsHeader';
import { ResultsActionBlock } from '@/components/tutor/results/ResultsActionBlock';
import {
  getTutorHomeworkAssignment,
  getTaskImageSignedUrl,
  getMaterialSignedUrl,
  getTutorHomeworkResults,
  deleteTutorHomeworkAssignment,
  type TutorHomeworkAssignmentDetails,
  type TutorHomeworkResultsResponse,
  type HomeworkAssignmentStatus,
  type DeliveryStatus,
  type HomeworkMaterial,
} from '@/lib/tutorHomeworkApi';
import { hintOveruseThreshold } from '@/lib/homeworkResultsConstants';
import { trackGuidedHomeworkEvent } from '@/lib/homeworkTelemetry';
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

function DeliveryBadge({ status }: { status: DeliveryStatus | undefined }) {
  if (!status || status === 'pending') return null;

  if (status === 'delivered_push') {
    return (
      <span className="text-xs text-green-600 flex items-center gap-0.5">
        <Bell className="h-3 w-3" /> Push
      </span>
    );
  }
  if (status === 'delivered_telegram') {
    return (
      <span className="text-xs text-green-600 flex items-center gap-0.5">
        <Send className="h-3 w-3" /> Telegram
      </span>
    );
  }
  if (status === 'delivered_email') {
    return (
      <span className="text-xs text-green-600 flex items-center gap-0.5">
        <Mail className="h-3 w-3" /> Email
      </span>
    );
  }
  if (status === 'delivered') {
    return (
      <span className="text-xs text-green-600 flex items-center gap-0.5">
        <CheckCircle2 className="h-3 w-3" /> Доставлено
      </span>
    );
  }
  if (status === 'failed_no_channel') {
    return (
      <span className="text-xs text-red-500 flex items-center gap-0.5" title="Попросите ученика включить уведомления или добавить email">
        <XCircle className="h-3 w-3" /> Нет каналов
      </span>
    );
  }
  if (status === 'failed_all_channels') {
    return (
      <span className="text-xs text-red-500 flex items-center gap-0.5" title="Попытки push, Telegram и email не удались">
        <XCircle className="h-3 w-3" /> Все каналы failed
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

// ─── Detail actions (rightSlot for ResultsHeader) ───────────────────────────

function DetailActions({
  status,
  assignmentId,
  onDelete,
}: {
  status: HomeworkAssignmentStatus;
  assignmentId: string;
  onDelete: () => void;
}) {
  const cfg = STATUS_CONFIG[status];
  return (
    <>
      <Badge variant="outline" className={cfg?.className}>
        {cfg?.label ?? status}
      </Badge>
      <Button variant="outline" size="sm" asChild>
        <Link to={`/tutor/homework/${assignmentId}/edit`}>
          <Edit className="h-4 w-4 md:mr-2" />
          <span className="hidden md:inline">Редактировать</span>
        </Link>
      </Button>
      <Button variant="destructive" size="sm" onClick={onDelete}>
        <Trash2 className="h-4 w-4 md:mr-2" />
        <span className="hidden md:inline">Удалить ДЗ</span>
      </Button>
    </>
  );
}

// ─── Tasks List ──────────────────────────────────────────────────────────────

function TasksList({ details }: { details: TutorHomeworkAssignmentDetails }) {
  const [open, setOpen] = useState(false);
  if (details.tasks.length === 0) return null;

  return (
    <Card animate={false}>
      <CardHeader className="pb-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 text-left"
          aria-expanded={open}
        >
          <CardTitle className="text-lg">
            Задачи <span className="text-muted-foreground font-normal">({details.tasks.length})</span>
          </CardTitle>
          <ChevronDown
            className={`h-5 w-5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </CardHeader>
      {open && (
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
      )}
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

function StudentsList({
  details,
  hintTotalByStudent,
}: {
  details: TutorHomeworkAssignmentDetails;
  hintTotalByStudent: Map<string, number>;
}) {
  const [expandedStudents, setExpandedStudents] = useState<Set<string>>(new Set());
  const { assigned_students } = details;
  const taskCount = details.tasks.length;
  const threshold = taskCount > 0 ? hintOveruseThreshold(taskCount) : Infinity;

  if (assigned_students.length === 0) {
    return (
      <Card animate={false} className="bg-muted/30">
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Ученики ещё не назначены</p>
        </CardContent>
      </Card>
    );
  }

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
            const isExpanded = expandedStudents.has(student.student_id);
            const hintTotal = hintTotalByStudent.get(student.student_id) ?? 0;
            const showHintOveruse = hintTotal >= threshold;

            return (
              <div key={student.student_id} className="py-3">
                <div
                  className="flex items-center justify-between gap-2 cursor-pointer hover:bg-muted/30 -mx-2 px-2 py-1 rounded-md transition-colors"
                  onClick={() => toggleExpand(student.student_id)}
                >
                  <div className="min-w-0 flex items-center gap-2">
                    {isExpanded
                      ? <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    }
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
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {showHintOveruse && (
                      <span
                        title={`Подсказок: ${hintTotal}`}
                        className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-xs font-medium"
                      >
                        <Lightbulb className="h-3 w-3" />
                        Много подсказок
                      </span>
                    )}
                    <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400">
                      Пошаговое ДЗ
                    </Badge>
                  </div>
                </div>

                {/* Guided chat thread viewer */}
                {isExpanded && (
                  <div className="mt-3">
                    <GuidedThreadViewer
                      assignmentId={details.assignment.id}
                      studentId={student.student_id}
                    />
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

  // Per-student lookup for hint totals — drives the "Много подсказок" chip.
  const hintTotalByStudent = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of results?.per_student ?? []) {
      map.set(s.student_id, s.hint_total);
    }
    return map;
  }, [results]);

  // AC-10 telemetry: fire results_v2_opened exactly once per assignment id.
  // Payload contains only counts + id — no PII. `per_student` can transiently
  // be undefined while results are still hydrating, so guard defensively.
  const trackedAssignmentRef = useRef<string | null>(null);
  useEffect(() => {
    if (!id || !details || !results) return;
    if (trackedAssignmentRef.current === id) return;
    trackedAssignmentRef.current = id;
    const perStudent = results.per_student ?? [];
    trackGuidedHomeworkEvent('results_v2_opened', {
      assignmentId: id,
      submittedCount: perStudent.filter((s) => s.submitted).length,
      totalCount: details.assigned_students.length,
    });
  }, [id, details, results]);

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

  // Edit now handled by /tutor/homework/:id/edit route

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

        {/* Header (v2) — metrics + actions. Always rendered so it shows
            skeleton state while loading. */}
        <ResultsHeader
          assignment={details?.assignment ?? null}
          totalStudents={details?.assigned_students.length ?? 0}
          results={results ?? null}
          isLoading={isLoading && !details}
          rightSlot={
            details?.assignment ? (
              <DetailActions
                status={details.assignment.status as HomeworkAssignmentStatus}
                assignmentId={details.assignment.id}
                onDelete={() => setDeleteOpen(true)}
              />
            ) : null
          }
        />

        {isLoading && !details ? (
          <DetailSkeleton />
        ) : details ? (
          <>
            {/* Optional description (stays below header on its own) */}
            {details.assignment.description && (
              <p className="text-sm text-muted-foreground">{details.assignment.description}</p>
            )}

            {/* Action block: per-student "Требует внимания" (не приступал). */}
            {results ? (
              <ResultsActionBlock
                assignmentId={details.assignment.id}
                assignmentTitle={details.assignment.title}
                assignedStudents={details.assigned_students}
                perStudent={results.per_student}
              />
            ) : null}

            {/* Tasks (collapsible, closed by default) */}
            <TasksList details={details} />

            {/* Materials */}
            {details.materials && details.materials.length > 0 && (
              <MaterialsList assignmentId={details.assignment.id as string} materials={details.materials} />
            )}

            {/* Students with thread viewer + hint-overuse chip */}
            <StudentsList details={details} hintTotalByStudent={hintTotalByStudent} />
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

      {/* Edit dialog removed — now handled by /tutor/homework/:id/edit route */}
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
