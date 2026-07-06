/**
 * PDF → картинки страниц (client-side, AI-загрузка задач P1 TASK-10, 2026-07-06).
 *
 * Рендерит страницы PDF в JPEG-файлы через pdfjs-dist — дальше они идут по
 * СУЩЕСТВУЮЩЕМУ пайплайну AI-загрузчика как обычные скриншоты (useImageUpload →
 * kb-attachments → image_refs → kb-ai-extract). Ноль правок edge/контрактов.
 *
 * ВАЖНО (performance-правило): этот модуль импортируется ТОЛЬКО динамически
 * (`await import('@/lib/pdfToImages')`) из обработчика выбора PDF — pdfjs
 * (~400КБ+) живёт в отдельном lazy-чанке и не попадает в initial bundle.
 *
 * Rule 80 (Safari 15): legacy-build pdfjs (модерн-build требует
 * Promise.withResolvers = Safari 17.4+); canvas.toBlob (НЕ OffscreenCanvas).
 */
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** Целевая ширина страницы в px — читаемо для Gemini-OCR, укладывается в капы. */
const TARGET_PAGE_WIDTH_PX = 1600;
/** Кап масштаба (сканы бывают уже 2000px+ на scale=1 — не раздувать). */
const MIN_SCALE = 1;
const MAX_SCALE = 2.5;
/** Edge inlining режет изображения > 5 МБ (MAX_PROMPT_IMAGE_BYTES) — держим запас. */
const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const JPEG_QUALITY = 0.85;
const FALLBACK_JPEG_QUALITY = 0.7;

/** Типизированная ошибка с русской фразой — страница показывает message в toast. */
export class PdfRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfRenderError';
  }
}

export interface PdfRenderResult {
  /** JPEG-файлы страниц (по порядку), готовые для useImageUpload.addFiles. */
  files: File[];
  /** Всего страниц в PDF. */
  pageCount: number;
  /** Сколько страниц отрендерено (= min(pageCount, maxPages) минус сбойные). */
  renderedPages: number;
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
  });
}

async function renderPageToBlob(
  page: pdfjsLib.PDFPageProxy,
  scaleFactor: number,
  quality: number,
): Promise<Blob | null> {
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(
    Math.max(TARGET_PAGE_WIDTH_PX / baseViewport.width, MIN_SCALE),
    MAX_SCALE,
  ) * scaleFactor;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  try {
    // Белый фон обязателен: JPEG не имеет альфы — прозрачный фон стал бы чёрным.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return await canvasToJpegBlob(canvas, quality);
  } finally {
    // Явно освобождаем память canvas (iOS Safari лимитирует суммарную площадь).
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * Рендерит первые `maxPages` страниц PDF в JPEG-файлы `{имя}-p{N}.jpg`.
 * Страница > 4 МБ → перерендер с пониженным качеством/масштабом (кап edge-inlining).
 * Битый/зашифрованный PDF → PdfRenderError с русской фразой.
 */
export async function renderPdfPagesToFiles(
  file: File,
  opts: { maxPages: number },
): Promise<PdfRenderResult> {
  const baseName = file.name.replace(/\.pdf$/i, '') || 'pdf';

  // v6: destroy() живёт на loading task (чистит и worker, и document).
  const loadingTask = pdfjsLib.getDocument({ data: await file.arrayBuffer() });
  let doc: pdfjsLib.PDFDocumentProxy;
  try {
    doc = await loadingTask.promise;
  } catch (e) {
    void loadingTask.destroy();
    const name = e instanceof Error ? e.name : '';
    if (name === 'PasswordException') {
      throw new PdfRenderError('PDF защищён паролем — снимите защиту и загрузите снова.');
    }
    throw new PdfRenderError('Не удалось открыть файл. Убедитесь, что это корректный PDF.');
  }

  try {
    const pageCount = doc.numPages;
    const pagesToRender = Math.min(pageCount, Math.max(0, opts.maxPages));
    const files: File[] = [];

    for (let n = 1; n <= pagesToRender; n++) {
      const page = await doc.getPage(n);
      try {
        let blob = await renderPageToBlob(page, 1, JPEG_QUALITY);
        if (blob && blob.size > MAX_PAGE_BYTES) {
          // Defensive: тяжёлая страница (постер/скан 600dpi) → ниже качество+масштаб.
          blob = await renderPageToBlob(page, 0.75, FALLBACK_JPEG_QUALITY);
        }
        if (!blob) continue; // сбой одной страницы не валит остальные
        files.push(
          new File([blob], `${baseName}-p${n}.jpg`, { type: 'image/jpeg' }),
        );
      } finally {
        page.cleanup();
      }
    }

    if (files.length === 0) {
      throw new PdfRenderError('Не удалось отрисовать ни одной страницы PDF. Попробуйте другой файл.');
    }

    return { files, pageCount, renderedPages: files.length };
  } finally {
    void loadingTask.destroy();
  }
}
