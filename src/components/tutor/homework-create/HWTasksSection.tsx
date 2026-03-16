import { useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Library } from 'lucide-react';
import { toast } from 'sonner';
import { deleteTutorHomeworkTaskImage } from '@/lib/tutorHomeworkApi';
import type { KBTask } from '@/types/kb';
import { parseAttachmentUrls } from '@/lib/kbApi';
import { KBPickerSheet } from '@/components/tutor/KBPickerSheet';
import { HWTaskCard } from './HWTaskCard';
import { HWMaterialsSection } from './HWMaterialsSection';
import { type DraftTask, type DraftMaterial, createEmptyTask, generateUUID, revokeObjectUrl } from './types';

// Job: Быстро добавить задачу из базы в черновик ДЗ
function kbTaskToDraftTask(task: KBTask): DraftTask {
  return {
    localId: generateUUID(),
    task_text: task.text,
    task_image_path: null,
    task_image_name: null,
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
    kb_attachment_url: parseAttachmentUrls(task.attachment_url)[0] ?? null,
  };
}

export interface HWTasksSectionProps {
  tasks: DraftTask[];
  onChange: (t: DraftTask[]) => void;
  materials: DraftMaterial[];
  onMaterialsChange: (m: DraftMaterial[]) => void;
  errors: Record<string, string>;
  topicHint?: string;
}

export function HWTasksSection({
  tasks,
  onChange,
  materials,
  onMaterialsChange,
  errors,
  topicHint,
}: HWTasksSectionProps) {
  const [kbPickerOpen, setKbPickerOpen] = useState(false);

  const handleAdd = useCallback(() => {
    onChange([...tasks, createEmptyTask()]);
  }, [tasks, onChange]);

  const handleAddFromKB = useCallback(
    (kbTasks: KBTask[]) => {
      const newDrafts = kbTasks
        .filter((t) => !tasks.some((d) => d.kb_task_id === t.id))
        .map(kbTaskToDraftTask);
      if (newDrafts.length === 0) return;
      onChange([...tasks, ...newDrafts]);
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
      const removed = tasks[idx];
      if (removed.task_image_path) {
        void deleteTutorHomeworkTaskImage(removed.task_image_path);
      }
      revokeObjectUrl(removed.task_image_preview_url);
      onChange(tasks.filter((_, i) => i !== idx));
    },
    [tasks, onChange],
  );

  return (
    <div className="space-y-4">
      <div className="border-b pb-3">
        <HWMaterialsSection materials={materials} onChange={onMaterialsChange} />
      </div>
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
          canRemove={tasks.length > 1}
        />
      ))}
      <div className="flex gap-2">
        <Button variant="outline" onClick={handleAdd} className="gap-2 flex-1">
          <Plus className="h-4 w-4" />
          Добавить задачу
        </Button>
        <Button
          variant="outline"
          onClick={() => setKbPickerOpen(true)}
          className="gap-2 flex-1"
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
