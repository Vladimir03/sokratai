import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { useUpdateTask } from '@/hooks/useKnowledgeBase';
import {
  deleteKBTaskImage,
  getKBImageSignedUrl,
  MAX_TASK_IMAGES,
  parseAttachmentUrls,
  serializeAttachmentUrls,
  uploadKBTaskImage,
  validateImageFile,
} from '@/lib/kbApi';
import { cn } from '@/lib/utils';
import type { ExamType, KBTask, UpdateKBTaskInput } from '@/types/kb';

interface EditTaskModalProps {
  task: KBTask;
  onClose: () => void;
}

export function EditTaskModal({ task, onClose }: EditTaskModalProps) {
  const updateTask = useUpdateTask();

  const [text, setText] = useState(task.text);
  const [answer, setAnswer] = useState(task.answer ?? '');
  const [solution, setSolution] = useState(task.solution ?? '');
  const [exam, setExam] = useState<ExamType | ''>(task.exam ?? '');
  const [answerFormat, setAnswerFormat] = useState(task.answer_format ?? '');

  // ─── Multi-image state ──────────────────────────────────────────────────────
  // Existing images kept from the original task (refs removed go to removedRefsRef)
  const existingRefsRef = useRef<string[]>(parseAttachmentUrls(task.attachment_url));
  const [existingRefs, setExistingRefs] = useState<string[]>(existingRefsRef.current);
  const [existingSignedUrls, setExistingSignedUrls] = useState<Record<string, string>>({});

  // Newly added images
  const newFilesRef = useRef<File[]>([]);
  const newBlobUrlsRef = useRef<string[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [newPreviewUrls, setNewPreviewUrls] = useState<string[]>([]);

  // Refs removed during this edit session (cleaned up after successful save)
  const removedRefsRef = useRef<string[]>([]);

  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const totalImages = existingRefs.length + newFiles.length;

  // Load signed URLs for existing images
  useEffect(() => {
    const refs = parseAttachmentUrls(task.attachment_url);
    if (refs.length === 0) return;
    let cancelled = false;

    void Promise.all(
      refs.map(async (ref) => {
        const url = await getKBImageSignedUrl(ref);
        return { ref, url };
      }),
    ).then((results) => {
      if (cancelled) return;
      const urlMap: Record<string, string> = {};
      for (const { ref, url } of results) {
        if (url) urlMap[ref] = url;
      }
      setExistingSignedUrls(urlMap);
    });

    return () => {
      cancelled = true;
    };
  }, [task.attachment_url]);

  // Esc to close + body scroll lock
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      for (const url of newBlobUrlsRef.current) URL.revokeObjectURL(url);
    };
  }, []);

  // ─── File handlers ────────────────────────────────────────────────────────────

  /**
   * Add a single file. Uses refs for synchronous count tracking.
   * Returns true if accepted, false if rejected.
   */
  const handleFileSelect = useCallback((file: File): boolean => {
    const error = validateImageFile(file);
    if (error) {
      toast.error(error);
      return false;
    }

    const currentTotal = existingRefsRef.current.length + newFilesRef.current.length;
    if (currentTotal >= MAX_TASK_IMAGES) {
      toast.error(`Максимум ${MAX_TASK_IMAGES} изображений`);
      return false;
    }

    const url = URL.createObjectURL(file);
    newFilesRef.current = [...newFilesRef.current, file];
    newBlobUrlsRef.current = [...newBlobUrlsRef.current, url];

    setNewFiles([...newFilesRef.current]);
    setNewPreviewUrls([...newBlobUrlsRef.current]);
    return true;
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files?.length) return;

      for (const file of Array.from(files)) {
        handleFileSelect(file);
      }

      e.target.value = '';
    },
    [handleFileSelect],
  );

  const handleRemoveExisting = useCallback((ref: string) => {
    existingRefsRef.current = existingRefsRef.current.filter((r) => r !== ref);
    removedRefsRef.current = [...removedRefsRef.current, ref];
    setExistingRefs([...existingRefsRef.current]);
  }, []);

  const handleRemoveNew = useCallback((index: number) => {
    const urlToRevoke = newBlobUrlsRef.current[index];
    if (urlToRevoke) URL.revokeObjectURL(urlToRevoke);

    newFilesRef.current = newFilesRef.current.filter((_, i) => i !== index);
    newBlobUrlsRef.current = newBlobUrlsRef.current.filter((_, i) => i !== index);

    setNewFiles([...newFilesRef.current]);
    setNewPreviewUrls([...newBlobUrlsRef.current]);
  }, []);

  // Paste image from clipboard on textarea
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (uploading || updateTask.isPending) return;
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            if (handleFileSelect(file)) {
              toast.success('Изображение вставлено');
            }
          }
          return;
        }
      }
    },
    [handleFileSelect, uploading, updateTask.isPending],
  );

  // Drag-and-drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer?.types?.includes('Files')) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragging(false);

      if (uploading || updateTask.isPending) return;

      const files = e.dataTransfer?.files;
      if (!files?.length) return;

      let added = 0;
      let skippedNonImage = false;

      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) {
          skippedNonImage = true;
          continue;
        }
        if (handleFileSelect(file)) added++;
      }

      if (skippedNonImage && added === 0) {
        toast.error('Допустимы только изображения (JPG, PNG, GIF, WebP)');
      }

      if (added > 0) {
        toast.success(
          added === 1 ? 'Изображение добавлено' : `Добавлено изображений: ${added}`,
        );
      }
    },
    [handleFileSelect, uploading, updateTask.isPending],
  );

  // ─── Save logic ───────────────────────────────────────────────────────────────

  const hasImage = totalImages > 0;
  const hasContent = text.trim().length > 0 || hasImage;
  const canSave = hasContent;

  const handleSave = async () => {
    if (!canSave) return;

    setUploading(true);
    const uploadedRefs: string[] = [];
    try {
      // Upload new files (track refs for cleanup on failure)
      for (const file of newFilesRef.current) {
        const result = await uploadKBTaskImage(file);
        uploadedRefs.push(result.storageRef);
      }

      // Combine remaining existing refs + newly uploaded refs
      const allRefs = [...existingRefsRef.current, ...uploadedRefs];

      // Determine if attachment changed vs. original
      const originalRefs = parseAttachmentUrls(task.attachment_url);
      const hasAttachmentChanges =
        allRefs.length !== originalRefs.length ||
        allRefs.some((r, i) => r !== originalRefs[i]) ||
        removedRefsRef.current.length > 0;

      const taskText = text.trim() || '[Задача на фото]';

      const input: UpdateKBTaskInput = {
        text: taskText,
        answer: answer.trim() || null,
        solution: solution.trim() || null,
        exam: exam || null,
        answer_format: answerFormat || null,
      };

      // Only include attachment_url if it changed
      if (hasAttachmentChanges) {
        input.attachment_url = serializeAttachmentUrls(allRefs);
      }

      updateTask.mutate(
        { taskId: task.id, input },
        {
          onSuccess: () => {
            // Delete removed refs only after successful save
            for (const ref of removedRefsRef.current) {
              void deleteKBTaskImage(ref);
            }
            toast.success('Задача обновлена');
            onClose();
          },
          onError: () => {
            // Clean up orphan uploads — update failed
            for (const ref of uploadedRefs) void deleteKBTaskImage(ref);
            toast.error('Не удалось обновить задачу');
          },
        },
      );
    } catch {
      // Clean up refs already uploaded before the failure
      for (const ref of uploadedRefs) void deleteKBTaskImage(ref);
      toast.error('Не удалось загрузить изображение');
    } finally {
      setUploading(false);
    }
  };

  const isBusy = uploading || updateTask.isPending;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-[300] bg-black/40 animate-in fade-in-0"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed left-1/2 top-1/2 z-[301] flex max-h-[85vh] w-[440px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-xl animate-in fade-in-0 zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-socrat-border px-5 py-4">
          <h3 className="text-base font-semibold">Редактировать задачу</h3>
          <button type="button" onClick={onClose} className="shrink-0 p-1">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Content — drag-drop zone covers full scrollable area */}
        <div
          className="relative flex-1 space-y-4 overflow-auto px-5 py-4"
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {/* Drag overlay */}
          {isDragging && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-socrat-primary bg-socrat-primary/5">
              <div className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 shadow-md">
                <ImagePlus className="h-5 w-5 text-socrat-primary" />
                <span className="text-sm font-medium text-socrat-primary">
                  Отпустите для добавления
                </span>
              </div>
            </div>
          )}

          {/* Task text */}
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-slate-500">
              Условие задачи {!hasImage && <span className="text-red-500">*</span>}
            </legend>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={handlePaste}
              rows={4}
              placeholder={hasImage ? 'Описание (опционально — фото прикреплено)' : 'Введите условие задачи или вставьте скриншот...'}
              className="w-full resize-y rounded-lg border border-socrat-border px-3 py-2.5 text-[16px] leading-relaxed transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none"
            />
          </fieldset>

          {/* Image upload (multi-image) */}
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-slate-500">
              Фото задачи{totalImages > 0 ? ` (${totalImages}/${MAX_TASK_IMAGES})` : ` — до ${MAX_TASK_IMAGES}`}
            </legend>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileInput}
              className="hidden"
            />
            {totalImages > 0 ? (
              <div className={cn('space-y-2', isBusy && 'pointer-events-none opacity-60')}>
                <div className="flex flex-wrap gap-2">
                  {/* Existing images */}
                  {existingRefs.map((ref, idx) => {
                    const signedUrl = existingSignedUrls[ref];
                    return (
                      <div key={ref} className="relative">
                        {signedUrl ? (
                          <img
                            src={signedUrl}
                            alt={`Фото ${idx + 1}`}
                            className="h-24 w-24 rounded-lg border border-socrat-border object-cover"
                          />
                        ) : (
                          <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-socrat-border bg-socrat-surface">
                            <ImagePlus className="h-5 w-5 animate-pulse text-slate-300" />
                          </div>
                        )}
                        <button
                          type="button"
                          aria-label={`Удалить фото ${idx + 1}`}
                          onClick={() => handleRemoveExisting(ref)}
                          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-white shadow-md transition-colors hover:bg-red-500"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}

                  {/* New images */}
                  {newPreviewUrls.map((url, index) => (
                    <div key={`new-${index}`} className="relative">
                      <img
                        src={url}
                        alt={`Фото ${existingRefs.length + index + 1}`}
                        className="h-24 w-24 rounded-lg border border-socrat-border object-cover"
                      />
                      <button
                        type="button"
                        aria-label={`Удалить фото ${existingRefs.length + index + 1}`}
                        onClick={() => handleRemoveNew(index)}
                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-white shadow-md transition-colors hover:bg-red-500"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
                {totalImages < MAX_TASK_IMAGES && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs text-socrat-primary transition-colors hover:text-socrat-primary-dark"
                  >
                    Добавить ещё
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-lg border-[1.5px] border-dashed border-socrat-border bg-socrat-surface px-4 py-4 text-sm text-slate-500 transition-colors duration-200 hover:border-socrat-primary/40 hover:text-socrat-primary"
              >
                <ImagePlus className="h-4.5 w-4.5" />
                Прикрепить фото
              </button>
            )}
          </fieldset>

          {/* Exam + answer format row */}
          <div className="grid grid-cols-2 gap-3">
            <fieldset>
              <legend className="mb-1.5 text-xs font-semibold text-slate-500">Экзамен</legend>
              <select
                value={exam}
                onChange={(e) => setExam(e.target.value as ExamType | '')}
                className="w-full rounded-lg border border-socrat-border px-3 py-2 text-[16px] transition-colors duration-200 focus:border-socrat-primary/50 focus:outline-none"
              >
                <option value="">Не указан</option>
                <option value="ege">ЕГЭ</option>
                <option value="oge">ОГЭ</option>
              </select>
            </fieldset>

            <fieldset>
              <legend className="mb-1.5 text-xs font-semibold text-slate-500">Формат ответа</legend>
              <select
                value={answerFormat}
                onChange={(e) => setAnswerFormat(e.target.value)}
                className="w-full rounded-lg border border-socrat-border px-3 py-2 text-[16px] transition-colors duration-200 focus:border-socrat-primary/50 focus:outline-none"
              >
                <option value="">Не указан</option>
                <option value="number">Число</option>
                <option value="expression">Выражение</option>
                <option value="choice">Выбор</option>
                <option value="matching">Соответствие</option>
              </select>
            </fieldset>
          </div>

          {/* Answer */}
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-slate-500">Ответ</legend>
            <input
              type="text"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Правильный ответ"
              className="w-full rounded-lg border border-socrat-border px-3 py-2 text-[16px] transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none"
            />
          </fieldset>

          {/* Solution */}
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-slate-500">Решение / пояснение</legend>
            <textarea
              value={solution}
              onChange={(e) => setSolution(e.target.value)}
              rows={3}
              placeholder="Подробное решение (опционально)..."
              className="w-full resize-y rounded-lg border border-socrat-border px-3 py-2.5 text-[16px] leading-relaxed transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none"
            />
          </fieldset>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-socrat-border px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-socrat-border bg-transparent px-4 py-2 text-[13px] text-muted-foreground"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave || isBusy}
            className={cn(
              'rounded-lg px-4 py-2 text-[13px] font-semibold text-white',
              canSave && !isBusy
                ? 'bg-socrat-primary'
                : 'cursor-default bg-socrat-border',
            )}
          >
            {isBusy ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </div>
    </>
  );
}
