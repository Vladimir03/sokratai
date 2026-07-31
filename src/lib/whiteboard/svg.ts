// Единый SVG-слой доски (задача W1.0.2, spec §5 «Экспорт в PDF»).
//
// ⚠️ Это ОДИН источник геометрии для экрана и для PDF. Экран рендерит React-ом
// из тех же `SvgNodeSpec`, из которых экспорт собирает строку. Спека прямо
// требует не разводить два пути: разъехавшись, они дают классический баг
// «на экране одно, в PDF другое», который обнаруживается только у ученика.
//
// Все координаты — миллиметры (см. model.ts).

import { getStroke } from 'perfect-freehand';
import {
  type BoardBackground,
  type BoardElement,
  type BoardGridMm,
  type PageSizeMm,
  type ShapeElement,
  type StrokeElement,
  type TextElement,
  PAGE_HEIGHT_MM,
  PAGE_WIDTH_MM,
  textLines,
} from './model';

/** Дефолт — вертикальный лист; сигнатуры ниже принимают size опционально. */
const PORTRAIT_SIZE: PageSizeMm = { width: PAGE_WIDTH_MM, height: PAGE_HEIGHT_MM };

export interface SvgNodeSpec {
  tag: 'path' | 'rect' | 'ellipse' | 'line' | 'text' | 'image';
  attrs: Record<string, string | number>;
  /** Только для <text>. */
  text?: string;
}

/**
 * Резолв `storage://` → URL для <image>. Экран передаёт signed URL (host уже
 * api.sokratai.ru — RU-safe), экспорт в PDF — data:-URL. Модель хранит только
 * ref, поэтому обе подстановки живут снаружи.
 */
export type ImageUrlMap = Record<string, string>;

/** Шрифт доски. Golos Text — брендовый (rule 90); в PDF подменяется на helvetica. */
export const BOARD_FONT_FAMILY = "'Golos Text', system-ui, sans-serif";

// ─── Штрих ────────────────────────────────────────────────────────────────────

/**
 * Настройки perfect-freehand. `simulatePressure` выключаем, когда устройство даёт
 * настоящее давление (стилус), иначе библиотека домысливает его по скорости и
 * толщина «гуляет» — жалоба, известная по Apple Pencil (spec §8).
 */
export interface StrokeRenderOptions {
  /** Учитывать нажим стилуса. false → ровная линия постоянной толщины. */
  pressureEnabled: boolean;
  /** 0 — без сглаживания, 1 — максимальное. */
  smoothing: number;
}

export const DEFAULT_STROKE_OPTIONS: StrokeRenderOptions = {
  pressureEnabled: true,
  smoothing: 0.5,
};

function strokeOutline(el: StrokeElement, options: StrokeRenderOptions): number[][] {
  const input: number[][] = [];
  for (let i = 0; i + 2 < el.points.length; i += 3) {
    input.push([el.points[i], el.points[i + 1], el.points[i + 2]]);
  }
  return getStroke(input, {
    size: el.size,
    thinning: options.pressureEnabled ? 0.5 : 0,
    smoothing: options.smoothing,
    streamline: options.smoothing,
    simulatePressure: false,
    last: true,
  }) as number[][];
}

/** Замкнутый контур штриха → атрибут `d`. Возвращает '' для вырожденного штриха. */
export function strokeToPathData(el: StrokeElement, options: StrokeRenderOptions): string {
  const outline = strokeOutline(el, options);
  if (outline.length < 2) return '';
  const parts: string[] = [];
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i];
    parts.push(`${i === 0 ? 'M' : 'L'}${round(p[0])},${round(p[1])}`);
  }
  parts.push('Z');
  return parts.join(' ');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

// ─── Элементы ─────────────────────────────────────────────────────────────────

/**
 * Кэш узлов для дефолтных опций штриха. Элементы иммутабельны, поэтому WeakMap
 * по ссылке корректен. Главный выгодополучатель — миниатюры страниц: без кэша
 * активная миниатюра на каждый закоммиченный штрих прогоняла perfect-freehand
 * по ВСЕЙ странице заново (ревью 5.6, P1). Холст тоже выигрывает при
 * переключении страниц (remount пересчитывал все контуры).
 */
const defaultOptionsSvgCache = new WeakMap<BoardElement, SvgNodeSpec[]>();

export function elementToSvg(
  el: BoardElement,
  options: StrokeRenderOptions = DEFAULT_STROKE_OPTIONS,
  imageUrls?: ImageUrlMap,
): SvgNodeSpec[] {
  // Картинки НЕ кэшируются: их узел зависит от карты URL (signed URL живёт час,
  // data:-URL другой). Штрихи — подавляющее большинство элементов — кэш держат.
  if (el.type === 'image') {
    return imageElementToSvg(el, imageUrls);
  }
  if (options === DEFAULT_STROKE_OPTIONS) {
    const cached = defaultOptionsSvgCache.get(el);
    if (cached) return cached;
    const nodes = computeElementSvg(el, options);
    defaultOptionsSvgCache.set(el, nodes);
    return nodes;
  }
  return computeElementSvg(el, options);
}

function imageElementToSvg(
  el: Extract<BoardElement, { type: 'image' }>,
  imageUrls?: ImageUrlMap,
): SvgNodeSpec[] {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const transform = el.rotation !== 0 ? `rotate(${el.rotation} ${round(cx)} ${round(cy)})` : '';
  const url = imageUrls?.[el.ref];
  if (!url) {
    // URL ещё не разрезолвлен (или битый): рамка-плейсхолдер, НЕ raw <image>
    // с пустым href (rule 40 — битые картинки через фолбэк).
    return [{
      tag: 'rect',
      attrs: {
        x: round(el.x),
        y: round(el.y),
        width: round(el.w),
        height: round(el.h),
        fill: '#F1F5F9',
        stroke: '#CBD5E1',
        'stroke-width': 0.3,
        'stroke-dasharray': '2 1.5',
        ...(transform ? { transform } : {}),
      },
    }];
  }
  return [{
    tag: 'image',
    attrs: {
      x: round(el.x),
      y: round(el.y),
      width: round(el.w),
      height: round(el.h),
      href: url,
      preserveAspectRatio: 'none',
      ...(transform ? { transform } : {}),
    },
  }];
}

function computeElementSvg(el: BoardElement, options: StrokeRenderOptions): SvgNodeSpec[] {
  if (el.type === 'stroke') {
    const d = strokeToPathData(el, options);
    if (!d) return [];
    // Штрих — ЗАЛИВКА контура, а не обводка линии: perfect-freehand отдаёт
    // outline пера, поэтому fill даёт переменную толщину, а stroke бы её убил.
    //
    // ⚠️ Маркер задаётся `fill-opacity`, а НЕ `opacity`: последний применился бы
    // к узлу целиком и наложение двух маркерных штрихов давало бы тёмный шов на
    // пересечении. С `fill-opacity` подсветка ложится ровно.
    return [{
      tag: 'path',
      attrs: {
        d,
        fill: el.color,
        stroke: 'none',
        ...(el.opacity !== undefined && el.opacity < 1
          ? { 'fill-opacity': round(el.opacity) }
          : {}),
      },
    }];
  }

  if (el.type === 'shape') {
    const common = {
      fill: 'none',
      stroke: el.color,
      'stroke-width': el.size,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    };
    if (el.kind === 'line') {
      return [{
        tag: 'line',
        attrs: { x1: round(el.x), y1: round(el.y), x2: round(el.x + el.w), y2: round(el.y + el.h), ...common },
      }];
    }
    if (el.kind === 'arrow') {
      return [{ tag: 'path', attrs: { d: arrowPathData(el), ...common } }];
    }
    const x = Math.min(el.x, el.x + el.w);
    const y = Math.min(el.y, el.y + el.h);
    const w = Math.abs(el.w);
    const h = Math.abs(el.h);
    if (el.kind === 'ellipse') {
      return [{
        tag: 'ellipse',
        attrs: { cx: round(x + w / 2), cy: round(y + h / 2), rx: round(w / 2), ry: round(h / 2), ...common },
      }];
    }
    return [{ tag: 'rect', attrs: { x: round(x), y: round(y), width: round(w), height: round(h), ...common } }];
  }

  if (el.type === 'text') return textToSvg(el);
  // image сюда не доходит (обслужен в elementToSvg до кэша).
  return [];
}

/** Угол половины раствора наконечника. */
const ARROW_HEAD_ANGLE = Math.PI / 7;

/**
 * Стрелка (B5) одним `<path>`: древко + два уса.
 *
 * ⚠️ Наконечник рисуется ОБВОДКОЙ, а не залитым треугольником, — тогда он
 * наследует `stroke-width` древка и остаётся стрелкой на любом масштабе, а не
 * превращается в кляксу при толстом пере.
 *
 * Длина уса ограничена сверху третью древка: у короткой стрелки наконечник
 * иначе съедал бы её целиком.
 */
function arrowPathData(el: ShapeElement): string {
  const x2 = el.x + el.w;
  const y2 = el.y + el.h;
  const length = Math.hypot(el.w, el.h);
  const shaft = `M${round(el.x)},${round(el.y)} L${round(x2)},${round(y2)}`;
  if (length < 1e-3) return shaft;

  const head = Math.min(Math.max(el.size * 3, 2), length / 3);
  const angle = Math.atan2(el.h, el.w);
  const left = angle + Math.PI - ARROW_HEAD_ANGLE;
  const right = angle + Math.PI + ARROW_HEAD_ANGLE;

  return [
    shaft,
    `M${round(x2 + Math.cos(left) * head)},${round(y2 + Math.sin(left) * head)} L${round(x2)},${round(y2)}`,
    `L${round(x2 + Math.cos(right) * head)},${round(y2 + Math.sin(right) * head)}`,
  ].join(' ');
}

function textToSvg(el: TextElement): SvgNodeSpec[] {
  const lines = textLines(el);
  const out: SvgNodeSpec[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]) continue;
    out.push({
      tag: 'text',
      attrs: {
        x: round(el.x),
        y: round(el.y + i * el.size * 1.25),
        fill: el.color,
        'font-size': el.size,
        'font-family': BOARD_FONT_FAMILY,
      },
      text: lines[i],
    });
  }
  return out;
}

// ─── Разлиновка ───────────────────────────────────────────────────────────────

const GRID_COLOR = '#C7D2DE';
const LINES_COLOR = '#CBD5E1';

/**
 * Разлиновка одной геометрией для экрана и PDF.
 *
 * ⚠️ Намеренно НЕ `<pattern>`: заливка паттерном плохо переживает svg2pdf, а
 * «точка» дополнительно собирается в ОДИН `<path>` из вырожденных сегментов с
 * круглым концом — тысяча отдельных `<circle>` раздула бы и DOM, и PDF.
 */
export function backgroundToSvg(
  background: BoardBackground,
  gridMm: BoardGridMm,
  size: PageSizeMm = PORTRAIT_SIZE,
): SvgNodeSpec[] {
  if (background === 'blank') return [];

  if (background === 'dots') {
    const parts: string[] = [];
    for (let y = gridMm; y < size.height; y += gridMm) {
      for (let x = gridMm; x < size.width; x += gridMm) {
        parts.push(`M${round(x)},${round(y)}l0.01,0`);
      }
    }
    if (parts.length === 0) return [];
    return [{
      tag: 'path',
      attrs: {
        d: parts.join(''),
        stroke: GRID_COLOR,
        'stroke-width': 0.45,
        'stroke-linecap': 'round',
        fill: 'none',
      },
    }];
  }

  const parts: string[] = [];
  if (background === 'grid') {
    for (let x = gridMm; x < size.width; x += gridMm) {
      parts.push(`M${round(x)},0V${round(size.height)}`);
    }
  }
  const step = background === 'lines' ? Math.max(gridMm * 2, 8) : gridMm;
  for (let y = step; y < size.height; y += step) {
    parts.push(`M0,${round(y)}H${round(size.width)}`);
  }
  if (parts.length === 0) return [];
  return [{
    tag: 'path',
    attrs: {
      d: parts.join(''),
      stroke: background === 'lines' ? LINES_COLOR : GRID_COLOR,
      'stroke-width': 0.12,
      fill: 'none',
    },
  }];
}

// ─── Сериализация в строку (экспорт) ──────────────────────────────────────────

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nodeToString(node: SvgNodeSpec): string {
  const attrs = Object.keys(node.attrs)
    .map((key) => `${key}="${escapeXml(String(node.attrs[key]))}"`)
    .join(' ');
  if (node.tag === 'text') {
    return `<text ${attrs}>${escapeXml(node.text ?? '')}</text>`;
  }
  return `<${node.tag} ${attrs}/>`;
}

/**
 * Автономный SVG в ПИКСЕЛЯХ — для растеризации разметки поверх фото.
 *
 * Отличается от `pageToSvgString` только единицами: у доски мир измеряется в
 * миллиметрах листа A4, у фото — в пикселях снимка. Геометрия элементов при
 * этом берётся ровно та же (`elementToSvg`), поэтому инвариант «один источник
 * для экрана, PDF и растра» не нарушается.
 *
 * ⚠️ Документ обязан быть САМОДОСТАТОЧНЫМ: SVG, загруженный как `<img>`, не
 * подтягивает внешние ресурсы, поэтому картинки сюда класть нельзя — фото
 * рисуется на канву отдельным проходом.
 *
 * ⚠️ Шрифт текста здесь общесистемный: у SVG-как-картинки нет доступа к
 * шрифтам документа, и `Golos Text` подменился бы молча. Подписи разметки
 * короткие, поэтому это осознанный размен, а не недосмотр.
 */
export function elementsToPixelSvg(
  elements: BoardElement[],
  size: { width: number; height: number },
  options: StrokeRenderOptions = DEFAULT_STROKE_OPTIONS,
): string {
  const nodes: SvgNodeSpec[] = [];
  for (let i = 0; i < elements.length; i++) {
    // imageUrls намеренно не передаём: картинок в разметке не бывает.
    nodes.push(...elementToSvg(elements[i], options));
  }
  const body = nodes
    .map((node) =>
      node.tag === 'text'
        ? nodeToString({
            ...node,
            attrs: { ...node.attrs, 'font-family': 'sans-serif' },
          })
        : nodeToString(node),
    )
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" ` +
    `viewBox="0 0 ${size.width} ${size.height}">${body}</svg>`
  );
}

/**
 * Полная страница как автономный SVG-документ (для svg2pdf).
 * `includeBackground` — печатать ли разлиновку: на бумаге клетка обычно уже есть,
 * но конспект без неё читается хуже, поэтому решение остаётся за вызывающим.
 */
export function pageToSvgString(
  elements: BoardElement[],
  background: BoardBackground,
  gridMm: BoardGridMm,
  options: StrokeRenderOptions = DEFAULT_STROKE_OPTIONS,
  includeBackground = true,
  size: PageSizeMm = PORTRAIT_SIZE,
  imageUrls?: ImageUrlMap,
): string {
  const nodes: SvgNodeSpec[] = [];
  if (includeBackground) nodes.push(...backgroundToSvg(background, gridMm, size));
  for (let i = 0; i < elements.length; i++) {
    nodes.push(...elementToSvg(elements[i], options, imageUrls));
  }
  const body = nodes.map(nodeToString).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}mm" height="${size.height}mm" ` +
    `viewBox="0 0 ${size.width} ${size.height}">${body}</svg>`
  );
}
