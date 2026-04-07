import { useState, useCallback, useEffect, useId, useMemo, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Paperclip, ExternalLink, Edit, Trash2, ZoomIn } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import TutorGuard from '@/components/TutorGuard';
import { TutorLayout } from '@/components/tutor/TutorLayout';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
import { ResultsHeader } from '@/components/tutor/results/ResultsHeader';
import { ResultsActionBlock } from '@/components/tutor/results/ResultsActionBlock';
import { HeatmapGrid } from '@/components/tutor/results/HeatmapGrid';
import { StudentDrillDown } from '@/components/tutor/results/StudentDrillDown';
import {
  getTutorHomeworkAssignment,
  getTaskImageSignedUrl,
  getMaterialSignedUrl,
  getTutorHomeworkResults,
  deleteTutorHomeworkAssignment,
  type TutorHomeworkAssignmentDetails,
  type TutorHomeworkResultsResponse,
  type HomeworkAssignmentStatus,
  type HomeworkMaterial,
} from '@/lib/tutorHomeworkApi';
import { HOMEWORK_STATUS_CONFIG } from '@/lib/homeworkStatus';
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

// Status badge palette is shared with TutorHomework (list page) via
// `HOMEWORK_STATUS_CONFIG` so any change happens in exactly one file.

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
  const cfg = HOMEWORK_STATUS_CONFIG[status];
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
  // Stable per-instance id so the disclosure button references its own
  // panel via `aria-controls`. WAI-ARIA Authoring Practices — Disclosure
  // pattern.
  const panelId = useId();
  if (details.tasks.length === 0) return null;

  return (
    <Card animate={false}>
      <CardHeader className="pb-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 text-left min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:rounded-sm"
          aria-expanded={open}
          aria-controls={panelId}
        >
          <CardTitle className="text-lg">
            Задачи{' '}
            <span className="text-muted-foreground font-normal tabular-nums">
              ({details.tasks.length})
            </span>
          </CardTitle>
          <ChevronDown
            className={`h-5 w-5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
      </CardHeader>
      {open && (
      <CardContent id={panelId} className="space-y-3">
        {details.tasks.map((task, idx) => (
          <div key={task.id} className="flex gap-3 p-3 rounded-lg bg-muted/30">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold tabular-nums">
              {idx + 1}
            </div>
            <div className="flex-1 min-w-0">
              <MathText text={task.task_text} className="text-sm leading-relaxed whitespace-pre-wrap break-words" />
              <TaskImagePreview assignmentId={details.assignment.id} taskId={task.id} taskImageUrl={task.task_image_url} />
              <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground tabular-nums">
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
        className="group relative mt-2 inline-block rounded-md border bg-background p-1 hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        title="Открыть фото задачи"
        aria-label="Открыть фото задачи во весь экран"
      >
        <img
          src={resolvedUrl}
          alt="Фото задачи"
          className="h-24 w-auto max-w-[220px] rounded-sm object-cover"
          loading="lazy"
        />
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 inline-flex items-center gap-1 rounded-md bg-background/90 px-1.5 py-0.5 text-[10px] opacity-0 transition-opacity group-hover:opacity-100"
        >
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
      if (url) {
        window.open(url, '_blank', 'noreferrer');
      } else {
        toast.error('Не удалось открыть материал');
      }
    } catch {
      toast.error('Не удалось открыть материал');
    }
  };

  return (
    <Card animate={false}>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Paperclip className="h-4 w-4" aria-hidden="true" />
          Материалы{' '}
          <span className="text-muted-foreground font-normal tabular-nums">
            ({materials.length})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {materials.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-2 p-2 rounded-lg border bg-muted/20">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{m.title}</p>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mt-0.5">
                {m.type}
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => void handleOpen(m)}>
              <ExternalLink className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
              Открыть
            </Button>
          </div>
        ))}
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

  // Currently-expanded student in HeatmapGrid. When set, a separate
  // "Разбор ученика" section renders below the grid with StudentDrillDown.
  // Only one student can be expanded at a time (AC-3).
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);
  // TASK-6 (AC-4): task id selected from a HeatmapGrid cell click. Gets passed
  // to StudentDrillDown as `initialTaskId` — child syncs its local state when
  // this changes, so a cell click on an already-expanded student just moves
  // the viewer filter. `null` = "Все задачи".
  const [drillDownTaskId, setDrillDownTaskId] = useState<string | null>(null);

  // Reset expanded state whenever we navigate to a different assignment so
  // stale selections don't leak across pages.
  useEffect(() => {
    setExpandedStudentId(null);
    setDrillDownTaskId(null);
  }, [id]);

  const handleToggleExpand = useCallback((studentId: string) => {
    setExpandedStudentId((prev) => {
      if (prev === studentId) {
        // Collapse — reset task selection too.
        setDrillDownTaskId(null);
        return null;
      }
      // Expand a different student — start on "Все задачи".
      setDrillDownTaskId(null);
      return studentId;
    });
  }, []);

  const handleCellClick = useCallback((studentId: string, taskId: string) => {
    // Expand (or re-focus) the student and select the clicked task. The child
    // drill-down's useEffect on `initialTaskId` picks up the new selection
    // whether or not the student was already expanded.
    setExpandedStudentId(studentId);
    setDrillDownTaskId(taskId);
  }, []);

  // Memoised so unrelated state changes (delete dialog open, refetch races,
  // sibling re-renders) don't re-run two `find` walks over `assigned_students`
  // and `per_student` on every render.
  const expandedStudent = useMemo(
    () =>
      expandedStudentId && details
        ? details.assigned_students.find((s) => s.student_id === expandedStudentId) ?? null
        : null,
    [expandedStudentId, details],
  );
  const expandedPerStudent = useMemo(
    () =>
      expandedStudentId && results
        ? results.per_student?.find((s) => s.student_id === expandedStudentId) ?? null
        : null,
    [expandedStudentId, results],
  );

  // TASK-6 telemetry: fire `drill_down_expanded` once per expand action (by
  // assignmentId|studentId pair). `firstProblemTaskOrder` cascade:
  //   1. first task (by order_num) with ratio < 0.3 OR hint_count >= 1
  //   2. else first task with ratio < 0.8
  //   3. else null
  // Not-attempted tasks (absent from task_scores) are ignored. This keeps
  // the metric aligned with the needs_attention logic and the cell colors.
  const lastDrillTrackedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!expandedStudentId || !id || !details || !expandedPerStudent) {
      lastDrillTrackedRef.current = null;
      return;
    }
    const key = `${id}|${expandedStudentId}`;
    if (lastDrillTrackedRef.current === key) return;
    lastDrillTrackedRef.current = key;

    const taskMaxById = new Map<string, { order_num: number; max_score: number }>();
    for (const t of details.tasks) {
      taskMaxById.set(t.id, { order_num: t.order_num, max_score: t.max_score });
    }
    const scored = (expandedPerStudent.task_scores ?? [])
      .map((ts) => {
        const meta = taskMaxById.get(ts.task_id);
        if (!meta) return null;
        const ratio = meta.max_score > 0 ? ts.final_score / meta.max_score : 0;
        return {
          order_num: meta.order_num,
          ratio,
          hint_count: ts.hint_count,
        };
      })
      .filter((x): x is { order_num: number; ratio: number; hint_count: number } => x !== null)
      .sort((a, b) => a.order_num - b.order_num);

    const firstRedOrHint = scored.find((t) => t.ratio < 0.3 || t.hint_count >= 1);
    const firstAmber = scored.find((t) => t.ratio < 0.8);
    const firstProblemTaskOrder = firstRedOrHint
      ? firstRedOrHint.order_num
      : firstAmber
        ? firstAmber.order_num
        : null;

    trackGuidedHomeworkEvent('drill_down_expanded', {
      assignmentId: id,
      studentId: expandedStudentId,
      firstProblemTaskOrder,
    });
  }, [expandedStudentId, id, details, expandedPerStudent]);

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

            {/* Tasks (collapsible, closed by default). Placed between the
                action block and the heatmap so tutors can review conditions
                before looking at per-student scores. */}
            <TasksList details={details} />

            {/* Heatmap grid (TASK-5, AC-2). Replaces the previous StudentsList —
                each row is now a student with a colored task-score matrix.
                Clicking a row toggles the "Разбор ученика" section below.
                TASK-6: cell click expands the student and pre-selects that
                task inside the drill-down. */}
            {results ? (
              <HeatmapGrid
                details={details}
                results={results}
                expandedStudentId={expandedStudentId}
                onToggleExpand={handleToggleExpand}
                onCellClick={handleCellClick}
                selectedTaskId={drillDownTaskId}
              />
            ) : null}

            {/* Materials */}
            {details.materials && details.materials.length > 0 && (
              <MaterialsList assignmentId={details.assignment.id as string} materials={details.materials} />
            )}

            {/* Per-student drill-down. Only one student is ever expanded so
                this section renders once below the grid. TaskMiniCard row +
                GuidedThreadViewer filtered by the selected task (TASK-6). */}
            {expandedStudent ? (
              <Card animate={false}>
                <CardHeader>
                  <CardTitle className="text-lg">
                    Разбор ученика: {expandedStudent.name || 'Без имени'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <StudentDrillDown
                    assignmentId={details.assignment.id}
                    studentId={expandedStudent.student_id}
                    tasks={details.tasks}
                    perStudent={expandedPerStudent}
                    initialTaskId={drillDownTaskId}
                  />
                </CardContent>
              </Card>
            ) : null}
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
