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
 *
 * HEIC/HEIF: native decode как fast-path (Safari 17+); если браузер не умеет —
 * wasm-декод через `heicDecode.ts` (lazy-чанк). Сырой .heic БОЛЬШЕ НИКОГДА не
 * возвращается: до 2026-07-30 здесь было 5 тихих `return file`, из-за которых
 * репетитор на Windows видел «HEIC — скачать», а AI проверял решение вслепую
 * (баг Ирины Бочаровой). Битый HEIC → throw `HeicDecodeError`.
 */

import { HeicDecodeError, decodeHeicToJpegBlob, isHeicLikeFile } from './heicDecode';

export { HeicDecodeError } from './heicDecode';

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
 * - HEIC/HEIF — ВСЕГДА конвертируется в JPEG (native decode или wasm);
 *   недекодируемый HEIC бросает `HeicDecodeError` (fail-closed).
 * - Decompression bomb (> 64 MP) — throws user-facing Russian error.
 */
export async function compressForUpload(
  file: File,
  options: CompressOptions = {},
): Promise<File> {
  const maxBytes = options.maxBytes ?? MAX_OUTPUT_BYTES;
  const maxLongSide = options.maxLongSide ?? MAX_LONG_SIDE_PX;

  // PDF / non-image — pass through. Compression only for raster images.
  // Defensive: check MIME AND filename — Safari/iOS sometimes leaves file.type
  // empty for HEIC, but extension is present.
  const isHeicLike = isHeicLikeFile(file);
  if (!isHeicLike && !file.type.startsWith('image/')) {
    return file;
  }

  // Phase 7 round 2 (2026-05-20, review P0 #3): HEIC ALWAYS re-encodes to
  // JPEG, ignoring the size gate — desktop tutors and the AI gateway cannot
  // decode HEIC, so «already small» is irrelevant for it.
  // Для остальных форматов (JPEG/PNG/WebP) уже-маленький файл = pass-through
  // (avoid quality loss on cycles).
  if (!isHeicLike && file.size <= maxBytes) {
    return file;
  }

  if (!isHeicLike) {
    return compressViaCanvas(file, maxBytes, maxLongSide);
  }

  // --- HEIC ---
  // Fast-path: браузер декодирует HEIC сам (Safari 17+) — обычный canvas-путь.
  try {
    return await compressViaCanvas(file, maxBytes, maxLongSide);
  } catch (nativeErr) {
    // Бомбу (>64 МП) не маскируем wasm-декодом — это осознанный reject.
    if (nativeErr instanceof Error && /мегапиксел/i.test(nativeErr.message)) {
      throw nativeErr;
    }
    console.warn('[imageCompression] HEIC native decode failed, falling back to wasm', {
      fileName: file.name,
      fileSize: file.size,
    });
  }

  // Wasm-путь: heic-to (lazy-чанк). Сбой → HeicDecodeError наружу.
  const jpegBlob = await decodeHeicToJpegBlob(file);
  const jpegFile = new File([jpegBlob], jpegFileName(file.name), {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
  if (jpegFile.size <= maxBytes) {
    return jpegFile;
  }
  try {
    return await compressViaCanvas(jpegFile, maxBytes, maxLongSide);
  } catch (err) {
    // Декод удался, но сжать/обработать не вышло (бомба, canvas-сбой) —
    // это уже НЕ «битый HEIC», отдаём осмысленную ошибку как для JPEG.
    throw err instanceof Error ? err : new HeicDecodeError();
  }
}

/**
 * Canvas-пайплайн: decode → pixel cap → resize → quality ladder.
 * Бросает на любом сбое — HEIC-специфичных «тихих» веток здесь нет.
 */
async function compressViaCanvas(
  file: File,
  maxBytes: number,
  maxLongSide: number,
): Promise<File> {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(sourceUrl);
    const naturalW = img.naturalWidth || img.width;
    const naturalH = img.naturalHeight || img.height;
    if (naturalW <= 0 || naturalH <= 0) {
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
      throw new Error('Браузер не поддерживает обработку изображений.');
    }

    try {
      ctx.drawImage(img, 0, 0, naturalW, naturalH, 0, 0, targetW, targetH);
    } catch {
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
        return new File([blob], jpegFileName(file.name), {
          type: 'image/jpeg',
          lastModified: Date.now(),
        });
      }
    }

    throw new Error(
      `Не удалось сжать фото до ${(maxBytes / 1024 / 1024).toFixed(0)} МБ. Попробуй другое изображение.`,
    );
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

/** Preserve original filename but force .jpg — we always re-encode as JPEG. */
function jpegFileName(originalName: string): string {
  const baseName = originalName.replace(/\.[^.]+$/, '') || 'photo';
  return `${baseName}.jpg`;
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
