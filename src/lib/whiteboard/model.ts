// Модель элементов онлайн-доски (задача W1.0.1, spec §5).
//
// ⚠️ Единица координат — МИЛЛИМЕТР, а не пиксель. Страница доски — это лист A4
// за вычетом полей, и хранение сразу в мм делает три вещи бесплатными:
//   • масштаб печати (W1.9): при клетке 5 мм в ширину контента влезает 36 клеток
//     (180/5) — размер обычной ученической тетради, модель Chattern (spec Р2);
//   • экспорт в PDF: jsPDF работает в мм, пересчёт не нужен;
//   • независимость от размера экрана: SVG viewBox в мм тянется под любой экран.
//
// Элементы иммутабельны: любая правка создаёт новый объект с инкрементом
// `version` и новым `versionNonce`. Это механика Excalidraw, перенесённая в свою
// схему (spec §5 «Синхронизация»): в Фазе 2 пара (version, versionNonce) решает
// конфликт «кто новее» без CRDT, потому что пишет всегда один — держатель мела.

export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;
export const PAGE_MARGIN_MM = 15;
/** Ширина области контента: 210 − 2×15. При клетке 5 мм ровно 36 клеток. */
export const PAGE_WIDTH_MM = A4_WIDTH_MM - PAGE_MARGIN_MM * 2;
/** Высота области контента: 297 − 2×15. */
export const PAGE_HEIGHT_MM = A4_HEIGHT_MM - PAGE_MARGIN_MM * 2;

export type BoardBackground = 'blank' | 'grid' | 'lines' | 'dots';
export type BoardGridMm = 5 | 10;

export const BOARD_BACKGROUNDS: readonly BoardBackground[] = ['blank', 'grid', 'lines', 'dots'];
export const BOARD_GRID_STEPS: readonly BoardGridMm[] = [5, 10];

export const BACKGROUND_LABELS: Record<BoardBackground, string> = {
  blank: 'Чистый',
  grid: 'Клетка',
  lines: 'Линейка',
  dots: 'Точка',
};

/** Толщина пера в мм. Ученическая ручка — примерно 0.5 мм. */
export const PEN_SIZES_MM = [0.4, 0.8, 1.6] as const;
export const DEFAULT_PEN_SIZE_MM = 0.8;

export const BOARD_COLORS = [
  '#0F172A', // slate-900 — основной
  '#1B6B4A', // socrat green — акцент
  '#DC2626', // red-600 — «внимание»
  '#2563EB', // blue-600
  '#D97706', // amber-600
] as const;

export const DEFAULT_TEXT_SIZE_MM = 6;

// ─── Элементы ─────────────────────────────────────────────────────────────────

export interface BoardElementBase {
  id: string;
  /** Инкрементируется при каждой правке (tie-break в Фазе 2). */
  version: number;
  /** Случайный tie-breaker при равных version. */
  versionNonce: number;
  /** Порядок отрисовки и стабильная сортировка. */
  seq: number;
}

export interface StrokeElement extends BoardElementBase {
  type: 'stroke';
  /**
   * Плоский массив [x, y, pressure, x, y, pressure, …] в мм.
   * Плоский, а не массив точек: у длинного конспекта это десятки тысяч чисел,
   * и объекты {x,y,p} раздували бы jsonb втрое.
   */
  points: number[];
  color: string;
  /** Толщина в мм. */
  size: number;
}

export type ShapeKind = 'rect' | 'ellipse' | 'line';

export interface ShapeElement extends BoardElementBase {
  type: 'shape';
  kind: ShapeKind;
  /** Левый верхний угол (для line — начало) в мм. */
  x: number;
  y: number;
  /** Может быть отрицательной (для line — вектор до конца). */
  w: number;
  h: number;
  color: string;
  size: number;
}

export interface TextElement extends BoardElementBase {
  type: 'text';
  x: number;
  y: number;
  text: string;
  color: string;
  /** Кегль в мм (высота строки ≈ 1.25 × размер). */
  size: number;
}

export type BoardElement = StrokeElement | ShapeElement | TextElement;

export interface BoardPageScene {
  elements: BoardElement[];
  background: BoardBackground;
  gridMm: BoardGridMm;
}

// ─── Идентификаторы ───────────────────────────────────────────────────────────

let idCounter = 0;

/**
 * ⚠️ НЕ `crypto.randomUUID` — он требует HTTPS + Safari 15.4+ (rule 80), а
 * baseline проекта — iOS 15. Тот же приём, что в lessonMaterialsApi.
 */
export function createElementId(): string {
  idCounter += 1;
  return `${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextNonce(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

let seqCounter = 0;

function nextSeq(): number {
  seqCounter += 1;
  return seqCounter;
}

/** Поднимает счётчик порядка выше уже загруженных элементов (после чтения страницы). */
export function primeSeqCounter(elements: BoardElement[]): void {
  for (let i = 0; i < elements.length; i++) {
    if (elements[i].seq > seqCounter) seqCounter = elements[i].seq;
  }
}

function baseFields(): BoardElementBase {
  return { id: createElementId(), version: 1, versionNonce: nextNonce(), seq: nextSeq() };
}

/** Возвращает НОВЫЙ объект с инкрементом версии — элементы иммутабельны. */
export function bumpVersion<T extends BoardElement>(el: T, patch: Partial<T>): T {
  return { ...el, ...patch, version: el.version + 1, versionNonce: nextNonce() };
}

// ─── Фабрики ──────────────────────────────────────────────────────────────────

export function createStroke(points: number[], color: string, size: number): StrokeElement {
  return { ...baseFields(), type: 'stroke', points, color, size };
}

export function createShape(
  kind: ShapeKind,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  size: number,
): ShapeElement {
  return { ...baseFields(), type: 'shape', kind, x, y, w, h, color, size };
}

export function createText(x: number, y: number, text: string, color: string, size: number): TextElement {
  return { ...baseFields(), type: 'text', x, y, text, color, size };
}

// ─── Геометрия ────────────────────────────────────────────────────────────────

export interface BoardBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Округление до 0.01 мм: 10 микрон — заведомо тоньше пера, а jsonb вдвое легче. */
export function roundMm(value: number): number {
  return Math.round(value * 100) / 100;
}

export function clampToPage(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, 0), PAGE_WIDTH_MM),
    y: Math.min(Math.max(y, 0), PAGE_HEIGHT_MM),
  };
}

export function textLines(el: TextElement): string[] {
  return el.text.split('\n');
}

/** Приблизительная ширина строки: у пропорционального шрифта ≈ 0.5 кегля на символ. */
function approxTextWidthMm(line: string, size: number): number {
  return line.length * size * 0.5;
}

export function elementBounds(el: BoardElement): BoardBounds {
  if (el.type === 'stroke') {
    if (el.points.length < 2) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i + 1 < el.points.length; i += 3) {
      const x = el.points[i];
      const y = el.points[i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const pad = el.size / 2;
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }
  if (el.type === 'shape') {
    const pad = el.size / 2;
    return {
      minX: Math.min(el.x, el.x + el.w) - pad,
      minY: Math.min(el.y, el.y + el.h) - pad,
      maxX: Math.max(el.x, el.x + el.w) + pad,
      maxY: Math.max(el.y, el.y + el.h) + pad,
    };
  }
  const lines = textLines(el);
  let widest = 0;
  for (let i = 0; i < lines.length; i++) {
    const w = approxTextWidthMm(lines[i], el.size);
    if (w > widest) widest = w;
  }
  return {
    minX: el.x,
    minY: el.y - el.size,
    maxX: el.x + widest,
    maxY: el.y + el.size * 1.25 * (lines.length - 1) + el.size * 0.3,
  };
}

function pointSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.min(Math.max(t, 0), 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Попадание точки в элемент с допуском (мм). Для штриха — расстояние до ломаной,
 * а не до bounding box: иначе ластик стирал бы соседние штрихи, «зацепив» пустой
 * прямоугольник вокруг диагональной линии.
 */
export function hitTest(el: BoardElement, x: number, y: number, tolerance: number): boolean {
  if (el.type === 'stroke') {
    const reach = tolerance + el.size / 2;
    if (el.points.length < 3) return false;
    if (el.points.length === 3) {
      return Math.hypot(x - el.points[0], y - el.points[1]) <= reach;
    }
    for (let i = 0; i + 4 < el.points.length; i += 3) {
      const d = pointSegmentDistance(
        x,
        y,
        el.points[i],
        el.points[i + 1],
        el.points[i + 3],
        el.points[i + 4],
      );
      if (d <= reach) return true;
    }
    return false;
  }
  const b = elementBounds(el);
  return x >= b.minX - tolerance && x <= b.maxX + tolerance &&
    y >= b.minY - tolerance && y <= b.maxY + tolerance;
}

export function boundsIntersect(a: BoardBounds, b: BoardBounds): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

/** Сдвиг элемента на (dx, dy) мм. Возвращает новый объект (иммутабельность). */
export function translateElement(el: BoardElement, dx: number, dy: number): BoardElement {
  if (el.type === 'stroke') {
    const points = new Array<number>(el.points.length);
    for (let i = 0; i + 2 < el.points.length; i += 3) {
      points[i] = roundMm(el.points[i] + dx);
      points[i + 1] = roundMm(el.points[i + 1] + dy);
      points[i + 2] = el.points[i + 2];
    }
    return bumpVersion(el, { points } as Partial<StrokeElement>);
  }
  return bumpVersion(el, {
    x: roundMm((el as ShapeElement | TextElement).x + dx),
    y: roundMm((el as ShapeElement | TextElement).y + dy),
  } as Partial<ShapeElement | TextElement>);
}

// ─── Сериализация ─────────────────────────────────────────────────────────────

/**
 * Санитайзер входа из БД. Страница читается из jsonb, и на неё нельзя полагаться:
 * битый элемент не должен ронять весь конспект — он просто отбрасывается.
 */
export function parseElements(raw: unknown): BoardElement[] {
  if (!Array.isArray(raw)) return [];
  const out: BoardElement[] = [];
  for (let i = 0; i < raw.length; i++) {
    const el = raw[i] as Partial<BoardElement> | null;
    if (!el || typeof el !== 'object' || typeof el.id !== 'string') continue;
    const base = {
      id: el.id,
      version: typeof el.version === 'number' ? el.version : 1,
      versionNonce: typeof el.versionNonce === 'number' ? el.versionNonce : 0,
      seq: typeof el.seq === 'number' ? el.seq : i + 1,
    };
    if (el.type === 'stroke') {
      const s = el as Partial<StrokeElement>;
      if (!Array.isArray(s.points) || s.points.length < 3) continue;
      out.push({
        ...base,
        type: 'stroke',
        points: s.points.filter((n) => typeof n === 'number'),
        color: typeof s.color === 'string' ? s.color : BOARD_COLORS[0],
        size: typeof s.size === 'number' ? s.size : DEFAULT_PEN_SIZE_MM,
      });
    } else if (el.type === 'shape') {
      const s = el as Partial<ShapeElement>;
      if (typeof s.x !== 'number' || typeof s.y !== 'number') continue;
      out.push({
        ...base,
        type: 'shape',
        kind: s.kind === 'ellipse' || s.kind === 'line' ? s.kind : 'rect',
        x: s.x,
        y: s.y,
        w: typeof s.w === 'number' ? s.w : 0,
        h: typeof s.h === 'number' ? s.h : 0,
        color: typeof s.color === 'string' ? s.color : BOARD_COLORS[0],
        size: typeof s.size === 'number' ? s.size : DEFAULT_PEN_SIZE_MM,
      });
    } else if (el.type === 'text') {
      const s = el as Partial<TextElement>;
      if (typeof s.x !== 'number' || typeof s.y !== 'number' || typeof s.text !== 'string') continue;
      out.push({
        ...base,
        type: 'text',
        x: s.x,
        y: s.y,
        text: s.text,
        color: typeof s.color === 'string' ? s.color : BOARD_COLORS[0],
        size: typeof s.size === 'number' ? s.size : DEFAULT_TEXT_SIZE_MM,
      });
    }
  }
  out.sort((a, b) => a.seq - b.seq);
  return out;
}

export function normalizeBackground(raw: unknown): BoardBackground {
  return raw === 'blank' || raw === 'lines' || raw === 'dots' ? raw : 'grid';
}

export function normalizeGridMm(raw: unknown): BoardGridMm {
  return raw === 10 ? 10 : 5;
}
