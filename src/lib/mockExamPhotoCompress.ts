/**
 * Phase 6 (2026-05-15) review-fix P2 #1 — client-side photo compression
 * для mock-exam uploads. Защита от двух проблем:
 *
 * 1. Real phone photos = 3-8 MB. Upload cap = 10 MB. AI inline cap = 5 MB.
 *    Без compression 4-5 из 7 фото отбрасываются на сервер inline →
 *    AI bulk assignment incomplete → fallback `photo_missing`.
 *
 * 2. Pass 1 prompt с 7 × 8 MB inlined = ~56 MB total → Lovable Gateway
 *    timeout или memory blowup.
 *
 * Target: ≤ 4 MB JPEG, max long side 2048px (Gemini читает фото 1024-2048px
 * detail без потери качества OCR). Preserve aspect ratio.
 *
 * Algorithm (mirrors `AvatarUpload::compressToAvatar`):
 *   1. Pixel cap (8000×8000 = 64 MP) для защиты от decompression bombs.
 *   2. Resize до long-side ≤ 2048 (preserve aspect).
 *   3. Walk quality ladder 0.9 → 0.75 → 0.6 → 0.5 → first blob ≤ 4 MB wins.
 *
 * Returns `File` (not `Blob`) — сохраняет filename для FormData multipart.
 * Если compression failed (огромное изображение / Safari quirks) → throws
 * Error with user-facing Russian message.
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
 * Compress a `File` (camera/gallery image) to a smaller `File` suitable for
 * mock-exam photo uploads. Non-image files (PDF) — pass through unchanged.
 * Already-small images (< maxBytes AND ≤ maxLongSide) — pass through unchanged.
 */
export async function compressMockExamPhoto(
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
    // Still need to check dimensions — small file can be 8000×8000 tiny PNG.
    // But probabilistically не стоит decoding ради edge case. Pass through.
    return file;
  }

  // Round 3 review-fix P2 #2 (2026-05-15): HEIC/HEIF graceful fallback.
  // iPhone Safari native может decode HEIC в `<img>`, но desktop Chrome/
  // Firefox/Edge — нет. Раньше мы breaking desktop HEIC uploads с error
  // "JPG, PNG и WebP" ещё до отправки на сервер. Подход:
  //   1. Try compression (на iPhone Safari работает native).
  //   2. Catch decode error → pass through original file. Server примет
  //      (HEIC MIME whitelist'нут в `ALLOWED_PHOTO_MIME`); если файл > 5MB
  //      server inline cap, AI просто пометит `photo_unreadable` и tutor
  //      пройдёт review manually — это лучше чем silent client-side breakage.
  const isHeicLike = /heic|heif/i.test(file.type);

  const sourceUrl = URL.createObjectURL(file);
  try {
    let img: HTMLImageElement;
    try {
      img = await loadImage(sourceUrl);
    } catch (decodeErr) {
      if (isHeicLike) {
        // HEIC decode failure на desktop browsers — pass through original.
        // Server примет MIME, дальнейшая обработка — tutor's manual review.
        console.warn('[mockExamPhotoCompress] HEIC decode failed, passing through original', {
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
      if (isHeicLike) return file; // graceful HEIC fallback
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
      if (isHeicLike) return file; // graceful HEIC fallback
      throw new Error('Браузер не поддерживает обработку изображений.');
    }

    try {
      ctx.drawImage(img, 0, 0, naturalW, naturalH, 0, 0, targetW, targetH);
    } catch {
      if (isHeicLike) return file; // graceful HEIC fallback
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
        // Preserve original filename но force .jpg extension since we always
        // re-encode as JPEG.
        const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
        return new File([blob], `${baseName}.jpg`, {
          type: 'image/jpeg',
          lastModified: Date.now(),
        });
      }
    }

    if (isHeicLike) return file; // graceful HEIC fallback (no quality fit)
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
