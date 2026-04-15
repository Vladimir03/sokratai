import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { HWDraftTask, KBTask } from '@/types/kb';

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
          snapshotEdited: false,
          source: task.owner_id ? 'my' : 'socrat',
          subtopic: subtopicName ?? '',
          topicName: topicName ?? '',
          sourceLabel: task.source_label ?? null,
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
