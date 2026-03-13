import { useState } from 'react';
import { BookOpen, Image, Pencil, Plus, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { SourceBadge } from '@/components/kb/ui/SourceBadge';
import { stripLatex } from '@/components/kb/ui/stripLatex';
import { cn } from '@/lib/utils';
import { useHWDraftStore, useHWTaskCount } from '@/stores/hwDraftStore';
import { supabase } from '@/lib/supabaseClient';

export function HWDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { tasks, removeTask, updateSnapshot, clearDraft } = useHWDraftStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editAnswer, setEditAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const startEdit = (taskId: string, text: string, answer: string | null) => {
    setEditingId(taskId);
    setEditText(text);
    setEditAnswer(answer ?? '');
  };

  const saveEdit = (taskId: string) => {
    // Always update both fields — updateSnapshot only marks edited if value changed
    updateSnapshot(taskId, 'textSnapshot', editText);
    updateSnapshot(taskId, 'answerSnapshot', editAnswer || '');
    setEditingId(null);
    toast.success('Условие обновлено');
  };

  const cancelEdit = () => setEditingId(null);

  const handleSendHomework = async () => {
    if (tasks.length === 0) return;

    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('Сессия истекла. Войдите заново.');
        return;
      }

      // Create a homework_tutor_assignments record first
      const { data: hw, error: hwError } = await supabase
        .from('homework_tutor_assignments')
        .insert({
          tutor_id: session.user.id,
          title: `ДЗ из Базы знаний`,
          subject: 'math',
          status: 'draft',
        })
        .select('id')
        .single();

      if (hwError || !hw) {
        toast.error(`Ошибка создания ДЗ: ${hwError?.message ?? 'unknown'}`);
        return;
      }

      // 1) Create homework_tutor_tasks so the student runtime can see these tasks
      const tutorTasks = tasks.map((task, index) => ({
        assignment_id: hw.id,
        task_text: task.textSnapshot,
        task_image_url: task.attachmentSnapshot ?? null,
        correct_answer: task.answerSnapshot ?? null,
        solution_steps: task.solutionSnapshot ?? null,
        order_num: index + 1,
      }));

      const { error: tasksError } = await supabase
        .from('homework_tutor_tasks')
        .insert(tutorTasks);

      if (tasksError) {
        toast.error(`Ошибка создания задач: ${tasksError.message}`);
        return;
      }

      // 2) Create homework_kb_tasks snapshots (KB reference + frozen text)
      const links = tasks.map((task, index) => ({
        homework_id: hw.id,
        task_id: task.taskId,
        sort_order: index,
        task_text_snapshot: task.textSnapshot,
        task_answer_snapshot: task.answerSnapshot,
        task_solution_snapshot: task.solutionSnapshot,
        snapshot_edited: task.snapshotEdited,
      }));

      const { error } = await supabase.from('homework_kb_tasks').insert(links);

      if (error) {
        // If a specific task_id FK fails (task deleted since draft), retry only that link
        if (error.code === '23503') {
          for (const link of links) {
            const { error: singleErr } = await supabase
              .from('homework_kb_tasks')
              .insert(link);
            if (singleErr?.code === '23503') {
              // This specific task was deleted — insert without FK reference
              await supabase
                .from('homework_kb_tasks')
                .insert({ ...link, task_id: null });
            } else if (singleErr) {
              toast.error(`Ошибка сохранения: ${singleErr.message}`);
              return;
            }
          }
        } else {
          toast.error(`Ошибка сохранения: ${error.message}`);
          return;
        }
      }

      clearDraft();
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'homework', 'assignments'] });
      toast.success('Черновик ДЗ создан — откройте его в разделе ДЗ для отправки ученику');
      navigate(`/tutor/homework`);
    } catch {
      toast.error('Не удалось отправить ДЗ');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddMore = () => {
    onOpenChange(false);
    navigate('/tutor/knowledge');
  };

  const taskCountLabel = (count: number) => {
    if (count === 1) return '1 задача';
    if (count >= 2 && count <= 4) return `${count} задачи`;
    return `${count} задач`;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[420px] max-w-[90vw] flex-col gap-0 bg-socrat-surface p-0 sm:max-w-[420px]"
      >
        <SheetTitle className="sr-only">Домашнее задание</SheetTitle>
        <SheetDescription className="sr-only">
          Конструктор домашнего задания из Базы знаний
        </SheetDescription>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-socrat-border px-5 py-4">
          <div>
            <h2 className="text-[17px] font-semibold text-slate-900">
              Домашнее задание
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {taskCountLabel(tasks.length)}
            </p>
          </div>
        </div>

        {/* Task list */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tasks.length === 0 ? (
            <div className="px-5 py-12 text-center text-slate-400">
              <div className="mb-3 text-[40px]">📋</div>
              <p className="text-sm font-medium text-slate-600">Пока пусто</p>
              <p className="mt-1 text-xs text-slate-400">
                Добавьте задачи из Каталога или Моей базы
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {tasks.map((task, index) => (
                <div
                  key={task.taskId}
                  className={cn(
                    'rounded-xl border bg-white p-3.5',
                    editingId === task.taskId
                      ? 'border-socrat-primary/40'
                      : 'border-socrat-border',
                  )}
                >
                  <div className="flex items-start gap-3">
                    {/* Number */}
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-socrat-primary-light text-xs font-bold text-socrat-primary">
                      {index + 1}
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                        <SourceBadge source={task.source} />
                        {task.subtopic ? (
                          <span className="text-[11px] text-slate-400">
                            {task.subtopic}
                          </span>
                        ) : null}
                        {task.attachmentSnapshot ? (
                          <Image className="h-3 w-3 text-slate-400" />
                        ) : null}
                        {task.snapshotEdited ? (
                          <span className="rounded-full bg-socrat-accent-light px-1.5 py-0.5 text-[9px] font-semibold text-socrat-accent">
                            изменено
                          </span>
                        ) : null}
                      </div>

                      {editingId !== task.taskId ? (
                        <p className="line-clamp-2 text-xs leading-relaxed text-slate-700">
                          {stripLatex(task.textSnapshot)}
                        </p>
                      ) : (
                        <div className="mt-1 flex flex-col gap-2">
                          <div>
                            <label className="mb-1 block text-[11px] text-slate-500">
                              Условие
                            </label>
                            <textarea
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              rows={4}
                              className="w-full resize-y rounded-lg border border-socrat-primary/30 px-2.5 py-2 text-base leading-relaxed text-slate-900 focus:border-socrat-primary focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] text-slate-500">
                              Ответ
                            </label>
                            <input
                              value={editAnswer}
                              onChange={(e) => setEditAnswer(e.target.value)}
                              className="w-full rounded-lg border border-socrat-border px-2.5 py-1.5 font-mono text-base text-slate-900 focus:border-socrat-primary focus:outline-none"
                            />
                          </div>
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="rounded-md border border-socrat-border px-3 py-1.5 text-xs text-slate-500 transition-colors hover:bg-slate-50"
                            >
                              Отмена
                            </button>
                            <button
                              type="button"
                              onClick={() => saveEdit(task.taskId)}
                              className="rounded-md bg-socrat-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-socrat-primary-dark"
                            >
                              Сохранить
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex shrink-0 gap-1">
                      {editingId !== task.taskId ? (
                        <button
                          type="button"
                          onClick={() =>
                            startEdit(
                              task.taskId,
                              task.textSnapshot,
                              task.answerSnapshot,
                            )
                          }
                          className="rounded-md p-1 text-slate-400 transition-colors hover:text-socrat-primary"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => removeTask(task.taskId)}
                        className="rounded-md p-1 text-slate-400 transition-colors hover:text-red-500"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2.5 border-t border-socrat-border px-5 py-4">
          <button
            type="button"
            onClick={handleAddMore}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-socrat-primary/30 bg-socrat-primary-light/40 px-4 py-3 text-sm font-medium text-socrat-primary transition-colors hover:border-socrat-primary/50 hover:bg-socrat-primary-light"
          >
            <Plus className="h-4 w-4" />
            Добавить из Базы знаний
          </button>
          <button
            type="button"
            onClick={handleSendHomework}
            disabled={tasks.length === 0 || submitting}
            className={cn(
              'w-full rounded-xl px-4 py-3 text-sm font-semibold text-white transition-colors',
              tasks.length > 0 && !submitting
                ? 'bg-socrat-primary hover:bg-socrat-primary-dark'
                : 'cursor-not-allowed bg-slate-300',
            )}
          >
            {submitting ? 'Сохранение...' : 'Создать черновик ДЗ'}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * HW badge button for the KB frame header.
 * Shows task count when > 0 with green highlight.
 */
export function HWBadgeButton({ onClick }: { onClick: () => void }) {
  const taskCount = useHWTaskCount();

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold shadow-sm transition-all duration-200',
        taskCount > 0
          ? 'border-socrat-primary/30 bg-socrat-primary-light text-socrat-primary'
          : 'border-socrat-border bg-white text-slate-600 hover:border-socrat-primary/30 hover:text-socrat-primary',
      )}
    >
      <BookOpen className="h-4 w-4" />
      ДЗ{taskCount > 0 ? ` · ${taskCount}` : ''}
    </button>
  );
}
