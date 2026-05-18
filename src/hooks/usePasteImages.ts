import { useCallback } from 'react';
import { toast } from 'sonner';
import { compressForUpload, type CompressOptions } from '@/lib/imageCompression';

/**
 * Generic paste-image handler hook for tutor upload surfaces.
 *
 * Mirrors the canonical patterns from:
 * - `src/components/student/homework-problem/SubmitSheet.tsx` (Phase 3.1 Bug #2)
 * - `src/components/homework/GuidedChatInput.tsx:507-560` (Phase 5.1 mobile)
 * - `src/hooks/useImageUpload.ts:179-200` (KB)
 *
 * Returns a `React.ClipboardEventHandler` that callsites attach to whichever
 * element should accept the paste (textarea, gallery container, Card root,
 * Dialog content, etc.). Text paste in textareas remains native — we only
 * `preventDefault()` when a valid image is detected and accepted.
 *
 * KEY DESIGN DECISIONS:
 *
 * 1. **Dual-path file detection.** Chrome/Edge populate `clipboardData.files`;
 *    Safari/Firefox sometimes only populate `clipboardData.items` and require
 *    `item.getAsFile()`. Handler tries both.
 *
 * 2. **`preventDefault()` ONLY on accepted image.** Text paste must remain
 *    native to preserve typing UX. If MIME doesn't match `acceptedTypes`, the
 *    handler is a no-op and the browser handles the paste normally.
 *
 * 3. **Compression before invoking caller.** When `compress=true` (default
 *    for screenshots), the file is compressed to ≤ 4 MB / 2048px via
 *    `compressForUpload` before `onImagePasted` is called. Caller doesn't need
 *    to know about compression. HEIC fallback is automatic (see
 *    `imageCompression.ts`).
 *
 * 4. **Lock check via `enabled` + `currentCount`/`maxFiles`.** Callsite is
 *    responsible for passing actual upload state. Default `maxFiles=Infinity`
 *    means no count cap; `currentCount` defaults to 0.
 *
 * 5. **Single-file paste per event.** Clipboard typically contains one image
 *    at a time. If multiple images present, only the first matching MIME is
 *    accepted (rest ignored silently — multi-image clipboard is an edge case
 *    that doesn't justify confusing UX).
 *
 * @example
 *   const handlePaste = usePasteImages({
 *     enabled: !task.uploading,
 *     maxFiles: 5,
 *     currentCount: refs.length,
 *     onImagePasted: (file) => addTaskPhotos([file]),
 *     compress: true,
 *   });
 *   <CardContent onPaste={handlePaste}>...</CardContent>
 */
export interface UsePasteImagesOptions {
  /**
   * Disable handler (e.g. during in-flight upload). When false, paste events
   * are ignored — text paste continues to work natively.
   * @default true
   */
  enabled?: boolean;

  /**
   * Maximum total files allowed in this surface. Combined with `currentCount`
   * to enforce the cap.
   * @default Infinity
   */
  maxFiles?: number;

  /**
   * How many files are already attached. When `currentCount >= maxFiles`,
   * paste shows a toast and skips.
   * @default 0
   */
  currentCount?: number;

  /**
   * Allowed MIME prefixes/values. Matches `file.type.startsWith(prefix)`.
   * @default ['image/']
   */
  acceptedTypes?: string[];

  /**
   * Whether to run client-side compression before invoking `onImagePasted`.
   * Pass `true` for 4 MB / 2048px JPEG defaults, or a `CompressOptions` object
   * to customise. Pass `false` to skip compression (e.g. avatar with its own
   * pipeline, or KB where formula clarity matters).
   * @default false
   */
  compress?: boolean | CompressOptions;

  /**
   * Called with the (possibly compressed) image File once validated. Can be
   * async — handler awaits before completion but does NOT block subsequent
   * paste events.
   */
  onImagePasted: (file: File) => void | Promise<void>;

  /**
   * Toast shown after `onImagePasted` resolves. Pass `null` to suppress.
   * @default 'Изображение вставлено'
   */
  successToast?: string | null;

  /**
   * Optional telemetry tag for `console.info('[paste-image] <tag>', ...)`.
   * PII-free — only file sizes and tag are logged. Pass `null` to suppress.
   */
  telemetryTag?: string | null;
}

export function usePasteImages(opts: UsePasteImagesOptions): React.ClipboardEventHandler {
  const {
    enabled = true,
    maxFiles = Infinity,
    currentCount = 0,
    acceptedTypes = ['image/'],
    compress = false,
    onImagePasted,
    successToast = 'Изображение вставлено',
    telemetryTag = null,
  } = opts;

  return useCallback(
    (e: React.ClipboardEvent) => {
      if (!enabled) return;

      // Dual-path file detection (Chrome/Edge vs Safari/Firefox).
      let pasted: File | null = null;
      const matchesAccepted = (type: string) =>
        acceptedTypes.some((prefix) => type.startsWith(prefix));

      const files = Array.from(e.clipboardData?.files ?? []);
      pasted = files.find((f) => matchesAccepted(f.type)) ?? null;

      if (!pasted && e.clipboardData?.items) {
        for (const item of e.clipboardData.items) {
          if (item.kind !== 'file') continue;
          if (!matchesAccepted(item.type)) continue;
          const file = item.getAsFile();
          if (file) {
            pasted = file;
            break;
          }
        }
      }

      // No matching file — let native paste (text) proceed.
      if (!pasted) return;

      // From here we own the event.
      e.preventDefault();

      if (currentCount >= maxFiles) {
        toast.error(
          maxFiles === 1
            ? 'Можно прикрепить только одно фото — удали текущее, чтобы вставить новое'
            : `Можно прикрепить максимум ${maxFiles} фото`,
        );
        return;
      }

      const originalBytes = pasted.size;

      void (async () => {
        let fileToUpload = pasted as File;
        try {
          if (compress) {
            const compressOpts = typeof compress === 'object' ? compress : undefined;
            fileToUpload = await compressForUpload(pasted as File, compressOpts);
          }
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : 'Не удалось сжать изображение. Попробуй другое.',
          );
          return;
        }

        if (telemetryTag) {
          console.info(`[paste-image] ${telemetryTag}`, {
            originalBytes,
            uploadBytes: fileToUpload.size,
            compressed: fileToUpload.size < originalBytes,
            type: fileToUpload.type,
          });
        }

        try {
          await onImagePasted(fileToUpload);
          if (successToast) toast.success(successToast);
        } catch (err) {
          // Caller's onImagePasted typically owns its own toast/error UI, but
          // if it throws unexpectedly we surface a generic fallback.
          console.error('[paste-image] onImagePasted threw', err);
          toast.error(
            err instanceof Error ? err.message : 'Не удалось вставить изображение.',
          );
        }
      })();
    },
    [
      enabled,
      maxFiles,
      currentCount,
      acceptedTypes,
      compress,
      onImagePasted,
      successToast,
      telemetryTag,
    ],
  );
}

