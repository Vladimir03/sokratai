/**
 * Сборка размеченного фото в JPEG (волна 2, план 1-ancient-quokka).
 *
 * Ученик получает ПЛОСКУЮ картинку в тред ДЗ (решение владельца): она читается
 * в любом браузере, не требует изменений схемы и лежит там же, где остальной
 * разбор.
 *
 * Два прохода по канве, а не один SVG:
 *   1. фото — через `drawImage` с поворотом;
 *   2. разметка — самостоятельным SVG поверх.
 *
 * ⚠️ Одним SVG сделать нельзя: документ, загруженный как `<img>`, НЕ подтягивает
 * внешние ресурсы, поэтому `<image href="https://…">` внутри него просто не
 * отрисуется — получилась бы разметка на пустом месте.
 *
 * ⚠️ Анти-taint (как в `cropImage.ts`): рисовать `<img src=signedUrl>`
 * кросс-доменного `api.sokratai.ru` в канву нельзя — она станет tainted и
 * `toBlob` бросит SecurityError. Поэтому fetch → Blob → objectURL: blob-URL
 * считается same-origin.
 *
 * ⚠️ ЗДЕСЬ И ТОЛЬКО ЗДЕСЬ поворот запекается в пиксели. В остальном продукте он
 * живёт углом в `photo_orientations`, а файл ученика остаётся нетронутым.
 */

import { type BoardElement } from '@/lib/whiteboard/model';
import { elementsToPixelSvg } from '@/lib/whiteboard/svg';
import { type PhotoDegrees, isQuarterTurn } from '@/lib/photoOrientation';

/** Длинная сторона результата. Читаемость рукописи важнее веса файла. */
const MAX_LONG_SIDE_PX = 2048;
const QUALITY_LADDER = [0.9, 0.78, 0.65] as const;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
/** Тот же предохранитель от «бомбы», что в `imageCompression.ts`. */
const MAX_INPUT_MEGAPIXELS = 64;

export class AnnotatedPhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnnotatedPhotoError';
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new AnnotatedPhotoError('Не удалось открыть изображение.'));
    img.src = src;
  });
}

/** Фото через blob-URL — иначе канва станет tainted и экспорт упадёт. */
async function loadPhotoUntainted(
  url: string,
): Promise<{ img: HTMLImageElement; revoke: () => void }> {
  if (url.startsWith('data:') || url.startsWith('blob:')) {
    return { img: await loadImage(url), revoke: () => undefined };
  }
  let blob: Blob;
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) throw new Error(String(response.status));
    blob = await response.blob();
  } catch {
    throw new AnnotatedPhotoError(
      'Не удалось скачать фото для отправки. Проверьте связь и повторите.',
    );
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImage(objectUrl);
    return { img, revoke: () => URL.revokeObjectURL(objectUrl) };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function loadSvgOverlay(svg: string): Promise<HTMLImageElement> {
  // Кодируем через encodeURIComponent, а не btoa: в подписях бывает кириллица,
  // а btoa на не-latin1 бросает InvalidCharacterError.
  return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
}

export interface RenderAnnotatedPhotoOptions {
  /** Подписанная ссылка на исходное фото. */
  photoUrl: string;
  /** Угол показа. Именно здесь он превращается в пиксели. */
  degrees: PhotoDegrees;
  /** Элементы разметки в координатах НЕповёрнутого фото. */
  elements: BoardElement[];
  fileName?: string;
}

/**
 * Возвращает готовый к загрузке JPEG: фото под нужным углом с нанесённой
 * разметкой.
 */
export async function renderAnnotatedPhoto({
  photoUrl,
  degrees,
  elements,
  fileName = 'razmetka.jpg',
}: RenderAnnotatedPhotoOptions): Promise<File> {
  const { img, revoke } = await loadPhotoUntainted(photoUrl);

  try {
    const naturalWidth = img.naturalWidth;
    const naturalHeight = img.naturalHeight;
    if (naturalWidth <= 0 || naturalHeight <= 0) {
      throw new AnnotatedPhotoError('Изображение пустое или повреждено.');
    }
    if ((naturalWidth * naturalHeight) / 1e6 > MAX_INPUT_MEGAPIXELS) {
      throw new AnnotatedPhotoError('Изображение слишком большое для обработки.');
    }

    // Холст — в габаритах ПОВЁРНУТОГО кадра: именно его увидит ученик.
    const quarter = isQuarterTurn(degrees);
    const outWidth = quarter ? naturalHeight : naturalWidth;
    const outHeight = quarter ? naturalWidth : naturalHeight;
    const scale = Math.min(1, MAX_LONG_SIDE_PX / Math.max(outWidth, outHeight));
    const canvasWidth = Math.max(1, Math.round(outWidth * scale));
    const canvasHeight = Math.max(1, Math.round(outHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new AnnotatedPhotoError('Браузер не дал холст для отрисовки.');

    // Белая подложка: у JPEG нет альфы, и прозрачность стала бы чёрной.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Общий для фото и разметки перенос: центр холста → поворот → масштаб.
    // Оба слоя лежат в одной системе координат неповёрнутого снимка, поэтому
    // разметка не может «уехать» относительно фото.
    const applyTransform = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.translate(canvasWidth / 2, canvasHeight / 2);
      ctx.rotate((degrees * Math.PI) / 180);
      ctx.scale(scale, scale);
    };

    applyTransform();
    ctx.drawImage(img, -naturalWidth / 2, -naturalHeight / 2, naturalWidth, naturalHeight);

    if (elements.length > 0) {
      const svg = elementsToPixelSvg(elements, { width: naturalWidth, height: naturalHeight });
      const overlay = await loadSvgOverlay(svg);
      applyTransform();
      ctx.drawImage(overlay, -naturalWidth / 2, -naturalHeight / 2, naturalWidth, naturalHeight);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    for (let i = 0; i < QUALITY_LADDER.length; i++) {
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', QUALITY_LADDER[i]);
      });
      if (!blob) continue;
      if (blob.size <= MAX_OUTPUT_BYTES || i === QUALITY_LADDER.length - 1) {
        // Освобождаем площадь канвы явно — на iOS её лимит общий на вкладку.
        canvas.width = 0;
        canvas.height = 0;
        return new File([blob], fileName, { type: 'image/jpeg' });
      }
    }

    throw new AnnotatedPhotoError('Не удалось собрать картинку с пометками.');
  } finally {
    revoke();
  }
}
