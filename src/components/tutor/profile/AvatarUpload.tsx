import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Camera, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/common/UserAvatar';

/**
 * AvatarUpload — file picker + canvas compression + preview for the tutor
 * profile avatar.
 *
 * Spec:    docs/delivery/features/tutor-profile/spec.md (v0.2 §5, §6)
 * Tasks:   docs/delivery/features/tutor-profile/tasks.md TASK-4
 * Depends: TASK-3 (UserAvatar) for the preview render.
 *
 * Pipeline (all client-side, no external libs):
 *   1. Reject file.size > 10 MB.
 *   2. URL.createObjectURL → <img>.onload → ctx.drawImage with centered
 *      square crop into a 512×512 canvas.
 *   3. canvas.toBlob('image/jpeg', q) walking quality 0.9 → 0.7 → 0.5
 *      until size ≤ 2 MB. Reject if no quality fits.
 *   4. Show optimistic preview from the blob and call onUpload(blob).
 *
 * Cross-browser notes (.claude/rules/80-cross-browser.md):
 *   - canvas.toBlob is wrapped in a Promise — Safari supports it natively.
 *   - URL.createObjectURL revoked in cleanup AND on every previewUrl change.
 *   - File input has accept= attribute; HEIC bypassing OS filter falls
 *     through to img.onerror and surfaces a friendly error.
 *   - EXIF rotation is intentionally not applied (parking lot in spec).
 */

export interface AvatarUploadProps {
  currentAvatarUrl: string | null;
  onUpload: (blob: Blob) => Promise<void>;
  onRemove: () => Promise<void>;
  isLoading?: boolean;
  gender?: 'male' | 'female' | null;
  name?: string;
}

const MAX_INPUT_BYTES = 10 * 1024 * 1024; // 10 MB hard cap before any work
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024; // 2 MB matches storage bucket limit
const TARGET_SIZE = 512;                  // px — square avatar
const QUALITY_LADDER: ReadonlyArray<number> = [0.9, 0.7, 0.5];
// Per ChatGPT-5.5 review ISSUE 1 — guard against decompression bombs that
// pass the 10 MB byte cap but expand to hundreds of MB in pixel buffer.
// 64 MP ≈ 8000×8000, generous for any phone camera (max common is 12 MP).
const MAX_INPUT_MEGAPIXELS = 64;
const MAX_INPUT_PIXELS = MAX_INPUT_MEGAPIXELS * 1_000_000;

export function AvatarUpload({
  currentAvatarUrl,
  onUpload,
  onRemove,
  isLoading = false,
  gender = null,
  name,
}: AvatarUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [internalBusy, setInternalBusy] = useState(false);
  const lastPersistedUrlRef = useRef<string | null>(currentAvatarUrl);

  const busy = internalBusy || isLoading;
  const effectiveAvatarUrl = previewUrl ?? currentAvatarUrl;

  // Revoke any local preview URL when it gets replaced or the component
  // unmounts. Standard pattern — cleanup runs before the next effect run.
  useEffect(() => {
    if (!previewUrl) return;
    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // When the parent's `currentAvatarUrl` finally reflects our upload (via
  // refetch), drop the local preview so the canonical URL takes over.
  useEffect(() => {
    if (currentAvatarUrl !== lastPersistedUrlRef.current) {
      lastPersistedUrlRef.current = currentAvatarUrl;
      setPreviewUrl(null);
    }
  }, [currentAvatarUrl]);

  const handleClickUpload = () => {
    if (busy) return;
    inputRef.current?.click();
  };

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Always reset input.value so picking the same file twice in a row works.
    if (event.target) event.target.value = '';
    if (!file) return;

    if (file.size > MAX_INPUT_BYTES) {
      toast.error('Файл слишком большой (до 10 МБ)');
      return;
    }

    setInternalBusy(true);

    let blob: Blob;
    try {
      blob = await compressToAvatar(file);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Не удалось обработать изображение. Попробуй другое.';
      toast.error(message);
      setInternalBusy(false);
      return;
    }

    const localPreview = URL.createObjectURL(blob);
    setPreviewUrl(localPreview);

    try {
      await onUpload(blob);
    } catch (err) {
      // Roll back optimistic preview on upload failure.
      URL.revokeObjectURL(localPreview);
      setPreviewUrl(null);
      const message =
        err instanceof Error ? err.message : 'Не удалось загрузить фото';
      toast.error(message);
    } finally {
      setInternalBusy(false);
    }
  };

  const handleRemove = async () => {
    if (busy) return;
    setInternalBusy(true);
    try {
      await onRemove();
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Не удалось удалить фото';
      toast.error(message);
    } finally {
      setInternalBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        <UserAvatar
          size="lg"
          avatarUrl={effectiveAvatarUrl}
          gender={gender}
          name={name}
        />
        {busy && (
          <div
            className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40"
            aria-hidden="true"
          >
            <Loader2 className="h-8 w-8 animate-spin text-white" />
          </div>
        )}
      </div>

      <div className="flex flex-col items-stretch gap-2 sm:flex-row">
        <Button
          type="button"
          onClick={handleClickUpload}
          disabled={busy}
          aria-label="Загрузить фото профиля"
          className="min-h-[44px] min-w-[160px] gap-2 bg-accent text-white hover:bg-accent/90"
        >
          <Camera className="h-4 w-4" aria-hidden="true" />
          Загрузить фото
        </Button>

        {currentAvatarUrl && (
          <Button
            type="button"
            variant="ghost"
            onClick={handleRemove}
            disabled={busy}
            aria-label="Удалить фото профиля"
            className="min-h-[44px] gap-2 text-slate-600 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Удалить
          </Button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileSelected}
        // Help screen readers / browsers identify the control even though
        // it's visually hidden — the visible <Button> drives it.
        aria-label="Выбрать файл изображения"
        tabIndex={-1}
      />
    </div>
  );
}

export default AvatarUpload;

// -----------------------------------------------------------------------------
// Helpers — kept module-private. Pure functions; no React deps.
// -----------------------------------------------------------------------------

async function compressToAvatar(file: File): Promise<Blob> {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(sourceUrl);
    const canvas = document.createElement('canvas');
    canvas.width = TARGET_SIZE;
    canvas.height = TARGET_SIZE;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Браузер не поддерживает обработку изображений.');
    }

    const naturalW = img.naturalWidth || img.width;
    const naturalH = img.naturalHeight || img.height;
    if (naturalW <= 0 || naturalH <= 0) {
      throw new Error('Не удалось прочитать изображение. Попробуй другое.');
    }
    // Decompression-bomb guard. 10 MB JPEG can decode to hundreds of MB
    // in pixel buffer and freeze iOS Safari before drawImage even runs.
    if (naturalW * naturalH > MAX_INPUT_PIXELS) {
      throw new Error(
        `Изображение слишком большое (${naturalW}×${naturalH}). Максимум — ${MAX_INPUT_MEGAPIXELS} мегапикселей (например, 8000×8000).`,
      );
    }

    // Centered square crop — pick the smaller dimension as the source square,
    // offset by half the difference of the larger dimension.
    const sourceSize = Math.min(naturalW, naturalH);
    const sx = (naturalW - sourceSize) / 2;
    const sy = (naturalH - sourceSize) / 2;

    try {
      ctx.drawImage(img, sx, sy, sourceSize, sourceSize, 0, 0, TARGET_SIZE, TARGET_SIZE);
    } catch {
      // Safari throws SecurityError on cross-origin / EXIF-rotated edge cases.
      throw new Error('Не удалось обработать изображение. Попробуй другое.');
    }

    // Walk the quality ladder. First blob that fits within 2 MB wins.
    for (const quality of QUALITY_LADDER) {
      let blob: Blob | null = null;
      try {
        blob = await canvasToBlob(canvas, 'image/jpeg', quality);
      } catch {
        // toBlob can throw on some Safari versions for very large canvases.
        continue;
      }
      if (blob && blob.size <= MAX_OUTPUT_BYTES) {
        return blob;
      }
    }

    throw new Error('Не удалось сжать фото до 2 МБ. Попробуй другое изображение.');
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(
        new Error('Не удалось прочитать изображение. Поддерживаются JPG, PNG и WebP.'),
      );
    img.src = src;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } catch (err) {
      reject(err);
    }
  });
}
