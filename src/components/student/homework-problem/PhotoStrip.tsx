import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ImageIcon, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  getStudentTaskImageSignedUrl,
  uploadStudentThreadImage,
  StudentHomeworkApiError,
} from '@/lib/studentHomeworkApi';
import { useIsMobile } from '@/hooks/useIsMobile';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'];
const HEIC_NAME_RX = /\.(heic|heif)$/i;

interface PhotoStripProps {
  /** `storage://...` refs already persisted via `uploadStudentThreadImage`. */
  photos: string[];
  /** Append a freshly-uploaded ref. Parent owns the array (no internal store). */
  onAdd: (ref: string) => void;
  /** Remove a ref. Parent decides whether to also delete the storage object. */
  onRemove: (ref: string) => void;
  /** Cap on total photos in the strip. Default 5 (mirrors MAX_TASK_IMAGES). */
  max?: number;
  /** Required for `uploadStudentThreadImage` storage path. */
  hwId: string;
  /** Required for `uploadStudentThreadImage` storage path (1-based). */
  taskOrder: number;
  /** Forwarded to `uploadStudentThreadImage` as third arg (legacy threadId). */
  threadId?: string;
  /** Disable add + remove while parent is mid-submit. */
  disabled?: boolean;
}

/**
 * Multi-page photo upload strip for the SubmitSheet.
 *
 * Tile metrics: 96×124 (96 thumbnail + 28 caption space). Horizontal scroll
 * with `touch-pan-x` so iOS Safari doesn't swallow swipe via row click.
 *
 * Source picker (2026-05-12):
 *   - Strip add-tile (dashed border, camera icon) → `galleryInputRef`
 *     (no `capture` → native OS picker shows camera + gallery + files on
 *     iOS; opens gallery / file browser on Android / desktop).
 *   - **Mobile only** (`useIsMobile`): explicit `[Камера]` + `[Из галереи]`
 *     buttons below the strip. Camera button uses `capture="environment"`
 *     to force rear camera — Android Chrome's native picker doesn't
 *     reliably surface camera as a top-level option for `image/*`, this
 *     gives a consistent cross-platform UX. Per Vladimir 2026-05-12.
 *   - Tablet/desktop: only the strip tile is rendered — explicit source
 *     buttons would be noise (desktop ignores `capture`, no camera UX).
 *
 * Thumbnails are resolved via `getStudentTaskImageSignedUrl` lazily and
 * cached in component state. We tolerate failed resolves silently — fallback
 * is the page-number badge over an empty thumb.
 */
export function PhotoStrip({
  photos,
  onAdd,
  onRemove,
  max = 5,
  hwId,
  taskOrder,
  threadId = '',
  disabled = false,
}: PhotoStripProps) {
  // Two hidden inputs on mobile (2026-05-12): explicit `[Камера]` /
  // `[Из галереи]` buttons under the strip. Native iOS sheet shows both
  // options for `accept="image/*"` without capture, but Android Chrome's
  // picker is inconsistent. Explicit buttons give a discoverable, cross-
  // platform UX. On tablet/desktop the strip tile uses the gallery input
  // directly (no capture) — desktop has no camera workflow.
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  const [thumbUrls, setThumbUrls] = useState<Record<string, string | null>>({});
  const [uploadingCount, setUploadingCount] = useState(0);

  // Resolve signed URLs for refs we haven't seen yet. Cleanup on unmount is
  // not strictly needed (signed URLs auto-expire) — we just clear local map.
  useEffect(() => {
    let cancelled = false;
    const unresolved = photos.filter((ref) => thumbUrls[ref] === undefined);
    if (unresolved.length === 0) return;

    Promise.all(
      unresolved.map(async (ref) => {
        const url = await getStudentTaskImageSignedUrl(ref).catch(() => null);
        return [ref, url] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setThumbUrls((prev) => {
        const next = { ...prev };
        for (const [ref, url] of entries) {
          if (next[ref] === undefined) next[ref] = url;
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [photos, thumbUrls]);

  const handleFiles = useCallback(
    async (fileList: FileList) => {
      const slots = max - photos.length;
      if (slots <= 0) {
        toast.error(`Можно прикрепить максимум ${max} фото`);
        return;
      }

      const queued: File[] = [];
      for (let i = 0; i < fileList.length && queued.length < slots; i++) {
        const file = fileList[i];
        const isHeicByName = HEIC_NAME_RX.test(file.name);
        if (!ALLOWED_TYPES.includes(file.type) && !isHeicByName) {
          toast.error('Поддерживаются: JPG, PNG, HEIC, WebP');
          continue;
        }
        queued.push(file);
      }

      if (fileList.length > slots) {
        toast.info(`Добавлено ${queued.length} из ${fileList.length} — лимит ${max} фото`);
      }

      if (queued.length === 0) return;

      setUploadingCount((c) => c + queued.length);
      try {
        // Upload sequentially — backend storage path uses a per-file UUID, so
        // ordering only matters for the order in which we call onAdd. This
        // also keeps the UI count predictable as each upload finishes.
        for (const file of queued) {
          try {
            const ref = await uploadStudentThreadImage(file, hwId, threadId, taskOrder);
            onAdd(ref);
          } catch (err) {
            const msg =
              err instanceof StudentHomeworkApiError
                ? err.message
                : 'Не удалось загрузить фото';
            toast.error(msg);
          }
        }
      } finally {
        setUploadingCount((c) => Math.max(0, c - queued.length));
      }
    },
    [hwId, max, onAdd, photos.length, taskOrder, threadId],
  );

  const handleGalleryClick = useCallback(() => {
    if (disabled) return;
    galleryInputRef.current?.click();
  }, [disabled]);

  const handleCameraClick = useCallback(() => {
    if (disabled) return;
    cameraInputRef.current?.click();
  }, [disabled]);

  const onChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) await handleFiles(files);
      // Allow re-selecting the same file without remounting the input.
      e.target.value = '';
    },
    [handleFiles],
  );

  const canAddMore = photos.length + uploadingCount < max && !disabled;

  return (
    <div className="flex flex-col gap-2">
      {/* Gallery input — no `capture`. iOS Safari shows native picker
          («Photo Library / Take Photo / Choose Files»). Android Chrome
          opens gallery / file browser. Tablet/desktop tile uses this
          input directly via `handleGalleryClick`. Mobile «Из галереи»
          button also uses it. */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={onChange}
        aria-hidden="true"
      />
      {/* Camera input — `capture="environment"` forces rear camera on
          mobile. Mobile-only — desktop browsers ignore `capture` (no-op).
          Triggered via the explicit «Камера» button below the strip on
          mobile (2026-05-12 fix per Vladimir request — Android Chrome
          native picker doesn't reliably surface camera as an option for
          `image/*` inputs, explicit button solves cross-platform). */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onChange}
        aria-hidden="true"
      />

      <div
        className="flex gap-2 overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden"
        role="list"
        aria-label="Страницы решения"
      >
        {photos.map((ref, index) => {
          const url = thumbUrls[ref];
          const pageNo = index + 1;
          return (
            <div
              key={ref}
              role="listitem"
              className="relative flex flex-col items-center gap-1 w-24 shrink-0"
            >
              <div className="relative w-24 h-24 rounded-[10px] overflow-hidden bg-socrat-surface border border-socrat-border-light grid place-items-center">
                {url ? (
                  <img
                    src={url}
                    alt={`Страница ${pageNo}`}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Loader2
                    className="h-5 w-5 text-socrat-muted animate-spin"
                    aria-hidden="true"
                  />
                )}
                <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-full bg-slate-900/70 text-white text-[10px] font-bold tabular-nums">
                  {pageNo}
                </span>
                <button
                  type="button"
                  onClick={() => !disabled && onRemove(ref)}
                  disabled={disabled}
                  aria-label={`Удалить страницу ${pageNo}`}
                  className="absolute top-1.5 right-1.5 grid place-items-center w-[22px] h-[22px] rounded-full bg-slate-900/70 hover:bg-red-600 text-white touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <X className="h-3 w-3 stroke-[2.5]" aria-hidden="true" />
                </button>
              </div>
              <span className="text-[11px] text-socrat-muted text-center">
                Стр. {pageNo}
              </span>
            </div>
          );
        })}

        {Array.from({ length: uploadingCount }).map((_, i) => (
          <div
            key={`uploading-${i}`}
            role="listitem"
            className="relative flex flex-col items-center gap-1 w-24 shrink-0"
          >
            <div className="relative w-24 h-24 rounded-[10px] bg-socrat-surface border border-socrat-border-light grid place-items-center">
              <Loader2 className="h-6 w-6 text-socrat-primary animate-spin" aria-hidden="true" />
            </div>
            <span className="text-[11px] text-socrat-muted text-center">Загрузка…</span>
          </div>
        ))}

        {canAddMore && (
          <button
            type="button"
            onClick={handleGalleryClick}
            aria-label={photos.length === 0 ? 'Добавить страницу' : 'Добавить ещё страницу'}
            className="relative flex flex-col items-center justify-center gap-1.5 w-24 h-[124px] shrink-0 rounded-[10px] border-2 border-dashed border-socrat-border bg-white text-socrat-muted hover:border-socrat-primary hover:text-socrat-primary touch-manipulation transition-colors"
          >
            <Camera className="h-[22px] w-[22px]" aria-hidden="true" />
            <span className="text-[11px] font-semibold leading-tight text-center px-1">
              {photos.length === 0 ? 'Добавить' : 'Ещё страница'}
            </span>
          </button>
        )}
      </div>

      {/* Mobile-only explicit source buttons (2026-05-12 per design handoff
          §PhotoStrip line 197). На iOS native picker `accept="image/*"`
          уже показывает choice, но Android Chrome не всегда — explicit
          buttons дают консистентный cross-platform UX. На tablet/desktop
          кнопки скрыты — там dashed-тайл выше уже открывает picker
          (desktop камера-input no-op anyway). */}
      {isMobile && canAddMore ? (
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={handleCameraClick}
            aria-label="Сфотографировать решение камерой"
            className="flex-1 inline-flex items-center justify-center gap-2 h-11 px-3 rounded-xl bg-white border border-socrat-border text-slate-700 text-sm font-semibold hover:bg-socrat-surface hover:border-socrat-primary hover:text-socrat-primary touch-manipulation transition-colors"
          >
            <Camera className="h-4 w-4" aria-hidden="true" />
            <span>Камера</span>
          </button>
          <button
            type="button"
            onClick={handleGalleryClick}
            aria-label="Выбрать фото из галереи"
            className="flex-1 inline-flex items-center justify-center gap-2 h-11 px-3 rounded-xl bg-white border border-socrat-border text-slate-700 text-sm font-semibold hover:bg-socrat-surface hover:border-socrat-primary hover:text-socrat-primary touch-manipulation transition-colors"
          >
            <ImageIcon className="h-4 w-4" aria-hidden="true" />
            <span>Из галереи</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
