import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Loader2, MessageSquare, Pencil } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { GuidedThreadViewer } from '@/components/tutor/GuidedThreadViewer';
import { TaskMiniCard } from './TaskMiniCard';
import { EditScoreDialog } from './EditScoreDialog';
import {
  bulkForceCompleteStudentTasks,
  setStudentOverallComment,
  type TutorHomeworkAssignmentDetails,
  type TutorHomeworkResultsPerStudent,
} from '@/lib/tutorHomeworkApi';
import { reviewAllAi } from '@/lib/tutorProgressApi';
import { isTaskScoreReviewed } from '@/lib/homeworkReview';
import { invalidateAfterReview } from '@/lib/tutorReviewCacheSync';
import { trackGuidedHomeworkEvent } from '@/lib/homeworkTelemetry';
import { useAutoResizeTextarea } from '@/hooks/useAutoResizeTextarea';

const OVERALL_COMMENT_MAX = 2000;

// ─── OverallCommentCard (Phase 12, 2026-06-07) ───────────────────────────────
// Общий комментарий репетитора ко ВСЕМУ ДЗ для одного ученика (per-student
// wrap-up). Read / edit / save inline. Backend уведомляет ученика push→telegram
// при непустом ИЗМЕНЁННОМ тексте; пустая строка → очистка комментария.
function OverallCommentCard({
  assignmentId,
  studentId,
  comment,
  commentAt,
}: {
  assignmentId: string;
  studentId: string;
  comment: string | null;
  commentAt: string | null;
}) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState(comment ?? '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useAutoResizeTextarea(textareaRef, text, 260);

  // Подхватываем внешние изменения комментария, пока репетитор не редактирует.
  useEffect(() => {
    if (!isEditing) setText(comment ?? '');
  }, [comment, isEditing]);

  const saveMutation = useMutation({
    mutationFn: (value: string | null) =>
      setStudentOverallComment({ assignmentId, studentId, comment: value }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tutor', 'homework', 'results', assignmentId] });
      queryClient.invalidateQueries({ queryKey: ['tutor', 'homework', 'detail', assignmentId] });
      const notified = Boolean(data.notify?.sent_push || data.notify?.sent_telegram);
      trackGuidedHomeworkEvent('homework_overall_comment_saved', {
        assignmentId,
        studentId,
        cleared: data.tutor_overall_comment == null,
        notified,
      });
      setIsEditing(false);
      if (data.tutor_overall_comment == null) {
        toast.success('Комментарий удалён');
      } else if (notified) {
        toast.success('Комментарий сохранён, ученик уведомлён');
      } else {
        toast.success('Комментарий сохранён (у ученика нет каналов уведомления)');
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Не удалось сохранить комментарий');
    },
  });

  const handleSave = () => {
    const trimmed = text.trim();
    if (trimmed.length > OVERALL_COMMENT_MAX) return;
    saveMutation.mutate(trimmed.length === 0 ? null : trimmed);
  };

  const formattedAt = (() => {
    if (!commentAt) return null;
    try {
      return format(parseISO(commentAt), 'dd.MM.yyyy, HH:mm');
    } catch {
      return null;
    }
  })();

  // ── Edit mode ───────────────────────────────────────────────────────────────
  if (isEditing) {
    const overLimit = text.trim().length > OVERALL_COMMENT_MAX;
    return (
      <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
        <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700">
          <MessageSquare className="h-4 w-4 text-accent" aria-hidden="true" />
          Общий комментарий ученику
        </div>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="Напр.: Вася, ты молодец! Но было две ошибки на закон Ома — повтори его."
          className="w-full resize-none rounded-md border border-slate-200 bg-white p-2 text-base text-slate-800 placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="text-xs text-slate-500">Ученик увидит комментарий и получит уведомление.</p>
          <span
            className={`shrink-0 text-xs tabular-nums ${overLimit ? 'text-red-500' : 'text-slate-400'}`}
          >
            {text.trim().length}/{OVERALL_COMMENT_MAX}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending || overLimit}>
            {saveMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Сохранить
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setText(comment ?? '');
              setIsEditing(false);
            }}
            disabled={saveMutation.isPending}
          >
            Отмена
          </Button>
        </div>
      </div>
    );
  }

  // ── Read mode (комментарий есть) ─────────────────────────────────────────────
  if (comment) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
            <MessageSquare className="h-4 w-4 text-accent" aria-hidden="true" />
            Общий комментарий ученику
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsEditing(true)}
            className="h-7 px-2 text-slate-500"
          >
            <Pencil className="mr-1 h-3.5 w-3.5" />
            Изменить
          </Button>
        </div>
        <p className="whitespace-pre-wrap text-sm text-slate-700">{comment}</p>
        {formattedAt ? <p className="mt-1 text-xs text-slate-400">Изменён: {formattedAt}</p> : null}
      </div>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────────────
  return (
    <button
      type="button"
      onClick={() => setIsEditing(true)}
      className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 transition-colors hover:border-accent/40 hover:text-slate-700"
    >
      <MessageSquare className="h-4 w-4 text-slate-400" aria-hidden="true" />
      Добавить общий комментарий ученику
    </button>
  );
}

// ─── StudentDrillDown (TASK-6, AC-3 / AC-4) ──────────────────────────────────
// Horizontal row of TaskMiniCard + GuidedThreadViewer filtered by the selected
// task. The parent (TutorHomeworkDetail) renders this inside the existing
// "Разбор ученика" Card under Materials — no cards-in-cards.
//
// Viewer remounts via `key={selectedTaskId ?? 'all'}` when selection changes,
// so scroll / realtime channel / internal task selector reset cleanly.

interface StudentDrillDownProps {
  assignmentId: string;
  studentId: string;
  /**
   * Resolved student display name from the parent (TutorHomeworkDetail) —
   * comes from `details.assigned_students[*].name` which is already resolved
   * server-side via the canonical priority chain. Passing it down avoids
   * waiting on the viewer's own thread fetch and works even if the
   * homework-api edge function deploy lags behind the frontend bundle.
   */
  studentName?: string | null;
  /**
   * Phase 7 (2026-05-16) — homework subject from `homework_tutor_assignments.subject`.
   * Pass-through to GuidedThreadViewer → GuidedChatMessage для subject-aware
   * step labels («Часть письма» / «Письмо» / «Проверка письма» для humanities-
   * writing subjects вместо «Шаг решения» / «Решение к задаче» / «Проверка решения»).
   */
  subject?: string | null;
  tasks: TutorHomeworkAssignmentDetails['tasks'];
  perStudent: TutorHomeworkResultsPerStudent | null;
  /** Task selected from a HeatmapGrid cell click. `null` = show all tasks. */
  initialTaskId: string | null;
}

export function StudentDrillDown({
  assignmentId,
  studentId,
  studentName,
  subject,
  tasks,
  perStudent,
  initialTaskId,
}: StudentDrillDownProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  // Sync with the parent when a cell click changes `initialTaskId` while this
  // student is already expanded. Parent bumps `initialTaskId` → we follow.
  useEffect(() => {
    setSelectedTaskId(initialTaskId);
  }, [initialTaskId]);

  // taskId → { order_num, score, hint_count, max_score, ai_*, override_*, force_*, status }
  // lookup so mini-cards (and EditScoreDialog when opened) get all the data
  // without an extra round-trip. perStudent.task_scores is the single source.
  const taskMeta = useMemo(() => {
    const scoresById = new Map<
      string,
      {
        final_score: number;
        hint_count: number;
        has_override: boolean;
        ai_score: number | null;
        ai_score_comment: string | null;
        tutor_score_override: number | null;
        tutor_score_override_comment: string | null;
        tutor_force_completed_at: string | null;
        tutor_reviewed_at: string | null;
        status: string;
      }
    >();
    for (const ts of perStudent?.task_scores ?? []) {
      scoresById.set(ts.task_id, {
        final_score: ts.final_score,
        hint_count: ts.hint_count,
        has_override: ts.has_override ?? false,
        ai_score: ts.ai_score ?? null,
        ai_score_comment: ts.ai_score_comment ?? null,
        tutor_score_override: ts.tutor_score_override ?? null,
        tutor_score_override_comment: ts.tutor_score_override_comment ?? null,
        tutor_force_completed_at: ts.tutor_force_completed_at ?? null,
        tutor_reviewed_at: ts.tutor_reviewed_at ?? null,
        status: ts.status ?? 'active',
      });
    }
    return tasks.map((task) => {
      const cell = scoresById.get(task.id);
      return {
        id: task.id,
        order_num: task.order_num,
        max_score: task.max_score,
        score: cell ? cell.final_score : null,
        hint_count: cell ? cell.hint_count : 0,
        has_override: cell?.has_override ?? false,
        ai_score: cell?.ai_score ?? null,
        ai_score_comment: cell?.ai_score_comment ?? null,
        tutor_score_override: cell?.tutor_score_override ?? null,
        tutor_score_override_comment: cell?.tutor_score_override_comment ?? null,
        tutor_force_completed_at: cell?.tutor_force_completed_at ?? null,
        tutor_reviewed_at: cell?.tutor_reviewed_at ?? null,
        // Если cell отсутствует — это provisionGuidedThread-stub: status='active'.
        // Если cell есть — берём его status (может быть 'completed' или 'active').
        status: cell?.status ?? 'active',
      };
    });
  }, [tasks, perStudent]);

  // Кол-во ещё незакрытых задач — для bulk CTA + AlertDialog копии.
  // P2 fix (code review round 2, 2026-05-16): RPC `hw_tutor_force_complete_all_tasks`
  // фильтрует строго `status = 'active'`. Counter раньше использовал
  // `!== 'completed'` и включал бы locked/skipped — UI и backend mismatch.
  const activeTasksCount = useMemo(
    () => taskMeta.filter((t) => t.status === 'active').length,
    [taskMeta],
  );

  // R1 «проверено»: число задач, проверенных AI и ещё не подтверждённых.
  // СТРОГО совпадает с RPC `hw_tutor_review_all_ai` WHERE
  // (ai_score IS NOT NULL AND tutor_reviewed_at IS NULL) — mirror activeTasksCount инвариант.
  const reviewableCount = useMemo(
    () => taskMeta.filter((t) => t.ai_score != null && t.tutor_reviewed_at == null).length,
    [taskMeta],
  );

  // Selected task order_num for GuidedThreadViewer initial filter.
  const selectedTaskOrder = useMemo<number | 'all'>(() => {
    if (selectedTaskId === null) return 'all';
    const found = taskMeta.find((t) => t.id === selectedTaskId);
    return found ? found.order_num : 'all';
  }, [selectedTaskId, taskMeta]);

  const handleSelect = useCallback((taskId: string | null) => {
    setSelectedTaskId(taskId);
  }, []);

  const handleEdit = useCallback((taskId: string) => {
    setEditingTaskId(taskId);
  }, []);

  const editingTask = useMemo(
    () => (editingTaskId ? taskMeta.find((t) => t.id === editingTaskId) ?? null : null),
    [editingTaskId, taskMeta],
  );

  // ─── Bulk force-complete (2026-05-16, lexical-brewing-gadget) ────────────
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const queryClient = useQueryClient();
  const bulkMutation = useMutation({
    mutationFn: () => bulkForceCompleteStudentTasks({ assignmentId, studentId }),
    onSuccess: (data) => {
      trackGuidedHomeworkEvent('homework_bulk_force_completed', {
        assignmentId,
        studentId,
        closedCount: data.closed_count,
      });
      invalidateAfterReview(queryClient, { assignmentId, studentId });
      toast.success(
        data.closed_count > 0
          ? `Закрыто ${data.closed_count} ${data.closed_count === 1 ? 'задача' : 'задач'}`
          : 'Все задачи уже были закрыты',
      );
      setBulkConfirmOpen(false);
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Не удалось закрыть задачи';
      toast.error(message);
    },
  });

  // ─── Bulk review «Подтвердить всё, что AI проверил» (R1) ─────────────────
  const [bulkReviewConfirmOpen, setBulkReviewConfirmOpen] = useState(false);
  const bulkReviewMutation = useMutation({
    mutationFn: () => reviewAllAi({ assignmentId, studentId }),
    onSuccess: (data) => {
      trackGuidedHomeworkEvent('task_reviewed', {
        assignmentId,
        studentId,
        taskId: null,
        source: 'bulk',
        hadOverride: false,
        reviewedCount: data.reviewed_count,
      });
      invalidateAfterReview(queryClient, { assignmentId, studentId });
      toast.success(
        data.reviewed_count > 0
          ? `Подтверждено задач: ${data.reviewed_count}`
          : 'Нечего подтверждать',
      );
      setBulkReviewConfirmOpen(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Не удалось подтвердить задачи');
    },
  });

  return (
    <div className="space-y-4">
      {/* Phase 12: общий комментарий репетитора ко всему ДЗ для этого ученика —
          per-student wrap-up, первым элементом разбора. */}
      <OverallCommentCard
        assignmentId={assignmentId}
        studentId={studentId}
        comment={perStudent?.tutor_overall_comment ?? null}
        commentAt={perStudent?.tutor_overall_comment_at ?? null}
      />

      {/* Mini-cards row + bulk CTA на одном ряду (code review P2, 2026-05-16).
          `flex-1 min-w-0` на scroll-container'е и `shrink-0` на кнопке —
          mini-cards имеют свой horizontal scroll, button всегда виден.
          `touch-pan-x` keeps iOS Safari swipe working even though the buttons
          consume touchstart. */}
      <div className="flex items-center gap-3">
        <div className="flex gap-2 overflow-x-auto touch-pan-x pb-2 -mx-1 px-1 flex-1 min-w-0">
          <TaskMiniCard
            taskOrder={0}
            taskId={null}
            score={null}
            maxScore={0}
            hintCount={0}
            isSelected={selectedTaskId === null}
            isAllTasks
            onSelect={handleSelect}
          />
          {taskMeta.map((task) => (
            <TaskMiniCard
              key={task.id}
              taskOrder={task.order_num}
              taskId={task.id}
              score={task.score}
              maxScore={task.max_score}
              hintCount={task.hint_count}
              hasOverride={task.has_override}
              isReviewed={isTaskScoreReviewed(task)}
              isSelected={selectedTaskId === task.id}
              onSelect={handleSelect}
              onEdit={() => handleEdit(task.id)}
            />
          ))}
        </div>
        {/* Bulk-review CTA (R1, primary) — подтвердить всё, что AI проверил.
            Баллы не трогает (RPC review-all-ai). */}
        {reviewableCount > 0 ? (
          <Button
            size="sm"
            onClick={() => setBulkReviewConfirmOpen(true)}
            disabled={bulkReviewMutation.isPending}
            className="shrink-0 bg-emerald-600 text-white hover:bg-emerald-700"
          >
            <BadgeCheck className="mr-1 h-4 w-4" />
            Подтвердить всё, что AI проверил ({reviewableCount})
          </Button>
        ) : null}
        {/* Bulk force-complete CTA — рендерится только если есть незакрытые задачи.
            AlertDialog подтверждает действие. Балл не выставляется
            автоматически — тутор может править через Pencil → EditScoreDialog
            отдельно (план §6). */}
        {activeTasksCount > 0 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBulkConfirmOpen(true)}
            disabled={bulkMutation.isPending}
            className="shrink-0"
          >
            Закрыть оставшиеся ({activeTasksCount})
          </Button>
        ) : null}
      </div>


      <AlertDialog
        open={bulkConfirmOpen}
        onOpenChange={(open) => {
          if (!bulkMutation.isPending) setBulkConfirmOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Закрыть {activeTasksCount} {activeTasksCount === 1 ? 'задачу' : 'нерешённых задач'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Ученику будет показано «Закрыто репетитором» на этих задачах. Балл вы сможете
              выставить отдельно через кнопку «Изменить балл» на каждой задаче — bulk-закрытие
              баллы не трогает.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkMutation.isPending}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                bulkMutation.mutate();
              }}
            >
              {bulkMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Закрыть
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={bulkReviewConfirmOpen}
        onOpenChange={(open) => {
          if (!bulkReviewMutation.isPending) setBulkReviewConfirmOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Подтвердить {reviewableCount} {reviewableCount === 1 ? 'задачу' : 'задач'}, проверенных AI?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Ученику откроются баллы и пометка «проверено». AI-баллы остаются как есть —
              если с каким-то не согласны, поправьте его отдельно через «Изменить балл».
              Решение и AI-рубрика ученику не показываются.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkReviewMutation.isPending}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkReviewMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                bulkReviewMutation.mutate();
              }}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {bulkReviewMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Подтвердить ({reviewableCount})
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {editingTask ? (
        <EditScoreDialog
          open={editingTaskId !== null}
          onOpenChange={(open) => {
            if (!open) setEditingTaskId(null);
          }}
          assignmentId={assignmentId}
          studentId={studentId}
          task={{
            id: editingTask.id,
            order_num: editingTask.order_num,
            max_score: editingTask.max_score,
          }}
          aiScore={editingTask.ai_score}
          aiScoreComment={editingTask.ai_score_comment}
          finalScore={editingTask.score}
          currentOverride={editingTask.tutor_score_override}
          currentComment={editingTask.tutor_score_override_comment}
          status={editingTask.status as 'active' | 'completed' | 'locked' | 'skipped'}
          tutorForceCompletedAt={editingTask.tutor_force_completed_at}
          tutorReviewedAt={editingTask.tutor_reviewed_at}
        />
      ) : null}

      {/* Viewer remounts on selection change via `key`. This resets scroll,
          task context block (E8), and realtime channel subscription (E9) —
          cleanup runs in the effect return, no leaks. */}
      <div className="border-t border-slate-200 pt-4">
        <GuidedThreadViewer
          key={selectedTaskId ?? 'all'}
          assignmentId={assignmentId}
          studentId={studentId}
          studentNameOverride={studentName ?? null}
          subject={subject}
          enabled={true}
          initialTaskFilter={selectedTaskOrder}
          hideTaskFilter={true}
          hideOuterCard={true}
        />
      </div>
    </div>
  );
}
