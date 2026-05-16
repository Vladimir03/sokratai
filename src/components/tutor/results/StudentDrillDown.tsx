import { useEffect, useMemo, useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
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
  type TutorHomeworkAssignmentDetails,
  type TutorHomeworkResultsPerStudent,
} from '@/lib/tutorHomeworkApi';
import { trackGuidedHomeworkEvent } from '@/lib/homeworkTelemetry';

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
  tasks: TutorHomeworkAssignmentDetails['tasks'];
  perStudent: TutorHomeworkResultsPerStudent | null;
  /** Task selected from a HeatmapGrid cell click. `null` = show all tasks. */
  initialTaskId: string | null;
}

export function StudentDrillDown({
  assignmentId,
  studentId,
  studentName,
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
      queryClient.invalidateQueries({
        queryKey: ['tutor', 'homework', 'results', assignmentId],
      });
      queryClient.invalidateQueries({
        queryKey: ['tutor', 'homework', 'detail', assignmentId],
      });
      queryClient.invalidateQueries({
        queryKey: ['tutor', 'homework', 'thread', assignmentId, studentId],
      });
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

  return (
    <div className="space-y-4">
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
              isSelected={selectedTaskId === task.id}
              onSelect={handleSelect}
              onEdit={() => handleEdit(task.id)}
            />
          ))}
        </div>
        {/* Bulk CTA — рендерится только если есть незакрытые задачи.
            AlertDialog подтверждает действие. Balls не выставляется
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
          enabled={true}
          initialTaskFilter={selectedTaskOrder}
          hideTaskFilter={true}
          hideOuterCard={true}
        />
      </div>
    </div>
  );
}
