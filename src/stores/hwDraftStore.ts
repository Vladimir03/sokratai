import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { HWDraftTask, KBTask } from '@/types/kb';
import { resolveCheckFormatFromKb } from '@/lib/checkFormatHelpers';

interface HWDraftStore {
  tasks: HWDraftTask[];

  addTask: (task: KBTask, subtopicName?: string, topicName?: string) => void;
  removeTask: (taskId: string) => void;
  reorderTasks: (fromIndex: number, toIndex: number) => void;
  updateSnapshot: (
    taskId: string,
    field: 'textSnapshot' | 'answerSnapshot',
    value: string,
  ) => void;
  clearDraft: () => void;
  hasTask: (taskId: string) => boolean;
}

export const useHWDraftStore = create<HWDraftStore>()(
  persist(
    (set, get) => ({
      tasks: [],

      addTask: (task, subtopicName, topicName) => {
        if (get().tasks.some((t) => t.taskId === task.id)) return;

        const draftTask: HWDraftTask = {
          taskId: task.id,
          textSnapshot: task.text,
          answerSnapshot: task.answer ?? null,
          solutionSnapshot: task.solution ?? null,
          attachmentSnapshot: task.attachment_url ?? null,
          // Carry KB solution images snapshot so HWDrawer can persist them
          // into homework_tutor_tasks.solution_image_urls (plan wild-swinging-nova.md).
          solutionAttachmentSnapshot: task.solution_attachment_url ?? null,
          // Field-parity fix (2026-06-03): freeze rubric (критерии) so HWDrawer
          // persists it into homework_tutor_tasks.rubric_* (path B). Без этого
          // «В ДЗ» с KB-карточки терял критерии (баг #2).
          rubricTextSnapshot: task.rubric_text ?? null,
          rubricImageSnapshot: task.rubric_image_urls ?? null,
          // Phase 3.1 hotfix (2026-05-13): freeze check_format so HWDrawer
          // can write it + task_kind into homework_tutor_tasks. Без этого
          // HWDrawer-flow создавал задачи с DB-default `task_kind='extended'`
          // независимо от KB-задачи (student warn banner показывался неверно).
          checkFormatSnapshot: resolveCheckFormatFromKb({
            check_format: task.check_format,
            answer_format: task.answer_format,
            kim_number: task.kim_number,
          }),
          snapshotEdited: false,
          source: task.owner_id ? 'my' : 'socrat',
          subtopic: subtopicName ?? '',
          topicName: topicName ?? '',
          sourceLabel: task.source_label ?? null,
          // Phase 2 (2026-06-21): freeze № КИМ so HWDrawer persists it into
          // homework_tutor_tasks.kim_number (path B) → grading по критериям ФИПИ.
          kim_number: task.kim_number ?? null,
          // Review fix P1 (2026-06-21): freeze балл задачи (primary_score) → HWDrawer
          // пишет max_score, иначе KB-задача с авто-баллом/сложностью >1 падала в 1.
          maxScoreSnapshot: task.primary_score ?? 1,
        };

        set((state) => ({ tasks: [...state.tasks, draftTask] }));
      },

      removeTask: (taskId) => {
        set((state) => ({
          tasks: state.tasks.filter((t) => t.taskId !== taskId),
        }));
      },

      reorderTasks: (fromIndex, toIndex) => {
        set((state) => {
          const tasks = [...state.tasks];
          const [moved] = tasks.splice(fromIndex, 1);
          if (!moved) return state;
          tasks.splice(toIndex, 0, moved);
          return { tasks };
        });
      },

      updateSnapshot: (taskId, field, value) => {
        set((state) => ({
          tasks: state.tasks.map((t) => {
            if (t.taskId !== taskId) return t;
            // Only mark edited if the value actually changed
            const oldValue = t[field];
            if (oldValue === value) return t;
            return { ...t, [field]: value, snapshotEdited: true };
          }),
        }));
      },

      clearDraft: () => set({ tasks: [] }),

      hasTask: (taskId) => get().tasks.some((t) => t.taskId === taskId),
    }),
    {
      name: 'sokrat-hw-draft',
    },
  ),
);

/** Derived selector — use instead of stored taskCount */
export const useHWTaskCount = () => useHWDraftStore((s) => s.tasks.length);
