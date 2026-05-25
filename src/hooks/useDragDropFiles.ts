import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { compressForUpload, type CompressOptions } from '@/lib/imageCompression';

/**
 * Generic drag-and-drop file handler hook for tutor upload surfaces.
 *
 * Phase 9 (2026-05-25) sibling к `usePasteImages` — те же 4 surfaces (HWTaskCard
 * 3 секции + HWMaterialsSection) теперь принимают и paste (Ctrl+V) и drag-drop
 * для полного UX-parity. Это закрывает feedback репетитора-француза «в критериях
 * можно вставить через Ctrl+V, а перетащить — нельзя».
 *
 * Pattern source: `src/hooks/useImageUpload.ts:202-266` (KB ImageUploadField).
 * Extracted in own hook чтобы не тащить KB-specific validation / blob URL
 * management в homework-create UI.
 *
 * KEY DESIGN DECISIONS (mirror `usePasteImages`):
 *
 * 1. **Drag counter** (`dragCounterRef`) защищает от flicker при nested drag
 *    events. Без него overlay мигает на каждом hover'е child-элементов.
 *
 * 2. **isDragging boolean** для visual feedback (dashed border + overlay
 *    «Отпустите для добавления»). Callsite сам решает как рендерить.
 *
 * 3. **`preventDefault()` ОБЯЗАТЕЛЕН** на onDragOver — иначе browser default
 *    handler перехватит drop и попытается открыть файл (navigate to file URL).
 *
 * 4. **Multi-file accepted** — в отличие от paste (один файл из clipboard),
 *    drag-drop часто содержит несколько файлов. Hook отдаёт массив (отфильтрованный
 *    по MIME), callsite принимает все валидные.
 *
 * 5. **Lock check via `enabled` + `currentCount`/`maxFiles`.** Callsite сам
 *    передаёт actual upload state. Default `maxFiles=Infinity`, `currentCount=0`.
 *
 * 6. **Compression opt-in.** Mirror `usePasteImages.compress` — `true` = 4 MB /
 *    2048px JPEG defaults, custom `CompressOptions` или `false` (KB-style).
 *
 * @example
 *   const { dragHandlers, isDragging } = useDragDropFiles({
 *     enabled: !task.uploading,
 *     maxFiles: 5,
 *     currentCount: refs.length,
 *     onFilesDropped: (files) => addTaskPhotos(files),
 *     compress: true,
 *     telemetryTag: 'task',
 *   });
 *   <div {...dragHandlers} className={cn(isDragging && 'border-dashed border-accent')}>
 *     {isDragging && <DropOverlay />}
 *     ...
 *   </div>
 */
export interface UseDragDropFilesOptions {
  /**
   * Disable handler (e.g. during in-flight upload). When false, drop events
   * are ignored entirely.
   * @default true
   */
  enabled?: boolean;

  /**
   * Maximum total files allowed in this surface. Combined с `currentCount`
   * чтобы enforce cap.
   * @default Infinity
   */
  maxFiles?: number;

  /**
   * How many files are already attached. When `currentCount + dropped > maxFiles`,
   * берётся только первые (maxFiles - currentCount) files, остальные silent
   * + toast warning.
   * @default 0
   */
  currentCount?: number;

  /**
   * Allowed MIME prefixes/values. Matches `file.type.startsWith(prefix)`.
   * @default ['image/']
   */
  acceptedTypes?: string[];

  /**
   * Whether to run client-side compression before invoking `onFilesDropped`.
   * `true` → 4 MB / 2048px JPEG defaults; `CompressOptions` → custom; `false`
   * → skip (caller handles own pipeline).
   * @default false
   */
  compress?: boolean | CompressOptions;

  /**
   * Called с (possibly compressed) image Files после validation. Может быть
   * async — handler awaits до completion. Если throw — surface fallback toast.
   */
  onFilesDropped: (files: File[]) => void | Promise<void>;

  /**
   * Toast shown после `onFilesDropped` resolves. Pass `null` to suppress.
   * String → suffix appended " (N файлов)" если > 1. Default = singular/plural
   * автоматически.
   */
  successToast?: string | null;

  /**
   * Optional telemetry tag для `console.info('[drag-drop-image] <tag>', ...)`.
   * PII-free — только file sizes / count / tag. Pass `null` чтобы suppress.
   */
  telemetryTag?: string | null;
}

export interface UseDragDropFilesReturn {
  /** Spread на target `<div>` для активации drag-drop. */
  dragHandlers: {
    onDragEnter: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
  /** True когда файл hover'ит над dropzone — для visual feedback. */
  isDragging: boolean;
}

export function useDragDropFiles(opts: UseDragDropFilesOptions): UseDragDropFilesReturn {
  const {
    enabled = true,
    maxFiles = Infinity,
    currentCount = 0,
    acceptedTypes = ['image/'],
    compress = false,
    onFilesDropped,
    successToast = null,
    telemetryTag = null,
  } = opts;

  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const matchesAccepted = useCallback(
    (type: string) => acceptedTypes.some((prefix) => type.startsWith(prefix)),
    [acceptedTypes],
  );

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!enabled) return;
      // Only react to file drags (not text/html/element drags).
      if (!e.dataTransfer?.types?.includes('Files')) return;
      dragCounterRef.current += 1;
      setIsDragging(true);
    },
    [enabled],
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!enabled) return;
      dragCounterRef.current -= 1;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDragging(false);
      }
    },
    [enabled],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    // preventDefault is REQUIRED on onDragOver — без этого browser default
    // handler перехватит drop и navigate to file URL.
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragging(false);

      if (!enabled) return;

      const droppedFiles = Array.from(e.dataTransfer?.files ?? []);
      if (!droppedFiles.length) return;

      const validFiles: File[] = [];
      let skippedNonMatching = 0;
      for (const file of droppedFiles) {
        if (!matchesAccepted(file.type)) {
          skippedNonMatching += 1;
          continue;
        }
        validFiles.push(file);
      }

      if (validFiles.length === 0) {
        if (skippedNonMatching > 0) {
          toast.error('Можно перетащить только изображения (JPG, PNG, HEIC, WebP)');
        }
        return;
      }

      // Enforce maxFiles cap with currentCount.
      const remainingSlots = Math.max(0, maxFiles - currentCount);
      if (remainingSlots === 0) {
        toast.error(
          maxFiles === 1
            ? 'Можно прикрепить только одно фото — удали текущее, чтобы перетащить новое'
            : `Можно прикрепить максимум ${maxFiles} фото`,
        );
        return;
      }
      const trimmedFiles = validFiles.slice(0, remainingSlots);
      const droppedExtra = validFiles.length - trimmedFiles.length;

      const originalBytes = trimmedFiles.reduce((sum, f) => sum + f.size, 0);

      void (async () => {
        let filesToUpload = trimmedFiles;

        try {
          if (compress) {
            const compressOpts = typeof compress === 'object' ? compress : undefined;
            filesToUpload = await Promise.all(
              trimmedFiles.map((f) => compressForUpload(f, compressOpts)),
            );
          }
        } catch (err) {
          toast.error(
            err instanceof Error
              ? err.message
              : 'Не удалось сжать изображения. Попробуй другие.',
          );
          return;
        }

        if (telemetryTag) {
          const uploadBytes = filesToUpload.reduce((sum, f) => sum + f.size, 0);
          console.info(`[drag-drop-image] ${telemetryTag}`, {
            fileCount: filesToUpload.length,
            originalBytes,
            uploadBytes,
            compressed: uploadBytes < originalBytes,
            droppedExtra,
            skippedNonMatching,
          });
        }

        try {
          await onFilesDropped(filesToUpload);
          if (successToast !== null) {
            const msg =
              successToast ??
              (filesToUpload.length === 1
                ? 'Изображение добавлено'
                : `Добавлено изображений: ${filesToUpload.length}`);
            toast.success(msg);
          }
          if (droppedExtra > 0) {
            toast.warning(
              `Прикреплены ${trimmedFiles.length} фото. Остальные ${droppedExtra} не вошли в лимит.`,
            );
          }
        } catch (err) {
          console.error('[drag-drop-image] onFilesDropped threw', err);
          toast.error(
            err instanceof Error ? err.message : 'Не удалось добавить изображения.',
          );
        }
      })();
    },
    [
      enabled,
      maxFiles,
      currentCount,
      matchesAccepted,
      compress,
      onFilesDropped,
      successToast,
      telemetryTag,
    ],
  );

  return {
    dragHandlers: {
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDragOver: handleDragOver,
      onDrop: handleDrop,
    },
    isDragging,
  };
}
