/**
 * Generic client-side image compression for upload. Used by tutor surfaces
 * (HWTaskCard / HWMaterialsSection / GuidedThreadViewer / paste handlers) and
 * by mock-exam photo uploads (see `mockExamPhotoCompress.ts` re-export).
 *
 * Two problems this solves:
 *
 * 1. Screenshot PNGs from clipboard are typically 5-15 MB. Without compression
 *    they bloat storage, slow uploads on RU connections, and exceed AI inline
 *    caps. JPEG re-encode at q≈0.8 + 2048px long side keeps formulas/handwriting
 *    readable while shrinking to ≤ 4 MB.
 *
 * 2. Defense against decompression bombs (e.g. tiny 10 MB PNG that decodes to
 *    a 64 MP image) — pixel cap rejects before `drawImage` blows up canvas
 *    memory.
 *
 * Algorithm:
 *   1. Pixel cap (8000×8000 = 64 MP) — reject before drawImage.
 *   2. Resize to long-side ≤ 2048 (preserve aspect ratio).
 *   3. Walk quality ladder 0.9 → 0.75 → 0.6 → 0.5 → first blob ≤ maxBytes wins.
 *
 * Returns `File` (not `Blob`) — preserves filename for FormData multipart.
 * Pass-through for non-image MIME (PDF etc.) and for already-small images.
 * HEIC/HEIF graceful fallback for desktop browsers (can't decode HEIC natively).
 */

const MAX_INPUT_MEGAPIXELS = 64;
const MAX_INPUT_PIXELS = MAX_INPUT_MEGAPIXELS * 1_000_000;
const MAX_LONG_SIDE_PX = 2048;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024; // 4 MB
const QUALITY_LADDER = [0.9, 0.75, 0.6, 0.5] as const;

export interface CompressOptions {
  /** Override max output bytes. Default 4 MB. */
  maxBytes?: number;
  /** Override max long-side pixels. Default 2048. */
  maxLongSide?: number;
}

/**
 * Compress a `File` (camera/gallery/screenshot image) to a smaller `File`
 * suitable for storage upload.
 *
 * - Non-image files (PDF, etc.) — pass through unchanged.
 * - Already-small images (`file.size <= maxBytes`) — pass through unchanged.
 * - HEIC/HEIF on desktop browsers (no native decode) — pass through unchanged;
 *   server accepts and tutor can review manually.
 * - Decompression bomb (> 64 MP) — throws user-facing Russian error.
 */
export async function compressForUpload(
  file: File,
  options: CompressOptions = {},
): Promise<File> {
  const maxBytes = options.maxBytes ?? MAX_OUTPUT_BYTES;
  const maxLongSide = options.maxLongSide ?? MAX_LONG_SIDE_PX;

  // PDF / non-image — pass through. Compression only for raster images.
  if (!file.type.startsWith('image/')) {
    return file;
  }

  // Already small — skip compression (avoid quality loss on cycles).
  if (file.size <= maxBytes) {
    return file;
  }

  // HEIC/HEIF graceful fallback. iPhone Safari can decode HEIC in <img>, but
  // desktop Chrome/Firefox/Edge cannot. Without fallback we'd break desktop
  // HEIC uploads client-side before server even sees the file. Server accepts
  // HEIC MIME; tutor reviews manually if file is too large.
  const isHeicLike = /heic|heif/i.test(file.type);

  const sourceUrl = URL.createObjectURL(file);
  try {
    let img: HTMLImageElement;
    try {
      img = await loadImage(sourceUrl);
    } catch (decodeErr) {
      if (isHeicLike) {
        console.warn('[imageCompression] HEIC decode failed, passing through original', {
          fileName: file.name,
          fileSize: file.size,
        });
        return file;
      }
      throw decodeErr;
    }
    const naturalW = img.naturalWidth || img.width;
    const naturalH = img.naturalHeight || img.height;
    if (naturalW <= 0 || naturalH <= 0) {
      if (isHeicLike) return file;
      throw new Error('Не удалось прочитать изображение. Попробуй другое.');
    }
    if (naturalW * naturalH > MAX_INPUT_PIXELS) {
      throw new Error(
        `Изображение слишком большое (${naturalW}×${naturalH}). Максимум — ${MAX_INPUT_MEGAPIXELS} мегапикселей.`,
      );
    }

    // Compute target dimensions preserving aspect ratio.
    const longSide = Math.max(naturalW, naturalH);
    const scale = longSide > maxLongSide ? maxLongSide / longSide : 1;
    const targetW = Math.round(naturalW * scale);
    const targetH = Math.round(naturalH * scale);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      if (isHeicLike) return file;
      throw new Error('Браузер не поддерживает обработку изображений.');
    }

    try {
      ctx.drawImage(img, 0, 0, naturalW, naturalH, 0, 0, targetW, targetH);
    } catch {
      if (isHeicLike) return file;
      throw new Error('Не удалось обработать изображение. Попробуй другое.');
    }

    // Walk quality ladder — first ≤ maxBytes wins.
    for (const quality of QUALITY_LADDER) {
      let blob: Blob | null = null;
      try {
        blob = await canvasToBlob(canvas, 'image/jpeg', quality);
      } catch {
        continue;
      }
      if (blob && blob.size <= maxBytes) {
        // Preserve original filename but force .jpg extension since we always
        // re-encode as JPEG.
        const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
        return new File([blob], `${baseName}.jpg`, {
          type: 'image/jpeg',
          lastModified: Date.now(),
        });
      }
    }

    if (isHeicLike) return file;
    throw new Error(
      `Не удалось сжать фото до ${(maxBytes / 1024 / 1024).toFixed(0)} МБ. Попробуй другое изображение.`,
    );
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error('Не удалось прочитать изображение. Поддерживаются JPG, PNG и WebP.'));
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
