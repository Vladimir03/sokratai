import { useCallback, useEffect, useRef, useState } from 'react';
import { Folder, ImagePlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { useFolderTree } from '@/hooks/useFolders';
import { useCreateTask } from '@/hooks/useKnowledgeBase';
import {
  deleteKBTaskImage,
  MAX_TASK_IMAGES,
  serializeAttachmentUrls,
  uploadKBTaskImage,
  validateImageFile,
} from '@/lib/kbApi';
import { cn } from '@/lib/utils';
import type { ExamType, KBFolderTreeNode } from '@/types/kb';

interface CreateTaskModalProps {
  /** Pre-selected folder id (e.g. current folder on FolderPage) */
  defaultFolderId?: string;
  onClose: () => void;
}

export function CreateTaskModal({ defaultFolderId, onClose }: CreateTaskModalProps) {
  const { tree, loading: treesLoading } = useFolderTree();
  const createTask = useCreateTask();

  const [folderId, setFolderId] = useState<string | null>(defaultFolderId ?? null);
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState('');
  const [solution, setSolution] = useState('');
  const [exam, setExam] = useState<ExamType | ''>('');
  const [answerFormat, setAnswerFormat] = useState('');

  // Multi-image upload state
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Refs for synchronous access (avoids stale closures when adding multiple files at once)
  const filesRef = useRef<File[]>([]);
  const blobUrlsRef = useRef<string[]>([]);
  const dragCounterRef = useRef(0);

  // Auto-select defaultFolderId when tree loads
  useEffect(() => {
    if (defaultFolderId && !folderId) {
      setFolderId(defaultFolderId);
    }
  }, [defaultFolderId, folderId]);

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
      for (const url of blobUrlsRef.current) URL.revokeObjectURL(url);
    };
  }, []);

  /**
   * Add a single file to the upload list.
   * Uses refs for synchronous count tracking (safe for rapid sequential calls).
   * Returns true if accepted, false if rejected.
   */
  const handleFileSelect = useCallback((file: File): boolean => {
    const error = validateImageFile(file);
    if (error) {
      toast.error(error);
      return false;
    }

    if (filesRef.current.length >= MAX_TASK_IMAGES) {
      toast.error(`Максимум ${MAX_TASK_IMAGES} изображений`);
      return false;
    }

    const url = URL.createObjectURL(file);
    filesRef.current = [...filesRef.current, file];
    blobUrlsRef.current = [...blobUrlsRef.current, url];

    setUploadedFiles([...filesRef.current]);
    setPreviewUrls([...blobUrlsRef.current]);
    return true;
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files?.length) return;

      for (const file of Array.from(files)) {
        handleFileSelect(file);
      }

      // Reset input so the same file(s) can be re-selected
      e.target.value = '';
    },
    [handleFileSelect],
  );

  const handleRemoveFile = useCallback((index: number) => {
    const urlToRevoke = blobUrlsRef.current[index];
    if (urlToRevoke) URL.revokeObjectURL(urlToRevoke);

    filesRef.current = filesRef.current.filter((_, i) => i !== index);
    blobUrlsRef.current = blobUrlsRef.current.filter((_, i) => i !== index);

    setUploadedFiles([...filesRef.current]);
    setPreviewUrls([...blobUrlsRef.current]);
  }, []);

  // Paste image from clipboard on textarea
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (uploading || createTask.isPending) return;
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
      // Text paste — let default behavior proceed
    },
    [handleFileSelect, uploading, createTask.isPending],
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

      if (uploading || createTask.isPending) return;

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
    [handleFileSelect, uploading, createTask.isPending],
  );

  // Image can replace text: valid if (text OR image) AND folder
  const hasContent = text.trim().length > 0 || uploadedFiles.length > 0;
  const canSave = hasContent && folderId !== null;

  const handleSave = async () => {
    if (!canSave || !folderId) return;

    setUploading(true);
    const uploadedRefs: string[] = [];
    try {
      // Upload all images (track refs for cleanup on failure)
      if (uploadedFiles.length > 0) {
        for (const file of uploadedFiles) {
          const result = await uploadKBTaskImage(file);
          uploadedRefs.push(result.storageRef);
        }
      }

      const attachmentUrl = serializeAttachmentUrls(uploadedRefs) ?? undefined;

      // If no text but image attached, use placeholder
      const taskText = text.trim() || '[Задача на фото]';

      createTask.mutate(
        {
          folder_id: folderId,
          text: taskText,
          answer: answer.trim() || undefined,
          solution: solution.trim() || undefined,
          exam: exam || undefined,
          answer_format: answerFormat || undefined,
          attachment_url: attachmentUrl,
        },
        {
          onSuccess: () => {
            toast.success('Задача создана');
            onClose();
          },
          onError: () => {
            // Clean up orphan uploads — task creation failed
            for (const ref of uploadedRefs) void deleteKBTaskImage(ref);
            toast.error('Не удалось создать задачу');
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

  const isBusy = uploading || createTask.isPending;

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
          <h3 className="text-base font-semibold">Новая задача</h3>
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
          {/* Folder select */}
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-slate-500">
              Папка <span className="text-red-500">*</span>
            </legend>
            <div className="max-h-36 overflow-auto rounded-lg border border-socrat-border">
              {treesLoading ? (
                <div className="space-y-1.5 px-2 py-2">
                  {[1, 2].map((i) => (
                    <div key={i} className="h-8 animate-pulse rounded bg-socrat-border-light" />
                  ))}
                </div>
              ) : tree.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-socrat-muted">
                  Нет папок. Создайте папку в «Моя база».
                </div>
              ) : (
                <div className="py-1">
                  {renderFolderOptions(tree, 0, folderId, setFolderId)}
                </div>
              )}
            </div>
          </fieldset>

          {/* Task text */}
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-slate-500">
              Условие задачи {uploadedFiles.length === 0 && <span className="text-red-500">*</span>}
            </legend>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={handlePaste}
              rows={4}
              placeholder={uploadedFiles.length > 0 ? 'Описание (опционально — фото прикреплено)' : 'Введите условие задачи или вставьте скриншот...'}
              className="w-full resize-y rounded-lg border border-socrat-border px-3 py-2.5 text-[16px] leading-relaxed transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none"
            />
          </fieldset>

          {/* Image upload (multi-image) */}
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-slate-500">
              Фото задачи{uploadedFiles.length > 0 ? ` (${uploadedFiles.length}/${MAX_TASK_IMAGES})` : ` — до ${MAX_TASK_IMAGES}`}
            </legend>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileInput}
              className="hidden"
            />
            {previewUrls.length > 0 ? (
              <div className={cn('space-y-2', isBusy && 'pointer-events-none opacity-60')}>
                <div className="flex flex-wrap gap-2">
                  {previewUrls.map((url, index) => (
                    <div key={index} className="relative">
                      <img
                        src={url}
                        alt={`Фото ${index + 1}`}
                        className="h-24 w-24 rounded-lg border border-socrat-border object-cover"
                      />
                      <button
                        type="button"
                        aria-label={`Удалить фото ${index + 1}`}
                        onClick={() => handleRemoveFile(index)}
                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-white shadow-md transition-colors hover:bg-red-500"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
                {uploadedFiles.length < MAX_TASK_IMAGES && (
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

function renderFolderOptions(
  nodes: KBFolderTreeNode[],
  depth: number,
  selectedId: string | null,
  setSelectedId: (id: string) => void,
) {
  return nodes.map((node) => (
    <div key={node.id}>
      <button
        type="button"
        onClick={() => setSelectedId(node.id)}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px]',
          selectedId === node.id
            ? 'bg-socrat-primary-light font-semibold'
            : 'hover:bg-socrat-surface',
        )}
        style={{ paddingLeft: 12 + depth * 18 }}
      >
        <Folder
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            selectedId === node.id ? 'text-socrat-primary' : 'text-socrat-folder',
          )}
        />
        <span>{node.name}</span>
      </button>
      {node.children.length > 0 &&
        renderFolderOptions(node.children, depth + 1, selectedId, setSelectedId)}
    </div>
  ));
}
