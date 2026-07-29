// Экспорт доски в PDF (задачи W1.8/W1.9, spec §5 «Экспорт в PDF»).
//
// Пайплайн: элементы страницы → общий SVG-слой (svg.ts) → svg2pdf.js → jsPDF.
// Всё под MIT. PDF получается ВЕКТОРНЫЙ: perfect-freehand отдаёт контур штриха
// как обычный path, поэтому рукописный текст масштабируется без растра.
//
// Страница доски = один лист A4: контент 180×267 мм печатается с полем 15 мм,
// то есть клетка 5 мм на бумаге остаётся клеткой 5 мм (spec Р2, задача W1.9).
//
// ⚠️ Кириллица. Стандартные шрифты jsPDF (helvetica и пр.) кодируются WinAnsi и
// РУССКИХ БУКВ НЕ СОДЕРЖАТ — подпись к чертежу вышла бы набором вопросов.
// Поэтому в документ встраивается Golos Text, который проект и так везёт как
// настоящий TTF для UI (src/fonts): пользователь его уже скачал, лишнего веса нет.

import { jsPDF } from 'jspdf';
// Побочный импорт: svg2pdf.js расширяет jsPDF методом `.svg()`.
import 'svg2pdf.js';
import {
  type BoardBackground,
  type BoardElement,
  type BoardGridMm,
  A4_HEIGHT_MM,
  A4_WIDTH_MM,
  PAGE_HEIGHT_MM,
  PAGE_MARGIN_MM,
  PAGE_WIDTH_MM,
} from './model';
import { DEFAULT_STROKE_OPTIONS, type StrokeRenderOptions, pageToSvgString } from './svg';

const FONT_URL = new URL('../../fonts/GolosText-Regular.ttf', import.meta.url).href;
const FONT_VFS_NAME = 'GolosText-Regular.ttf';
const FONT_NAME = 'Golos Text';

export interface BoardPdfPage {
  elements: BoardElement[];
  background: BoardBackground;
  gridMm: BoardGridMm;
}

export interface BoardPdfOptions {
  strokeOptions?: StrokeRenderOptions;
  /** Печатать ли разлиновку. По умолчанию да — с клеткой конспект читается привычнее. */
  includeBackground?: boolean;
  /** Прогресс по листам: вызывается ПЕРЕД обработкой каждой страницы (1-based). */
  onPageStart?: (page: number, total: number) => void;
}

let cachedFontBase64: string | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // Чанками: btoa(String.fromCharCode(...bytes)) на шрифте в сотни КБ
  // переполняет стек аргументов.
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return btoa(binary);
}

/**
 * Fail-closed (ревью 5.6, P1): молчаливый фолбэк на helvetica отдал бы ученику
 * PDF, где вся кириллица — вопросительные знаки, и никто бы этого не заметил
 * до жалобы. Лучше честная ошибка с предложением повторить.
 */
async function loadFontBase64(): Promise<string> {
  if (cachedFontBase64) return cachedFontBase64;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(FONT_URL, { signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    cachedFontBase64 = arrayBufferToBase64(await resp.arrayBuffer());
    return cachedFontBase64;
  } catch {
    throw new Error('Не удалось загрузить шрифт для PDF. Проверьте сеть и повторите.');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * svg2pdf измеряет текст через настоящий DOM, поэтому SVG обязан быть в документе.
 * Держим его вне экрана, но БЕЗ `display:none` — у скрытого элемента нулевые
 * метрики, и текст уехал бы в никуда.
 */
function withDetachedSvg<T>(svgMarkup: string, fn: (svg: SVGSVGElement) => Promise<T>): Promise<T> {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.position = 'fixed';
  host.style.left = '-10000px';
  host.style.top = '0';
  host.style.opacity = '0';
  host.style.pointerEvents = 'none';
  host.innerHTML = svgMarkup;
  const svg = host.firstElementChild as SVGSVGElement | null;
  if (!svg) return Promise.reject(new Error('Не удалось подготовить страницу к печати'));
  document.body.appendChild(host);
  return fn(svg).finally(() => {
    host.remove();
  });
}

/** Собирает многостраничный PDF: страница доски = лист A4. */
export async function exportBoardToPdf(
  pages: BoardPdfPage[],
  options: BoardPdfOptions = {},
): Promise<Blob> {
  if (pages.length === 0) {
    throw new Error('В доске нет страниц для экспорта');
  }

  const strokeOptions = options.strokeOptions ?? DEFAULT_STROKE_OPTIONS;
  const includeBackground = options.includeBackground ?? true;

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  const fontBase64 = await loadFontBase64();
  doc.addFileToVFS(FONT_VFS_NAME, fontBase64);
  doc.addFont(FONT_VFS_NAME, FONT_NAME, 'normal');
  doc.setFont(FONT_NAME);

  for (let i = 0; i < pages.length; i++) {
    options.onPageStart?.(i + 1, pages.length);
    if (i > 0) {
      doc.addPage('a4', 'portrait');
      // Отдаём кадр браузеру между листами: сборка синхронная и на 5–10
      // заполненных страницах иначе замораживает интерфейс целиком, включая
      // спиннер прогресса (ревью 5.6, P1).
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const page = pages[i];
    const markup = pageToSvgString(
      page.elements,
      page.background,
      page.gridMm,
      strokeOptions,
      includeBackground,
    );
    // Последовательно, а не Promise.all: листы кладутся в один документ jsPDF,
    // и параллельная запись перемешала бы их порядок.
    await withDetachedSvg(markup, (svg) =>
      doc.svg(svg, {
        x: PAGE_MARGIN_MM,
        y: PAGE_MARGIN_MM,
        width: PAGE_WIDTH_MM,
        height: PAGE_HEIGHT_MM,
      }),
    );
  }

  return doc.output('blob');
}

/** Имя файла конспекта. Без символов, недопустимых в файловой системе. */
export function boardPdfFileName(title: string | null, date: Date): string {
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
  const safeTitle = (title ?? 'Конспект')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return `${safeTitle || 'Конспект'} ${stamp}.pdf`;
}

export const PDF_PAGE_SIZE_MM = { width: A4_WIDTH_MM, height: A4_HEIGHT_MM };
