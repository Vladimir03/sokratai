import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BookmarkPlus, Check, ChevronDown, Folder, FolderPlus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { stripLatex } from '@/components/kb/ui/stripLatex';
import { useRootFolders } from '@/hooks/useFolders';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  saveTutorHomeworkTasksToKB,
  type SaveTasksToKBResponse,
} from '@/lib/tutorHomeworkApi';
import { trackGuidedHomeworkEvent } from '@/lib/homeworkTelemetry';

/**
 * SaveTasksToKBDialog — homework-reuse-v1 TASK-5 (AC-10..13).
 *
 * Sheet that lets the tutor save one (single) or many (bulk) tasks from a
 * homework assignment into «Мою базу» (KB personal folders). Works with
 * `POST /assignments/:id/save-tasks-to-kb`, which performs fingerprint-based
 * dedup — повторный save тех же задач возвращает `already_in_base=true`.
 *
 * Dialog behaviours worth noting:
 *   - Default all tasks checked (AC-10). Single mode hides the checkbox UI.
 *   - Folder is picked from existing root folders OR created inline via
 *     «+ Создать новую папку» — backend accepts `new_folder_name` atomically
 *     so we don't pre-create dangling folders on cancel.
 *   - Rubric (`rubric_*`) is intentionally NOT copied to KB — see AC-12. No
 *     client-side concern, but the doc hint reminds the tutor.
 *   - Telemetry fires once on success: `homework_saved_to_kb` (bulk mode) or
 *     `homework_saved_to_kb_per_task` (single mode). Both PII-free.
 *
 * Anti-drift: this dialog doesn't know about the homework rendering internals
 * — it receives a minimal `tasks` array so it can be reused from both
 * `TutorHomeworkDetail` (Actions menu bulk path) and `HWTaskCard`
 * (BookmarkPlus icon single path). Keep the prop surface minimal.
 */

export interface SaveTasksToKBDialogTask {
  id: string;
  order_num: number;
  task_text: string;
  /**
   * Optional UI hint — рендерит label «уже в базе» рядом с задачей, когда
   * мы уже знаем (из provenance), что эта задача пришла из моей базы. Не
   * влияет на логику отправки: backend делает реальную dedup-проверку.
   */
  already_in_base_hint?: boolean;
}

interface SaveTasksToKBDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignmentId: string;
  tasks: SaveTasksToKBDialogTask[];
  mode: 'bulk' | 'single';
  /** Optional callback after successful save (e.g. to refetch KB lists). */
  onSaved?: (response: SaveTasksToKBResponse) => void;
}

const NEW_FOLDER_MAX_LEN = 120;
const TASK_PREVIEW_MAX_CHARS = 140;

function truncatePreview(text: string): string {
  const stripped = stripLatex(text ?? '').trim();
  if (!stripped) return '[Задача на фото]';
  if (stripped.length <= TASK_PREVIEW_MAX_CHARS) return stripped;
  return stripped.slice(0, TASK_PREVIEW_MAX_CHARS).trimEnd() + '…';
}

/**
 * Russian pluralisation for «задач*»: 1 задачу, 2-4 задачи, 5+ задач, 0 задач.
 * Excludes the leading digit — it's rendered separately in the button label.
 */
function pluralizeTasks(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return '';
  if (mod10 === 1) return 'у';
  if (mod10 >= 2 && mod10 <= 4) return 'и';
  return '';
}

export function SaveTasksToKBDialog({
  open,
  onOpenChange,
  assignmentId,
  tasks,
  mode,
  onSaved,
}: SaveTasksToKBDialogProps) {
  const queryClient = useQueryClient();
  const { folders: rootFolders, loading: foldersLoading } = useRootFolders();
  // AC-10: desktop = side drawer (right), mobile = bottom sheet. Spec §6
  // «SaveTasksToKBDialog uses drawer/sheet паттерн». useIsMobile reads the
  // 768px matchMedia — matches Tailwind `md:` breakpoint so CSS and runtime
  // stay in sync.
  const isMobile = useIsMobile();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reset transient state when dialog opens (no bleed between invocations).
  useEffect(() => {
    if (open) {
      setSelectedIds(new Set(tasks.map((t) => t.id)));
      setSelectedFolderId(null);
      setNewFolderMode(false);
      setNewFolderName('');
      setSubmitting(false);
    }
  }, [open, tasks]);

  // Auto-select the first folder when the list resolves so the user doesn't
  // have to click twice. Skipped when the user has explicitly opted into
  // «+ Создать новую папку».
  useEffect(() => {
    if (!open) return;
    if (newFolderMode) return;
    if (selectedFolderId) return;
    if (rootFolders.length === 0) return;
    setSelectedFolderId(rootFolders[0].id);
  }, [open, newFolderMode, selectedFolderId, rootFolders]);

  const toggleTask = useCallback((taskId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const selectedCount = selectedIds.size;
  const trimmedNewFolderName = newFolderName.trim();
  const folderReady = newFolderMode
    ? trimmedNewFolderName.length > 0
    : Boolean(selectedFolderId);
  const canSubmit = !submitting && selectedCount > 0 && folderReady;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const response = await saveTutorHomeworkTasksToKB(assignmentId, {
        task_ids: Array.from(selectedIds),
        folder_id: newFolderMode ? null : selectedFolderId,
        new_folder_name: newFolderMode ? trimmedNewFolderName : null,
      });

      // Telemetry — one event per invocation, branch on mode so bulk vs
      // per-task retention can be compared side by side.
      if (mode === 'single') {
        const entry = response.saved[0];
        if (entry) {
          trackGuidedHomeworkEvent('homework_saved_to_kb_per_task', {
            assignmentId,
            taskId: entry.task_id,
            folderId: entry.folder_id,
            createdFolder: response.created_folder !== null,
            alreadyInBase: entry.already_in_base,
          });
        }
      } else {
        const firstFolderId = response.saved[0]?.folder_id ?? response.created_folder?.id ?? '';
        trackGuidedHomeworkEvent('homework_saved_to_kb', {
          assignmentId,
          tasksCount: selectedCount,
          folderId: firstFolderId,
          createdFolder: response.created_folder !== null,
          alreadyInBaseCount: response.saved.filter((s) => s.already_in_base).length,
          skippedCount: response.skipped.length,
        });
      }

      // Toast summary — surfaces the fingerprint dedup outcome.
      const newCount = response.saved.filter((s) => !s.already_in_base).length;
      const existingCount = response.saved.filter((s) => s.already_in_base).length;
      if (mode === 'single') {
        const entry = response.saved[0];
        if (entry) {
          toast.success(
            entry.already_in_base
              ? `Задача уже в базе (${entry.folder_name})`
              : `Задача сохранена в «${entry.folder_name}»`,
          );
        } else {
          toast.error('Не удалось сохранить задачу');
        }
      } else {
        const bits: string[] = [];
        if (newCount > 0) bits.push(`сохранено: ${newCount}`);
        if (existingCount > 0) bits.push(`уже в базе: ${existingCount}`);
        if (response.skipped.length > 0) bits.push(`пропущено: ${response.skipped.length}`);
        toast.success(
          bits.length ? `Готово — ${bits.join(', ')}` : 'Ничего не сохранено',
        );
      }

      // Invalidate KB caches so the new entries appear in «Моя база».
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'kb'] });

      onSaved?.(response);
      onOpenChange(false);
    } catch (err) {
      console.error('save_tasks_to_kb_failed', err);
      toast.error('Не удалось сохранить задачи в базу');
    } finally {
      setSubmitting(false);
    }
  }, [
    assignmentId,
    canSubmit,
    mode,
    newFolderMode,
    onOpenChange,
    onSaved,
    queryClient,
    selectedCount,
    selectedFolderId,
    selectedIds,
    trimmedNewFolderName,
  ]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className={cn(
          'flex flex-col gap-0 p-0',
          isMobile
            ? 'h-[90dvh] w-full !max-w-full rounded-t-xl'
            : 'w-full sm:w-[480px] !max-w-full',
        )}
      >
        <SheetHeader className="border-b px-4 py-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            <BookmarkPlus className="h-5 w-5 text-accent" aria-hidden="true" />
            {mode === 'single' ? 'Сохранить задачу в базу' : 'Сохранить задачи в базу'}
          </SheetTitle>
          <p className="text-xs text-slate-500">
            Рубрика и критерии оценки не переносятся в базу — они остаются только
            на этом ДЗ.
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {/* ─── Folder picker ─────────────────────────────────────── */}
          <section className="space-y-2" aria-labelledby="save-kb-folder-heading">
            <h3
              id="save-kb-folder-heading"
              className="text-sm font-medium text-slate-900"
            >
              Папка назначения
            </h3>

            {foldersLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Загрузка папок...
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <select
                    id="save-kb-folder-select"
                    value={newFolderMode ? '__new__' : (selectedFolderId ?? '')}
                    onChange={(e) => {
                      if (e.target.value === '__new__') {
                        setNewFolderMode(true);
                        setSelectedFolderId(null);
                      } else {
                        setNewFolderMode(false);
                        setSelectedFolderId(e.target.value || null);
                      }
                    }}
                    disabled={submitting}
                    /* text-base (16px) + touch-action: manipulation — iOS Safari
                     * rules per .claude/rules/80-cross-browser.md. */
                    className="flex w-full min-h-[44px] appearance-none rounded-md border border-input bg-background pl-3 pr-9 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ fontSize: '16px', touchAction: 'manipulation' }}
                    aria-label="Папка назначения"
                  >
                    {rootFolders.length === 0 && (
                      <option value="" disabled>
                        У вас ещё нет папок — создайте новую
                      </option>
                    )}
                    {rootFolders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                        {folder.task_count > 0 ? ` · ${folder.task_count}` : ''}
                      </option>
                    ))}
                    <option value="__new__">+ Создать новую папку</option>
                  </select>
                  <ChevronDown
                    className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                </div>

                {newFolderMode ? (
                  <div className="space-y-1 rounded-md border border-dashed border-slate-200 bg-slate-50 p-3">
                    <Label
                      htmlFor="save-kb-new-folder-name"
                      className="text-xs font-medium text-slate-700 flex items-center gap-1"
                    >
                      <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
                      Название новой папки
                    </Label>
                    <Input
                      id="save-kb-new-folder-name"
                      value={newFolderName}
                      maxLength={NEW_FOLDER_MAX_LEN}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      disabled={submitting}
                      placeholder="Например, «Кинематика 10 класс»"
                      className="text-base"
                      aria-invalid={!trimmedNewFolderName}
                    />
                    <p className="text-[11px] text-slate-500">
                      Папка создастся при сохранении. До {NEW_FOLDER_MAX_LEN} символов.
                    </p>
                  </div>
                ) : null}
              </div>
            )}
          </section>

          {/* ─── Task list (hidden when single + 1 task) ──────────── */}
          <section
            className="space-y-2"
            aria-labelledby={mode === 'single' ? undefined : 'save-kb-tasks-heading'}
          >
            {mode === 'single' ? null : (
              <div className="flex items-baseline justify-between">
                <h3
                  id="save-kb-tasks-heading"
                  className="text-sm font-medium text-slate-900"
                >
                  Задачи ({tasks.length})
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    if (selectedIds.size === tasks.length) {
                      setSelectedIds(new Set());
                    } else {
                      setSelectedIds(new Set(tasks.map((t) => t.id)));
                    }
                  }}
                  disabled={submitting}
                  className="text-xs text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded disabled:opacity-50"
                >
                  {selectedIds.size === tasks.length ? 'Снять все' : 'Выбрать все'}
                </button>
              </div>
            )}

            <ul className="space-y-1.5" role="list">
              {tasks.map((task) => {
                const isSelected = selectedIds.has(task.id);
                return (
                  <li key={task.id}>
                    <label
                      className={cn(
                        'flex items-start gap-3 rounded-md border bg-white px-3 py-2 transition-colors',
                        mode === 'bulk' && 'cursor-pointer',
                        mode === 'bulk' && isSelected
                          ? 'border-accent/50 bg-accent/[0.04]'
                          : 'border-slate-200 hover:border-slate-300',
                        submitting && 'cursor-not-allowed opacity-60',
                      )}
                      style={{ touchAction: 'manipulation' }}
                    >
                      {mode === 'bulk' ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            if (submitting) return;
                            toggleTask(task.id);
                          }}
                          aria-pressed={isSelected}
                          aria-label={isSelected ? 'Снять выбор' : 'Выбрать'}
                          disabled={submitting}
                          className={cn(
                            'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors',
                            isSelected
                              ? 'border-accent bg-accent text-white'
                              : 'border-slate-300 hover:border-accent/60',
                          )}
                        >
                          {isSelected ? <Check className="h-3.5 w-3.5" /> : null}
                        </button>
                      ) : null}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-slate-500">
                            Задача {task.order_num}
                          </span>
                          {task.already_in_base_hint ? (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                              <Check className="h-2.5 w-2.5" aria-hidden="true" />
                              уже в базе
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-sm text-slate-800 line-clamp-3">
                          {truncatePreview(task.task_text)}
                        </p>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <div className="border-t px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500">
              {mode === 'single'
                ? 'Будет сохранена 1 задача'
                : selectedCount === 0
                  ? 'Выберите хотя бы одну задачу'
                  : `Выбрано: ${selectedCount} из ${tasks.length}`}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Отмена
              </Button>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Сохраняем...
                  </>
                ) : (
                  <>
                    <Folder className="h-4 w-4" aria-hidden="true" />
                    {mode === 'single'
                      ? 'Сохранить задачу'
                      : `Сохранить ${selectedCount || ''} задач${pluralizeTasks(selectedCount)}`}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
