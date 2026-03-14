import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { useUpdateTask } from '@/hooks/useKnowledgeBase';
import {
  deleteKBTaskImage,
  getKBImageSignedUrl,
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

  // Image state
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [existingRef, setExistingRef] = useState<string | null>(task.attachment_url);
  const [imageRemoved, setImageRemoved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const blobUrlRef = useRef<string | null>(null);

  // Load existing image preview via signed URL
  useEffect(() => {
    if (!task.attachment_url) return;
    let cancelled = false;

    void getKBImageSignedUrl(task.attachment_url).then((url) => {
      if (!cancelled && url) setPreviewUrl(url);
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

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  const handleFileSelect = useCallback((file: File) => {
    const error = validateImageFile(file);
    if (error) {
      toast.error(error);
      return;
    }
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);

    const url = URL.createObjectURL(file);
    blobUrlRef.current = url;
    setUploadedFile(file);
    setPreviewUrl(url);
    setImageRemoved(false);
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFileSelect(file);
      e.target.value = '';
    },
    [handleFileSelect],
  );

  const handleRemoveFile = useCallback(() => {
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    blobUrlRef.current = null;
    setUploadedFile(null);
    setPreviewUrl(null);
    setImageRemoved(true);
  }, []);

  // Image can replace text
  const hasImage = uploadedFile !== null || (existingRef !== null && !imageRemoved);
  const hasContent = text.trim().length > 0 || hasImage;
  const canSave = hasContent;

  const handleSave = async () => {
    if (!canSave) return;

    setUploading(true);
    try {
      let attachmentUrl: string | null | undefined;

      if (uploadedFile) {
        // New image uploaded — upload it
        const result = await uploadKBTaskImage(uploadedFile);
        attachmentUrl = result.storageRef;
      } else if (imageRemoved) {
        // Image was removed
        attachmentUrl = null;
      }
      // else: no change to attachment

      const oldRef = existingRef && (uploadedFile || imageRemoved) ? existingRef : null;

      const taskText = text.trim() || '[Задача на фото]';

      const input: UpdateKBTaskInput = {
        text: taskText,
        answer: answer.trim() || null,
        solution: solution.trim() || null,
        exam: exam || null,
        answer_format: answerFormat || null,
      };

      // Only include attachment_url if it changed
      if (attachmentUrl !== undefined) {
        input.attachment_url = attachmentUrl;
      }

      updateTask.mutate(
        { taskId: task.id, input },
        {
          onSuccess: () => {
            // Delete old image only after successful save
            if (oldRef) {
              void deleteKBTaskImage(oldRef);
            }
            toast.success('Задача обновлена');
            onClose();
          },
          onError: () => {
            toast.error('Не удалось обновить задачу');
          },
        },
      );
    } catch {
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

        {/* Content */}
        <div className="flex-1 space-y-4 overflow-auto px-5 py-4">
          {/* Task text */}
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-slate-500">
              Условие задачи {!hasImage && <span className="text-red-500">*</span>}
            </legend>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder={hasImage ? 'Описание (опционально — фото прикреплено)' : 'Введите условие задачи...'}
              className="w-full resize-y rounded-lg border border-socrat-border px-3 py-2.5 text-[16px] leading-relaxed transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none"
            />
          </fieldset>

          {/* Image upload */}
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-slate-500">Фото задачи</legend>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileInput}
              className="hidden"
            />
            {previewUrl ? (
              <div className="relative inline-block">
                <img
                  src={previewUrl}
                  alt="Превью"
                  className="max-h-40 rounded-lg border border-socrat-border object-contain"
                />
                <button
                  type="button"
                  onClick={handleRemoveFile}
                  className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-slate-700 text-white shadow-md transition-colors hover:bg-red-500"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-2 block text-xs text-socrat-primary transition-colors hover:text-socrat-primary-dark"
                >
                  Заменить фото
                </button>
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
