import { useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Library } from 'lucide-react';
import { toast } from 'sonner';
import { deleteTutorHomeworkTaskImage } from '@/lib/tutorHomeworkApi';
import type { KBTask } from '@/types/kb';
import { parseAttachmentUrls, getKBImageSignedUrl } from '@/lib/kbApi';
import { KBPickerSheet } from '@/components/tutor/KBPickerSheet';
import { HWTaskCard } from './HWTaskCard';
import { type DraftTask, createEmptyTask, generateUUID, revokeObjectUrl } from './types';

// Job: Быстро добавить задачу из базы в черновик ДЗ
function kbTaskToDraftTask(task: KBTask): DraftTask {
  const attachmentRef = parseAttachmentUrls(task.attachment_url)[0] ?? null;
  return {
    localId: generateUUID(),
    task_text: task.text,
    task_image_path: attachmentRef,
    task_image_name: attachmentRef?.split('/').pop() ?? null,
    task_image_preview_url: null,
    task_image_used_fallback: false,
    correct_answer: task.answer ?? '',
    rubric_text: '',
    max_score: 1,
    uploading: false,
    kb_task_id: task.id,
    kb_source: task.owner_id ? 'my' : 'socrat',
    kb_snapshot_text: task.text,
    kb_snapshot_answer: task.answer ?? null,
    kb_snapshot_solution: task.solution ?? null,
    kb_attachment_url: attachmentRef,
  };
}

function isEmptyTask(t: DraftTask): boolean {
  return !t.task_text.trim() && !t.task_image_path && !t.correct_answer.trim() && !t.kb_task_id;
}

export interface HWTasksSectionProps {
  tasks: DraftTask[];
  onChange: (t: DraftTask[]) => void;
  errors: Record<string, string>;
  topicHint?: string;
  /** Disable removing existing tasks (e.g. when submissions exist) */
  disableExistingTaskRemove?: boolean;
  /** Disable adding new tasks (e.g. when submissions exist) */
  disableTaskAdd?: boolean;
  /** When set, defer storage image deletes instead of executing immediately (edit mode safety) */
  onDeferImageDelete?: (storagePath: string) => void;
  /** When true, show confirm dialog before removing a task (active HW) */
  confirmOnRemove?: boolean;
}

export function HWTasksSection({
  tasks,
  onChange,
  errors,
  topicHint,
  disableExistingTaskRemove,
  disableTaskAdd,
  onDeferImageDelete,
  confirmOnRemove,
}: HWTasksSectionProps) {
  const [kbPickerOpen, setKbPickerOpen] = useState(false);

  const handleAdd = useCallback(() => {
    onChange([...tasks, createEmptyTask()]);
  }, [tasks, onChange]);

  const handleAddFromKB = useCallback(
    async (kbTasks: KBTask[]) => {
      const newDrafts = kbTasks
        .filter((t) => !tasks.some((d) => d.kb_task_id === t.id))
        .map(kbTaskToDraftTask);
      if (newDrafts.length === 0) return;

      // Resolve signed URLs for KB attachments
      await Promise.all(
        newDrafts.map(async (draft) => {
          if (draft.task_image_path) {
            const url = await getKBImageSignedUrl(draft.task_image_path);
            if (url) draft.task_image_preview_url = url;
          }
        }),
      );

      // Remove empty placeholder tasks
      const kept = tasks.filter((t) => !isEmptyTask(t));
      onChange([...kept, ...newDrafts]);
      toast.success(
        newDrafts.length === 1
          ? 'Задача добавлена в ДЗ'
          : `Добавлено задач: ${newDrafts.length}`,
      );
    },
    [tasks, onChange],
  );

  const addedKbTaskIds = useMemo(
    () => new Set(tasks.filter((t) => t.kb_task_id).map((t) => t.kb_task_id!)),
    [tasks],
  );

  const handleMove = useCallback(
    (fromIdx: number, toIdx: number) => {
      if (toIdx < 0 || toIdx >= tasks.length) return;
      const next = [...tasks];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      onChange(next);
    },
    [tasks, onChange],
  );

  const handleUpdate = useCallback(
    (idx: number, updated: DraftTask) => {
      const next = [...tasks];
      next[idx] = updated;
      onChange(next);
    },
    [tasks, onChange],
  );

  const handleRemove = useCallback(
    (idx: number) => {
      if (confirmOnRemove && !window.confirm('Удалить задачу? Ученики могут потерять прогресс по ней.')) {
        return;
      }
      const removed = tasks[idx];
      if (removed.task_image_path) {
        if (onDeferImageDelete) {
          onDeferImageDelete(removed.task_image_path);
        } else {
          void deleteTutorHomeworkTaskImage(removed.task_image_path);
        }
      }
      revokeObjectUrl(removed.task_image_preview_url);
      onChange(tasks.filter((_, i) => i !== idx));
    },
    [tasks, onChange, confirmOnRemove, onDeferImageDelete],
  );

  return (
    <div className="space-y-4">
      {errors._tasks && (
        <p className="text-sm text-destructive">{errors._tasks}</p>
      )}
      {tasks.map((task, i) => (
        <HWTaskCard
          key={task.localId}
          task={task}
          index={i}
          onUpdate={(t) => handleUpdate(i, t)}
          onRemove={() => handleRemove(i)}
          canRemove={tasks.length > 1 && !(disableExistingTaskRemove && task.id)}
          onDeferImageDelete={onDeferImageDelete}
          onMoveUp={() => handleMove(i, i - 1)}
          onMoveDown={() => handleMove(i, i + 1)}
          isFirst={i === 0}
          isLast={i === tasks.length - 1}
        />
      ))}
      {disableTaskAdd && (
        <p className="text-xs text-muted-foreground">
          Нельзя добавлять или удалять задачи — ученики уже отправили ответы.
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="outline" onClick={handleAdd} className="gap-2 flex-1" disabled={disableTaskAdd}>
          <Plus className="h-4 w-4" />
          Добавить задачу
        </Button>
        <Button
          variant="outline"
          onClick={() => setKbPickerOpen(true)}
          className="gap-2 flex-1"
          disabled={disableTaskAdd}
        >
          <Library className="h-4 w-4" />
          Добавить из базы
        </Button>
      </div>
      <KBPickerSheet
        open={kbPickerOpen}
        onOpenChange={setKbPickerOpen}
        onAddTasks={handleAddFromKB}
        addedKbTaskIds={addedKbTaskIds}
        topicHint={topicHint}
      />
    </div>
  );
}
