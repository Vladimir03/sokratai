import { memo, useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Trash2,
  Loader2,
  Dices,
  Image as ImageIcon,
  X,
  Plus,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  uploadTutorHomeworkTaskImage,
  deleteTutorHomeworkTaskImage,
} from '@/lib/tutorHomeworkApi';
import { FullscreenImageCarousel } from '@/components/homework/shared/FullscreenImageCarousel';
import { useKBImagesSignedUrls } from '@/hooks/useKBImagesSignedUrls';
import {
  parseAttachmentUrls,
  serializeAttachmentUrls,
  MAX_TASK_IMAGES,
  MAX_RUBRIC_IMAGES,
} from '@/lib/attachmentRefs';

import { SourceBadge } from '@/components/kb/ui/SourceBadge';
import { type DraftTask, MAX_IMAGE_SIZE_BYTES, IMAGE_REQUIREMENTS_HINT, revokeObjectUrl } from './types';

// ─── Photo thumbnail (memoized) ──────────────────────────────────────────────

interface PhotoThumbnailProps {
  /** storage ref (used as stable key) */
  storageRef: string;
  /** Optional blob preview URL (set only for photos uploaded in current session) */
  previewUrl: string | null;
  /** Optional signed URL for persisted KB/edit-mode photos. */
  resolvedUrl?: string | null;
  index: number;
  onRemove: (index: number) => void;
  onOpenZoom: (index: number) => void;
}

const PhotoThumbnail = memo(function PhotoThumbnail({
  storageRef: _storageRef,
  previewUrl,
  resolvedUrl,
  index,
  onRemove,
  onOpenZoom,
}: PhotoThumbnailProps) {
  const imageUrl = previewUrl ?? resolvedUrl ?? null;

  return (
    <div className="relative group">
      {imageUrl ? (
        <button
          type="button"
          onClick={() => onOpenZoom(index)}
          aria-label={`Увеличить фото ${index + 1}`}
          title={`Увеличить фото ${index + 1}`}
          style={{ touchAction: 'manipulation' }}
          className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          <img
            src={imageUrl}
            alt={`Фото ${index + 1}`}
            loading="lazy"
            className="w-20 h-20 object-cover rounded-md border border-slate-200 bg-slate-50"
          />
        </button>
      ) : (
        <div className="w-20 h-20 rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center">
          <ImageIcon className="h-5 w-5 text-slate-400" aria-hidden="true" />
        </div>
      )}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRemove(index);
        }}
        aria-label={`Удалить фото ${index + 1}`}
        title={`Удалить фото ${index + 1}`}
        style={{ touchAction: 'manipulation' }}
        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-slate-900/80 text-white flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity hover:bg-slate-900 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <X className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
  );
});

// ─── Add photo button (memoized) ─────────────────────────────────────────────

interface AddPhotoButtonProps {
  disabled: boolean;
  isUploading: boolean;
  max: number;
  onClick: () => void;
}

const AddPhotoButton = memo(function AddPhotoButton({
  disabled,
  isUploading,
  max,
  onClick,
}: AddPhotoButtonProps) {
  const title = disabled
    ? `Максимум ${max} фото`
    : isUploading
      ? 'Загрузка...'
      : 'Добавить фото';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isUploading}
      aria-disabled={disabled || isUploading}
      title={title}
      style={{ touchAction: 'manipulation' }}
      className="w-20 h-20 rounded-md border-2 border-dashed border-slate-300 text-slate-500 flex flex-col items-center justify-center gap-1 transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-slate-300 disabled:hover:text-slate-500"
    >
      {isUploading ? (
        <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
      ) : (
        <Plus className="w-5 h-5" aria-hidden="true" />
      )}
      <span className="text-xs leading-tight">
        {isUploading ? 'Загрузка' : 'Добавить'}
      </span>
    </button>
  );
});

// ─── Photo gallery (task condition OR rubric) ─────────────────────────────────

interface PhotoGalleryProps {
  label: string;
  max: number;
  refs: string[];
  isUploading: boolean;
  /** Local blob preview URLs, keyed by storage ref. */
  previewUrls: Record<string, string>;
  /** Signed URLs for persisted storage refs, keyed by storage ref. */
  resolvedUrls: Record<string, string>;
  onAddFiles: (files: File[]) => void;
  onRemove: (index: number) => void;
  onOpenZoom: (index: number) => void;
}

function PhotoGallery({
  label,
  max,
  refs,
  isUploading,
  previewUrls,
  resolvedUrls,
  onAddFiles,
  onRemove,
  onOpenZoom,
}: PhotoGalleryProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const atLimit = refs.length >= max;

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      if (files.length) onAddFiles(files);
      if (inputRef.current) inputRef.current.value = '';
    },
    [onAddFiles],
  );

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      <div
        className="flex gap-2 flex-wrap"
        style={{ touchAction: 'pan-x' }}
      >
        {refs.map((ref, index) => (
          <PhotoThumbnail
            key={ref}
            storageRef={ref}
            previewUrl={previewUrls[ref] ?? null}
            resolvedUrl={resolvedUrls[ref] ?? null}
            index={index}
            onRemove={onRemove}
            onOpenZoom={onOpenZoom}
          />
        ))}
        <AddPhotoButton
          disabled={atLimit}
          isUploading={isUploading}
          max={max}
          onClick={() => inputRef.current?.click()}
        />
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        className="hidden"
        onChange={handleInputChange}
        disabled={atLimit || isUploading}
      />
    </div>
  );
}

// ─── Rubric field (collapsible) ───────────────────────────────────────────────

interface RubricFieldProps {
  value: string;
  onChange: (v: string) => void;
  rubricRefs: string[];
  isUploading: boolean;
  previewUrls: Record<string, string>;
  resolvedUrls: Record<string, string>;
  onAddRubricFiles: (files: File[]) => void;
  onRemoveRubricPhoto: (index: number) => void;
  onOpenRubricZoom: (index: number) => void;
}

function RubricField({
  value,
  onChange,
  rubricRefs,
  isUploading,
  previewUrls,
  resolvedUrls,
  onAddRubricFiles,
  onRemoveRubricPhoto,
  onOpenRubricZoom,
}: RubricFieldProps) {
  const [open, setOpen] = useState(Boolean(value) || rubricRefs.length > 0);
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Критерии проверки
      </button>
      {open && (
        <div className="space-y-3">
          <textarea
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[60px] resize-y"
            placeholder="Полное решение: 2 балла, только ответ: 1 балл, ошибка в знаке: минус 1 балл..."
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          <PhotoGallery
            label={`Фото критериев (до ${MAX_RUBRIC_IMAGES})`}
            max={MAX_RUBRIC_IMAGES}
            refs={rubricRefs}
            isUploading={isUploading}
            previewUrls={previewUrls}
            resolvedUrls={resolvedUrls}
            onAddFiles={onAddRubricFiles}
            onRemove={onRemoveRubricPhoto}
            onOpenZoom={onOpenRubricZoom}
          />
        </div>
      )}
    </div>
  );
}

// ─── Task card ────────────────────────────────────────────────────────────────

export interface HWTaskCardProps {
  task: DraftTask;
  index: number;
  onUpdate: (t: DraftTask) => void;
  onRemove: () => void;
  canRemove: boolean;
  /** When set, defer storage image deletes instead of executing immediately (edit mode safety) */
  onDeferImageDelete?: (storagePath: string) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
}

export function HWTaskCard({
  task,
  index,
  onUpdate,
  onRemove,
  canRemove,
  onDeferImageDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: HWTaskCardProps) {
  const taskRefs = useMemo(() => parseAttachmentUrls(task.task_image_path), [task.task_image_path]);
  const rubricRefs = useMemo(() => parseAttachmentUrls(task.rubric_image_paths), [task.rubric_image_paths]);

  // Local blob preview URLs keyed by storage ref (only for this-session uploads).
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [zoom, setZoom] = useState<{ gallery: 'task' | 'rubric'; index: number } | null>(null);
  // Ref mirrors created blob URLs so unmount cleanup sees the latest set (closure over [] would be stale).
  const blobUrlsRef = useRef<Set<string>>(new Set());
  const { urls: resolvedTaskUrls } = useKBImagesSignedUrls(taskRefs, { enabled: taskRefs.length > 0 });
  const { urls: resolvedRubricUrls } = useKBImagesSignedUrls(rubricRefs, { enabled: rubricRefs.length > 0 });
  const taskZoomItems = useMemo(
    () =>
      taskRefs
        .map((ref) => ({
          ref,
          url: previewUrls[ref] ?? resolvedTaskUrls[ref] ?? null,
        }))
        .filter((item): item is { ref: string; url: string } => Boolean(item.url)),
    [previewUrls, resolvedTaskUrls, taskRefs],
  );
  const rubricZoomItems = useMemo(
    () =>
      rubricRefs
        .map((ref) => ({
          ref,
          url: previewUrls[ref] ?? resolvedRubricUrls[ref] ?? null,
        }))
        .filter((item): item is { ref: string; url: string } => Boolean(item.url)),
    [previewUrls, resolvedRubricUrls, rubricRefs],
  );
  const taskZoomImages = useMemo(
    () => taskZoomItems.map((item) => item.url),
    [taskZoomItems],
  );
  const rubricZoomImages = useMemo(
    () => rubricZoomItems.map((item) => item.url),
    [rubricZoomItems],
  );
  const zoomImages = zoom?.gallery === 'rubric' ? rubricZoomImages : taskZoomImages;

  const openTaskZoom = useCallback(
    (refIndex: number) => {
      const ref = taskRefs[refIndex];
      const imageIndex = taskZoomItems.findIndex((item) => item.ref === ref);
      if (imageIndex >= 0) {
        setZoom({ gallery: 'task', index: imageIndex });
      }
    },
    [taskRefs, taskZoomItems],
  );

  const openRubricZoom = useCallback(
    (refIndex: number) => {
      const ref = rubricRefs[refIndex];
      const imageIndex = rubricZoomItems.findIndex((item) => item.ref === ref);
      if (imageIndex >= 0) {
        setZoom({ gallery: 'rubric', index: imageIndex });
      }
    },
    [rubricRefs, rubricZoomItems],
  );

  useEffect(() => {
    const urls = blobUrlsRef.current;
    return () => {
      urls.forEach((url) => revokeObjectUrl(url));
      urls.clear();
    };
  }, []);

  const uploadFiles = useCallback(
    async (
      files: File[],
      max: number,
      existingRefs: string[],
      onPreviewReady?: (tempRefs: string[], tempPreviews: Record<string, string>) => void,
      onPreviewError?: (tempRefs: string[]) => void,
    ): Promise<{
      newRefs: string[];
      newPreviews: Record<string, string>;
      tempRefs: string[];
      anyFallback: boolean;
    } | null> => {
      const remaining = max - existingRefs.length;
      if (remaining <= 0) {
        toast.warning(`Можно прикрепить максимум ${max} фото`);
        return null;
      }

      const truncated = files.slice(0, remaining);
      if (files.length > remaining) {
        toast.warning(`Можно прикрепить максимум ${max} фото — добавлено ${remaining}`);
      }

      const validFiles: File[] = [];
      for (const f of truncated) {
        if (f.size > MAX_IMAGE_SIZE_BYTES) {
          toast.error(`Файл «${f.name || 'без имени'}» больше 10 МБ`);
          continue;
        }
        validFiles.push(f);
      }
      if (!validFiles.length) return null;

      const blobUrls = validFiles.map((f) => URL.createObjectURL(f));
      const tempRefs = [...blobUrls];
      const tempPreviews = tempRefs.reduce<Record<string, string>>((acc, ref, index) => {
        acc[ref] = blobUrls[index];
        return acc;
      }, {});
      blobUrls.forEach((u) => blobUrlsRef.current.add(u));
      onPreviewReady?.(tempRefs, tempPreviews);
      try {
        const results = await Promise.all(validFiles.map((f) => uploadTutorHomeworkTaskImage(f)));
        const newRefs = results.map((r) => r.storageRef);
        const newPreviews: Record<string, string> = {};
        newRefs.forEach((ref, i) => {
          newPreviews[ref] = blobUrls[i];
        });
        const anyFallback = results.some((r) => r.usedFallback);
        return { newRefs, newPreviews, tempRefs, anyFallback };
      } catch (err) {
        blobUrls.forEach((u) => {
          revokeObjectUrl(u);
          blobUrlsRef.current.delete(u);
        });
        onPreviewError?.(tempRefs);
        toast.error(
          `Ошибка загрузки: ${err instanceof Error ? err.message : 'неизвестная ошибка'}. Попробуйте ещё раз.`,
        );
        return null;
      }
    },
    [],
  );

  const addTaskPhotos = useCallback(
    async (files: File[]) => {
      if (task.uploading) {
        toast.warning('Дождись завершения текущей загрузки.');
        return;
      }
      const currentRefs = parseAttachmentUrls(task.task_image_path);
      onUpdate({ ...task, uploading: true });
      const result = await uploadFiles(
        files,
        MAX_TASK_IMAGES,
        currentRefs,
        (tempRefs, tempPreviews) => {
          const optimisticRefs = [...currentRefs, ...tempRefs].slice(0, MAX_TASK_IMAGES);
          setPreviewUrls((prev) => ({ ...prev, ...tempPreviews }));
          onUpdate({
            ...task,
            task_image_path: serializeAttachmentUrls(optimisticRefs),
            uploading: true,
          });
        },
        (tempRefs) => {
          setPreviewUrls((prev) => {
            const next = { ...prev };
            tempRefs.forEach((ref) => {
              delete next[ref];
            });
            return next;
          });
        },
      );
      if (!result) {
        onUpdate({ ...task, uploading: false });
        return;
      }
      const combined = [...currentRefs, ...result.newRefs].slice(0, MAX_TASK_IMAGES);
      setPreviewUrls((prev) => {
        const next = { ...prev, ...result.newPreviews };
        result.tempRefs.forEach((ref) => {
          delete next[ref];
        });
        return next;
      });
      onUpdate({
        ...task,
        task_image_path: serializeAttachmentUrls(combined),
        uploading: false,
      });
      toast.success(
        result.newRefs.length === 1
          ? 'Изображение загружено'
          : `Загружено изображений: ${result.newRefs.length}`,
      );
      if (result.anyFallback) {
        toast.warning('Основной bucket недоступен, использован резервный канал загрузки.');
      }
    },
    [task, onUpdate, uploadFiles],
  );

  const addRubricPhotos = useCallback(
    async (files: File[]) => {
      if (task.uploading) {
        toast.warning('Дождись завершения текущей загрузки.');
        return;
      }
      const currentRefs = parseAttachmentUrls(task.rubric_image_paths);
      onUpdate({ ...task, uploading: true });
      const result = await uploadFiles(
        files,
        MAX_RUBRIC_IMAGES,
        currentRefs,
        (tempRefs, tempPreviews) => {
          const optimisticRefs = [...currentRefs, ...tempRefs].slice(0, MAX_RUBRIC_IMAGES);
          setPreviewUrls((prev) => ({ ...prev, ...tempPreviews }));
          onUpdate({
            ...task,
            rubric_image_paths: serializeAttachmentUrls(optimisticRefs),
            uploading: true,
          });
        },
        (tempRefs) => {
          setPreviewUrls((prev) => {
            const next = { ...prev };
            tempRefs.forEach((ref) => {
              delete next[ref];
            });
            return next;
          });
        },
      );
      if (!result) {
        onUpdate({ ...task, uploading: false });
        return;
      }
      const combined = [...currentRefs, ...result.newRefs].slice(0, MAX_RUBRIC_IMAGES);
      setPreviewUrls((prev) => {
        const next = { ...prev, ...result.newPreviews };
        result.tempRefs.forEach((ref) => {
          delete next[ref];
        });
        return next;
      });
      onUpdate({
        ...task,
        rubric_image_paths: serializeAttachmentUrls(combined),
        uploading: false,
      });
      toast.success(
        result.newRefs.length === 1
          ? 'Изображение загружено'
          : `Загружено изображений: ${result.newRefs.length}`,
      );
      if (result.anyFallback) {
        toast.warning('Основной bucket недоступен, использован резервный канал загрузки.');
      }
    },
    [task, onUpdate, uploadFiles],
  );

  const removePhoto = useCallback(
    (target: 'task' | 'rubric', idx: number) => {
      const field = target === 'task' ? 'task_image_path' : 'rubric_image_paths';
      const refs = parseAttachmentUrls(task[field]);
      const removedRef = refs[idx];
      if (!removedRef) return;

      if (onDeferImageDelete) {
        onDeferImageDelete(removedRef);
      } else {
        void deleteTutorHomeworkTaskImage(removedRef);
      }

      const preview = previewUrls[removedRef];
      if (preview) {
        revokeObjectUrl(preview);
        blobUrlsRef.current.delete(preview);
        setPreviewUrls((prev) => {
          const next = { ...prev };
          delete next[removedRef];
          return next;
        });
      }

      const nextRefs = refs.filter((_, i) => i !== idx);
      onUpdate({ ...task, [field]: serializeAttachmentUrls(nextRefs) });
    },
    [task, onUpdate, onDeferImageDelete, previewUrls],
  );

  const removeTaskPhoto = useCallback(
    (idx: number) => removePhoto('task', idx),
    [removePhoto],
  );
  const removeRubricPhoto = useCallback(
    (idx: number) => removePhoto('rubric', idx),
    [removePhoto],
  );

  const handleTaskTextPaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items?.length) return;

      const pastedImages: File[] = [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) pastedImages.push(f);
        }
      }
      if (!pastedImages.length) return;

      e.preventDefault();

      if (task.uploading) {
        toast.warning('Дождись завершения текущей загрузки.');
        return;
      }

      const currentRefs = parseAttachmentUrls(task.task_image_path);
      if (currentRefs.length >= MAX_TASK_IMAGES) {
        toast.warning(`Можно прикрепить максимум ${MAX_TASK_IMAGES} фото`);
        return;
      }

      void addTaskPhotos(pastedImages);
    },
    [task.uploading, task.task_image_path, addTaskPhotos],
  );

  return (
    <Card animate={false}>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5">
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onMoveUp} disabled={isFirst}
                aria-label="Переместить вверх">
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onMoveDown} disabled={isLast}
                aria-label="Переместить вниз">
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>
            <span className="text-sm font-medium text-muted-foreground">
              Задача {index + 1}
            </span>
            {task.kb_source && (
              <SourceBadge source={task.kb_source} />
            )}
          </div>
          {canRemove && (
            <Button variant="ghost" size="sm" onClick={onRemove}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>

        <div className="space-y-2">
          <Label>Текст задачи {taskRefs.length === 0 && <span className="text-red-500">*</span>}</Label>
          <textarea
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-[80px] resize-y"
            placeholder={taskRefs.length > 0 ? 'Описание (опционально — фото прикреплено)' : 'Условие задачи (можно вставить скриншот Ctrl+V)...'}
            value={task.task_text}
            onChange={(e) => onUpdate({ ...task, task_text: e.target.value })}
            onPaste={handleTaskTextPaste}
          />
        </div>

        {/* Task condition photos */}
        <PhotoGallery
          label={`Фото условия (до ${MAX_TASK_IMAGES})`}
          max={MAX_TASK_IMAGES}
          refs={taskRefs}
          isUploading={task.uploading}
          previewUrls={previewUrls}
          resolvedUrls={resolvedTaskUrls}
          onAddFiles={addTaskPhotos}
          onRemove={removeTaskPhoto}
          onOpenZoom={openTaskZoom}
        />
        <p className="text-xs text-muted-foreground">{IMAGE_REQUIREMENTS_HINT}</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Правильный ответ</Label>
            <Input
              placeholder="x=2, x=3"
              value={task.correct_answer}
              onChange={(e) =>
                onUpdate({ ...task, correct_answer: e.target.value })
              }
              className="text-base"
            />
          </div>
          <div className="space-y-2">
            <Label>
              Макс. баллов
              {task.kb_task_id && task.max_score > 1 && (
                <span className="ml-2 text-xs text-muted-foreground font-normal">из БЗ</span>
              )}
            </Label>
            <Input
              type="number"
              min={1}
              value={task.max_score}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                onUpdate({ ...task, max_score: isNaN(v) || v < 1 ? 1 : v });
              }}
              className="text-base"
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor={`check-format-${task.localId}`}>Формат проверки</Label>
          <select
            id={`check-format-${task.localId}`}
            value={task.check_format}
            onChange={(e) =>
              onUpdate({ ...task, check_format: e.target.value as 'short_answer' | 'detailed_solution' })
            }
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            style={{ fontSize: '16px', touchAction: 'manipulation' }}
          >
            <option value="short_answer">Краткий ответ</option>
            <option value="detailed_solution">Развёрнутое решение</option>
          </select>
          <p className="text-xs text-muted-foreground">
            {task.check_format === 'detailed_solution'
              ? 'AI потребует ход решения от ученика'
              : 'Число, слово или формула'}
          </p>
        </div>

        <RubricField
          value={task.rubric_text}
          onChange={(v) => onUpdate({ ...task, rubric_text: v })}
          rubricRefs={rubricRefs}
          isUploading={task.uploading}
          previewUrls={previewUrls}
          resolvedUrls={resolvedRubricUrls}
          onAddRubricFiles={addRubricPhotos}
          onRemoveRubricPhoto={removeRubricPhoto}
          onOpenRubricZoom={openRubricZoom}
        />

        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground"
          onClick={() => toast.info('Генерация вариаций — скоро будет!')}
        >
          <Dices className="h-4 w-4" />
          Вариации
        </Button>
        <FullscreenImageCarousel
          images={zoomImages}
          openIndex={zoom?.index ?? null}
          onClose={() => setZoom(null)}
          onNavigate={(nextIndex) => setZoom((current) => (current ? { ...current, index: nextIndex } : current))}
          ariaTitle={zoom?.gallery === 'rubric' ? 'Фото критериев' : 'Фото условия'}
          ariaDescription="Просмотр изображений задачи во весь экран"
        />
      </CardContent>
    </Card>
  );
}
