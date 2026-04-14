import { useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Library } from 'lucide-react';
import { toast } from 'sonner';
import { deleteTutorHomeworkTaskImage } from '@/lib/tutorHomeworkApi';
import type { KBTask } from '@/types/kb';
import { getKBImageSignedUrl } from '@/lib/kbApi';
import {
  parseAttachmentUrls,
  serializeAttachmentUrls,
  MAX_TASK_IMAGES,
} from '@/lib/attachmentRefs';
import { KBPickerSheet } from '@/components/tutor/KBPickerSheet';
import { HWTaskCard } from './HWTaskCard';
import { type DraftTask, createEmptyTask, generateUUID, revokeObjectUrl } from './types';

function inferCheckFormat(kimNumber: number | null): 'short_answer' | 'detailed_solution' {
  if (kimNumber && kimNumber >= 21 && kimNumber <= 26) return 'detailed_solution';
  return 'short_answer';
}

/** Map legacy KB answer_format values to check_format enum */
function mapAnswerFormatToCheckFormat(af: string | null): 'short_answer' | 'detailed_solution' | null {
  if (!af) return null;
  if (af === 'short_answer' || af === 'detailed_solution') return af;
  if (af === 'detailed') return 'detailed_solution';
  // number, text, choice, matching → short answer
  return 'short_answer';
}

// Job: Быстро добавить задачу из базы в черновик ДЗ
/**
 * Возвращает `{ draft, truncatedFrom }`. `truncatedFrom` установлен в исходное
 * число фото, если KB-задача имела больше `MAX_TASK_IMAGES` — вызывающая сторона
 * решает, показать toast или нет (spec §3 «KB-импорт»).
 */
function kbTaskToDraftTask(
  task: KBTask,
): { draft: DraftTask; truncatedFrom: number | null } {
  const refs = parseAttachmentUrls(task.attachment_url);
  const slicedRefs = refs.slice(0, MAX_TASK_IMAGES);
  const taskImagePath = serializeAttachmentUrls(slicedRefs);
  const firstRef = slicedRefs[0] ?? null;
  const truncatedFrom = refs.length > MAX_TASK_IMAGES ? refs.length : null;

  const checkFormat: 'short_answer' | 'detailed_solution' =
    (task.check_format === 'short_answer' || task.check_format === 'detailed_solution' ? task.check_format : null)
    ?? mapAnswerFormatToCheckFormat(task.answer_format)
    ?? inferCheckFormat(task.kim_number);

  return {
    draft: {
      localId: generateUUID(),
      task_text: task.text,
      task_image_path: taskImagePath,
      // Legacy single-photo metadata — заполняем из первого ref'а для backward compat
      // (остальные фото рендерятся через parseAttachmentUrls(task_image_path) в HWTaskCard).
      task_image_name: firstRef?.split('/').pop() ?? null,
      task_image_preview_url: null,
      task_image_used_fallback: false,
      correct_answer: task.answer ?? '',
      rubric_text: '',
      rubric_image_paths: null,
      max_score: task.primary_score ?? 1,
      uploading: false,
      check_format: checkFormat,
      kb_task_id: task.id,
      kb_source: task.owner_id ? 'my' : 'socrat',
      kb_snapshot_text: task.text,
      kb_snapshot_answer: task.answer ?? null,
      kb_snapshot_solution: task.solution ?? null,
      // Провенанс: сохраняем тот же dual-format snapshot, что и в task_image_path.
      kb_attachment_url: taskImagePath,
    },
    truncatedFrom,
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
      const converted = kbTasks
        .filter((t) => !tasks.some((d) => d.kb_task_id === t.id))
        .map(kbTaskToDraftTask);
      if (converted.length === 0) return;

      const newDrafts = converted.map((c) => c.draft);

      // Surface truncation per task (spec §3 «KB-импорт»: импортируем первые 5
      // и показываем toast `Из БЗ импортировано 5 из N фото`).
      for (const { truncatedFrom } of converted) {
        if (truncatedFrom !== null) {
          toast.info(
            `Из БЗ импортировано ${MAX_TASK_IMAGES} из ${truncatedFrom} фото`,
          );
        }
      }

      // Resolve signed URL for the first KB attachment (превью в legacy-слоте).
      // Остальные фото резолвятся внутри HWTaskCard на рендере галереи.
      await Promise.all(
        newDrafts.map(async (draft) => {
          const firstRef = parseAttachmentUrls(draft.task_image_path)[0];
          if (firstRef) {
            const url = await getKBImageSignedUrl(firstRef);
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
