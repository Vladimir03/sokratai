/**
 * Клиентский кроп рисунка из изображения по нормализованной рамке (волна 2,
 * 2026-07-11, запрос Егора #45б/#10: вырезать рисунок задачи из мультизадачного
 * скрина вместо прикрепления всего скриншота).
 *
 * Кроп — оригинальные пиксели (canvas source-rect), НЕ генерация (политика
 * «рисунки не перерисовываем», prompts.md §1.3). Паттерны — зеркало
 * `pdfToImages.ts`: белая заливка под JPEG (альфа → чёрный), кап размера с
 * перерендером в пониженном качестве, освобождение canvas (iOS-лимит площади).
 *
 * Анти-taint: рисовать `<img src=signedUrl>` (кросс-домен `api.sokratai.ru`) в
 * canvas → tainted → `toBlob` бросит SecurityError. Поэтому fetch(signedUrl) →
 * Blob → objectURL → `<img>`: blob-URL same-origin, canvas НЕ tainted.
 *
 * ⚠️ CORS: сам `fetch` идёт в cors-режиме и ТРЕБУЕТ `Access-Control-Allow-Origin`
 * от signed-URL хоста (`api.sokratai.ru` сейчас отдаёт `*` — подтверждено на
 * проде). Если nginx/storage перестанут слать CORS-заголовки на GET signed URL —
 * fetch отклонится, кроп молча деградирует (задача сохранится БЕЗ картинки).
 * При правке nginx/CORS — проверить этот путь, иначе фича кропа умрёт незаметно.
 */

import type { ImageBbox } from '@/lib/kbAiExtractApi';

const JPEG_QUALITY = 0.85;
const FALLBACK_JPEG_QUALITY = 0.7;
/** Кап результата — под edge-лимит инлайна 5 МБ с запасом (зеркало pdfToImages). */
const MAX_CROP_BYTES = 4 * 1024 * 1024;
/** Минимальный размер стороны кропа в px — вырожденная рамка бессмысленна. */
const MIN_CROP_SIDE_PX = 24;

export class CropImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CropImageError';
  }
}

function loadImageFromBlob(blob: Blob): Promise<{ img: HTMLImageElement; revoke: () => void }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve({ img, revoke: () => URL.revokeObjectURL(url) });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new CropImageError('Не удалось открыть изображение для обрезки.'));
    };
    img.src = url;
  });
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new CropImageError('Не удалось сохранить обрезанный рисунок.'))),
      'image/jpeg',
      quality,
    );
  });
}

/**
 * Вырезать фрагмент изображения по нормализованной рамке (доли 0..1).
 *
 * @param sourceUrl — signed HTTP URL исходника (клиентский, уже RU-safe).
 * @param bbox — рамка `{x, y, w, h}` в долях 0..1 (валидирована edge/редактором).
 * @returns JPEG-файл фрагмента (белый фон, ≤4 МБ).
 */
export async function cropImageToFile(
  sourceUrl: string,
  bbox: ImageBbox,
  fileName = 'crop.jpg',
): Promise<File> {
  let resp: Response;
  try {
    resp = await fetch(sourceUrl);
  } catch {
    throw new CropImageError('Не удалось скачать исходное изображение.');
  }
  if (!resp.ok) {
    throw new CropImageError('Исходное изображение недоступно — обновите страницу и попробуйте ещё раз.');
  }
  const blob = await resp.blob();
  const { img, revoke } = await loadImageFromBlob(blob);

  try {
    const naturalW = img.naturalWidth;
    const naturalH = img.naturalHeight;
    if (!naturalW || !naturalH) {
      throw new CropImageError('Не удалось прочитать размеры изображения.');
    }

    const sx = Math.round(Math.min(Math.max(bbox.x, 0), 1) * naturalW);
    const sy = Math.round(Math.min(Math.max(bbox.y, 0), 1) * naturalH);
    const sw = Math.min(Math.round(bbox.w * naturalW), naturalW - sx);
    const sh = Math.min(Math.round(bbox.h * naturalH), naturalH - sy);
    if (sw < MIN_CROP_SIDE_PX || sh < MIN_CROP_SIDE_PX) {
      throw new CropImageError('Рамка слишком маленькая — растяните её на весь рисунок.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new CropImageError('Canvas недоступен в этом браузере.');
    // Белый фон: PNG-альфа при конвертации в JPEG иначе станет чёрной (урок pdfToImages).
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, sw, sh);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

    let out = await canvasToJpegBlob(canvas, JPEG_QUALITY);
    if (out.size > MAX_CROP_BYTES) {
      out = await canvasToJpegBlob(canvas, FALLBACK_JPEG_QUALITY);
    }
    if (out.size > MAX_CROP_BYTES) {
      throw new CropImageError('Фрагмент получился слишком большим. Уменьшите рамку.');
    }

    // Освобождение canvas — iOS Safari ограничивает суммарную площадь живых canvas.
    canvas.width = 0;
    canvas.height = 0;

    return new File([out], fileName, { type: 'image/jpeg' });
  } finally {
    revoke();
  }
}
