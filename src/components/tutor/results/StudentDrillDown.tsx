import { useEffect, useMemo, useState, useCallback } from 'react';
import { GuidedThreadViewer } from '@/components/tutor/GuidedThreadViewer';
import { TaskMiniCard } from './TaskMiniCard';
import { EditScoreDialog } from './EditScoreDialog';
import type {
  TutorHomeworkAssignmentDetails,
  TutorHomeworkResultsPerStudent,
} from '@/lib/tutorHomeworkApi';

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
  tasks: TutorHomeworkAssignmentDetails['tasks'];
  perStudent: TutorHomeworkResultsPerStudent | null;
  /** Task selected from a HeatmapGrid cell click. `null` = show all tasks. */
  initialTaskId: string | null;
}

export function StudentDrillDown({
  assignmentId,
  studentId,
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

  // taskId → { order_num, score, hint_count, max_score } lookup so mini-cards
  // can show the right colors without passing props dozens of levels deep.
  const taskMeta = useMemo(() => {
    const scoresById = new Map<
      string,
      { final_score: number; hint_count: number; has_override: boolean; ai_score: number | null }
    >();
    for (const ts of perStudent?.task_scores ?? []) {
      scoresById.set(ts.task_id, {
        final_score: ts.final_score,
        hint_count: ts.hint_count,
        has_override: ts.has_override ?? false,
        ai_score: ts.ai_score ?? null,
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
      };
    });
  }, [tasks, perStudent]);

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

  return (
    <div className="space-y-4">
      {/* Horizontal scrollable row of mini-cards. `touch-pan-x` keeps iOS
          Safari swipe working even though the buttons consume touchstart. */}
      <div className="flex gap-2 overflow-x-auto touch-pan-x pb-2 -mx-1 px-1">
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
          // When override is set, results endpoint returns final_score but
          // not ai_score separately — show "—" rather than misleading value.
          aiScore={editingTask.ai_score}
          currentOverride={editingTask.has_override ? editingTask.score : null}
          currentComment={null}
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
          enabled={true}
          initialTaskFilter={selectedTaskOrder}
          hideTaskFilter={true}
          hideOuterCard={true}
        />
      </div>
    </div>
  );
}
