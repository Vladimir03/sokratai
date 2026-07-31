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
/** Ширина области контента вертикального листа: 210 − 2×15. При клетке 5 мм ровно 36 клеток. */
export const PAGE_WIDTH_MM = A4_WIDTH_MM - PAGE_MARGIN_MM * 2;
/** Высота области контента вертикального листа: 297 − 2×15. */
export const PAGE_HEIGHT_MM = A4_HEIGHT_MM - PAGE_MARGIN_MM * 2;

/**
 * Ориентация листа — per-page (запрос владельца: больше места под схемы и
 * широкие выкладки). Горизонтальный A4 даёт 267 мм ширины вместо 180 —
 * +48% рабочей ширины при том же печатном листе. Хранится в
 * `board_pages.app_state.orientation` (jsonb) — миграция не нужна.
 */
export type PageOrientation = 'portrait' | 'landscape';

export interface PageSizeMm {
  width: number;
  height: number;
}

export function pageSizeMm(orientation: PageOrientation): PageSizeMm {
  return orientation === 'landscape'
    ? { width: PAGE_HEIGHT_MM, height: PAGE_WIDTH_MM }
    : { width: PAGE_WIDTH_MM, height: PAGE_HEIGHT_MM };
}

export function normalizeOrientation(raw: unknown): PageOrientation {
  return raw === 'landscape' ? 'landscape' : 'portrait';
}

// ─── Холст и камера (Фаза P0, B0 — Р1 отменён решением владельца 29.07) ───────
//
// Доска — бесконечный холст в МИРОВЫХ миллиметрах; рамка (= строка board_pages)
// лежит на нём в позиции `FramePlacement`, а её элементы остаются в ЛОКАЛЬНЫХ
// координатах рамки. Поэтому exportPdf и вся геометрия элементов Фазы 1
// переживают переход без правок: мир = позиция рамки + локаль.
//
// Камера: центр в мировых мм + zoom (экранных px на мм). Follow-режим (B1)
// передаёт ВИДИМЫЕ ГРАНИЦЫ сцены, а не zoom — ведомый делает fit-contain
// в своё окно (паттерн Excalidraw: разные окна, одна и та же область).

export interface FramePlacement {
  x: number;
  y: number;
}

/** Зазор между авто-разложенными рамками (существующие доски → рамки в ряд). */
export const FRAME_GAP_MM = 20;

export interface CameraState {
  /** Центр вьюпорта в мировых мм. */
  cx: number;
  cy: number;
  /** Экранных px на мм. 3.78 ≈ 100% (96 dpi). */
  zoom: number;
}

export const CAMERA_ZOOM_MIN = 0.2;
export const CAMERA_ZOOM_MAX = 20;

export function clampZoom(zoom: number): number {
  return Math.min(CAMERA_ZOOM_MAX, Math.max(CAMERA_ZOOM_MIN, zoom));
}

/** Экранные px (относительно вьюпорта) → мировые мм. */
export function screenToWorld(
  px: number,
  py: number,
  camera: CameraState,
  viewport: { w: number; h: number },
): { x: number; y: number } {
  return {
    x: camera.cx + (px - viewport.w / 2) / camera.zoom,
    y: camera.cy + (py - viewport.h / 2) / camera.zoom,
  };
}

/** Мировые мм → px вьюпорта (для HTML-оверлеев поверх холста: textarea текста). */
export function worldToViewportPx(
  wx: number,
  wy: number,
  camera: CameraState,
  viewport: { w: number; h: number },
): { x: number; y: number } {
  return {
    x: (wx - camera.cx) * camera.zoom + viewport.w / 2,
    y: (wy - camera.cy) * camera.zoom + viewport.h / 2,
  };
}

/** Мировое окно камеры в мм (для viewBox и culling). */
export function cameraWorldWindow(
  camera: CameraState,
  viewport: { w: number; h: number },
): BoardBounds {
  const halfW = viewport.w / 2 / camera.zoom;
  const halfH = viewport.h / 2 / camera.zoom;
  return {
    minX: camera.cx - halfW,
    minY: camera.cy - halfH,
    maxX: camera.cx + halfW,
    maxY: camera.cy + halfH,
  };
}

/**
 * Камера, вмещающая bounds целиком (fit-contain) с полем `paddingPx`.
 * Используется и для «Вписать рамку», и для follow-режима (B1).
 */
export function cameraToFitBounds(
  bounds: BoardBounds,
  viewport: { w: number; h: number },
  paddingPx = 24,
): CameraState {
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const zoom = clampZoom(
    Math.min((viewport.w - paddingPx * 2) / w, (viewport.h - paddingPx * 2) / h),
  );
  return {
    cx: (bounds.minX + bounds.maxX) / 2,
    cy: (bounds.minY + bounds.maxY) / 2,
    zoom,
  };
}

/** Зум к точке: мировая точка под курсором остаётся под курсором. */
export function zoomCameraAt(
  camera: CameraState,
  factor: number,
  anchorWorld: { x: number; y: number },
): CameraState {
  const zoom = clampZoom(camera.zoom * factor);
  if (zoom === camera.zoom) return camera;
  const scale = camera.zoom / zoom;
  return {
    zoom,
    cx: anchorWorld.x - (anchorWorld.x - camera.cx) * scale,
    cy: anchorWorld.y - (anchorWorld.y - camera.cy) * scale,
  };
}

export function normalizeFramePlacement(raw: unknown, fallbackIndex: number): FramePlacement {
  const obj = raw as { x?: unknown; y?: unknown } | null | undefined;
  if (obj && typeof obj.x === 'number' && typeof obj.y === 'number' &&
      Number.isFinite(obj.x) && Number.isFinite(obj.y)) {
    return { x: obj.x, y: obj.y };
  }
  // Доски Фазы 1 без позиций: рамки ложатся в ряд слева направо.
  return { x: fallbackIndex * (PAGE_WIDTH_MM + FRAME_GAP_MM), y: 0 };
}

/** Мировой bbox рамки. */
export function frameWorldBounds(placement: FramePlacement, size: PageSizeMm): BoardBounds {
  return {
    minX: placement.x,
    minY: placement.y,
    maxX: placement.x + size.width,
    maxY: placement.y + size.height,
  };
}

/** Следующая свободная позиция для новой рамки: справа от самой правой. */
export function nextFramePlacement(
  frames: { placement: FramePlacement; size: PageSizeMm }[],
): FramePlacement {
  if (frames.length === 0) return { x: 0, y: 0 };
  let maxRight = -Infinity;
  let atY = 0;
  for (let i = 0; i < frames.length; i++) {
    const right = frames[i].placement.x + frames[i].size.width;
    if (right > maxRight) {
      maxRight = right;
      atY = frames[i].placement.y;
    }
  }
  return { x: maxRight + FRAME_GAP_MM, y: atY };
}

// ─── Сетка Chattern (Этап 2, решение владельца 29.07 вечер) ────────────────────
//
// Листы сидят в ячейках виртуальной сетки: колонка шагом «портрет+зазор»,
// ряд шагом «высота портрета+зазор». Свободного таскания нет — раскладка
// выводится из (col, row), что даёт предсказуемый порядок PDF и ноль UX-работы
// (модель, в которой Елена уже мыслит по Chattern).
//
// Групповая схема «полоса + рулоны» (идея Елены): row 0 — общая полоса
// (теория/PDF, пишет репетитор), столбец col — «рулон» ученика (листы вниз,
// row ≥ 1). Порядок экспорта: полоса слева-направо, затем рулоны по столбцам.
//
// Ландшафтный лист шире ячейки — занимает ДВЕ колонки (col и col+1).

export interface FrameCell {
  col: number;
  row: number;
}

export const CELL_STEP_X_MM = PAGE_WIDTH_MM + FRAME_GAP_MM; // 200
export const CELL_STEP_Y_MM = PAGE_HEIGHT_MM + FRAME_GAP_MM; // 287

export function cellToPlacement(cell: FrameCell): FramePlacement {
  return { x: cell.col * CELL_STEP_X_MM, y: cell.row * CELL_STEP_Y_MM };
}

/** Сколько колонок занимает лист (ландшафт шире ячейки → 2). */
export function cellSpan(orientation: PageOrientation): number {
  return orientation === 'landscape' ? 2 : 1;
}

export function normalizeFrameCell(raw: unknown, fallbackIndex: number): FrameCell {
  const obj = raw as { col?: unknown; row?: unknown; x?: unknown; y?: unknown } | null | undefined;
  if (
    obj && typeof obj.col === 'number' && typeof obj.row === 'number' &&
    Number.isInteger(obj.col) && Number.isInteger(obj.row) &&
    obj.col >= 0 && obj.row >= 0
  ) {
    return { col: obj.col, row: obj.row };
  }
  // Совместимость с Этапом 1 (свободные {x,y} успели уехать в прод утром 29.07):
  // привязываем к ближайшей ячейке.
  if (obj && typeof obj.x === 'number' && typeof obj.y === 'number' && Number.isFinite(obj.x)) {
    return {
      col: Math.max(0, Math.round(obj.x / CELL_STEP_X_MM)),
      row: Math.max(0, Math.round(obj.y / CELL_STEP_Y_MM)),
    };
  }
  // Доски Фазы 1: листы ложатся в общую полосу слева направо.
  return { col: fallbackIndex, row: 0 };
}

export function cellOccupied(
  cell: FrameCell,
  frames: { cell: FrameCell; orientation: PageOrientation }[],
  span = 1,
): boolean {
  for (let c = cell.col; c < cell.col + span; c++) {
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const fSpan = cellSpan(f.orientation);
      if (f.cell.row === cell.row && c >= f.cell.col && c < f.cell.col + fSpan) return true;
    }
  }
  return false;
}

/** Следующая свободная ячейка в общей полосе (row 0), справа. */
export function nextCellInStrip(
  frames: { cell: FrameCell; orientation: PageOrientation }[],
  span = 1,
): FrameCell {
  let col = 0;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].cell.row !== 0) continue;
    const end = frames[i].cell.col + cellSpan(frames[i].orientation);
    if (end > col) col = end;
  }
  const cell = { col, row: 0 };
  return cellOccupied(cell, frames, span) ? { col: col + 1, row: 0 } : cell;
}

/** Следующая ячейка ВНИЗ рулона-столбца (row ≥ 1 — под полосой). */
export function nextCellInColumn(
  col: number,
  frames: { cell: FrameCell; orientation: PageOrientation }[],
): FrameCell {
  let row = 1;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].cell.col === col && frames[i].cell.row >= row) {
      row = frames[i].cell.row + 1;
    }
  }
  return { col, row };
}

/**
 * Порядок листов для PDF: выводится из структуры (челлендж «строки/столбцы на
 * выбор» — отвергнут как настройка). Полоса row=0 слева-направо, затем рулоны:
 * столбцы по col, внутри столбца сверху-вниз.
 */
export function compareCellsForExport(a: FrameCell, b: FrameCell): number {
  const aStrip = a.row === 0 ? 0 : 1;
  const bStrip = b.row === 0 ? 0 : 1;
  if (aStrip !== bStrip) return aStrip - bStrip;
  if (aStrip === 0) return a.col - b.col;
  if (a.col !== b.col) return a.col - b.col;
  return a.row - b.row;
}

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
  /**
   * Непрозрачность 0..1. Отсутствует = 1 (обычное перо).
   *
   * Маркер (B6): Ульяна U9 — «этими маркерами очень много работают, особенно
   * учителя русского, химии: показать, что вот эта связь останется, а этот
   * атом уйдёт». Третий репетитор подряд после Елены и Егора.
   *
   * ⚠️ Поле ДОБАВОЧНОЕ и необязательное: старые сцены без него читаются как
   * непрозрачные, поэтому миграция данных не нужна.
   */
  opacity?: number;
}

/** `arrow` — B5: Елена «прям очень нужно», Егор «часто использую». */
export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'arrow';

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

export interface ImageElement extends BoardElementBase {
  type: 'image';
  /** Левый верхний угол НЕповёрнутого прямоугольника, мм. */
  x: number;
  y: number;
  /** Размеры в мм, всегда положительные. */
  w: number;
  h: number;
  /** Поворот в градусах вокруг центра (запрос владельца: фото приходят боком). */
  rotation: number;
  /** `storage://board-images/...` — сам файл; URL резолвится при рендере. */
  ref: string;
}

export type BoardElement = StrokeElement | ShapeElement | TextElement | ImageElement;

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

/**
 * Клон как НОВАЯ сущность: свежие id/seq/nonce, version с единицы. Для вставки
 * из буфера: два элемента с одним id сломали бы memo-рендер и выделение, а
 * старый seq утопил бы копию под более новыми элементами.
 */
export function reassignIdentity<T extends BoardElement>(el: T): T {
  return { ...el, id: createElementId(), seq: nextSeq(), version: 1, versionNonce: nextNonce() };
}

// ─── Фабрики ──────────────────────────────────────────────────────────────────

export function createStroke(
  points: number[],
  color: string,
  size: number,
  opacity?: number,
): StrokeElement {
  const base: StrokeElement = { ...baseFields(), type: 'stroke', points, color, size };
  // Поле пишем только для маркера: обычное перо не должно тащить лишний ключ
  // в jsonb на каждый штрих конспекта.
  return opacity !== undefined && opacity < 1
    ? { ...base, opacity: clampOpacity(opacity) }
    : base;
}

/** 0.05..1; мусор и полная прозрачность → 1 (иначе штрих был бы невидим). */
export function clampOpacity(value: unknown): number {
  const raw = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(raw)) return 1;
  return Math.min(1, Math.max(0.05, raw));
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

export function createImage(
  x: number,
  y: number,
  w: number,
  h: number,
  ref: string,
): ImageElement {
  return { ...baseFields(), type: 'image', x, y, w, h, rotation: 0, ref };
}

// ─── Геометрия ────────────────────────────────────────────────────────────────

export interface BoardBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Кэш границ. Элементы иммутабельны (любая правка = новый объект через
 * bumpVersion), поэтому WeakMap по ссылке корректен и чистится GC сам.
 * Нужен ластику и выделению: без кэша каждый pointermove пересчитывал бы
 * границы КАЖДОГО штриха по всем его точкам (ревью 5.6, P1 hot path).
 */
const boundsCache = new WeakMap<BoardElement, BoardBounds>();

export function elementBoundsCached(el: BoardElement): BoardBounds {
  let bounds = boundsCache.get(el);
  if (!bounds) {
    bounds = elementBounds(el);
    boundsCache.set(el, bounds);
  }
  return bounds;
}

/** Округление до 0.01 мм: 10 микрон — заведомо тоньше пера, а jsonb вдвое легче. */
export function roundMm(value: number): number {
  return Math.round(value * 100) / 100;
}

export function clampToPage(
  x: number,
  y: number,
  size: PageSizeMm = { width: PAGE_WIDTH_MM, height: PAGE_HEIGHT_MM },
): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, 0), size.width),
    y: Math.min(Math.max(y, 0), size.height),
  };
}

export function textLines(el: TextElement): string[] {
  return el.text.split('\n');
}

/** Приблизительная ширина строки: у пропорционального шрифта ≈ 0.5 кегля на символ. */
function approxTextWidthMm(line: string, size: number): number {
  return line.length * size * 0.5;
}

/** Поворот точки вокруг центра на угол в градусах. */
export function rotatePoint(
  px: number,
  py: number,
  cx: number,
  cy: number,
  degrees: number,
): { x: number; y: number } {
  if (degrees === 0) return { x: px, y: py };
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = px - cx;
  const dy = py - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

function imageCorners(el: ImageElement): { x: number; y: number }[] {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  return [
    rotatePoint(el.x, el.y, cx, cy, el.rotation),
    rotatePoint(el.x + el.w, el.y, cx, cy, el.rotation),
    rotatePoint(el.x + el.w, el.y + el.h, cx, cy, el.rotation),
    rotatePoint(el.x, el.y + el.h, cx, cy, el.rotation),
  ];
}

export type ResizeCorner = 'nw' | 'ne' | 'se' | 'sw';

/**
 * Пересчёт прямоугольника при перетаскивании УГЛОВОЙ ручки с учётом поворота:
 * противоположный угол остаётся неподвижным В МИРОВЫХ координатах (иначе
 * повёрнутая картинка «плывёт» при каждом движении ручки).
 *
 * Математика: (w',h') = |R⁻¹(P_мир − O_мир)| покомпонентно; новый центр —
 * из неподвижного угла обратным поворотом. `preserveAspect` (картинки) берёт
 * максимальный из двух масштабов.
 */
export function resizeRectFromCorner(
  rect: { x: number; y: number; w: number; h: number },
  rotation: number,
  corner: ResizeCorner,
  pointerX: number,
  pointerY: number,
  preserveAspect: boolean,
): { x: number; y: number; w: number; h: number } {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  // Противоположный угол в локальных координатах.
  const oppLocal = {
    nw: { x: rect.x + rect.w, y: rect.y + rect.h },
    ne: { x: rect.x, y: rect.y + rect.h },
    se: { x: rect.x, y: rect.y },
    sw: { x: rect.x + rect.w, y: rect.y },
  }[corner];
  const oppWorld = rotatePoint(oppLocal.x, oppLocal.y, cx, cy, rotation);

  // Вектор «неподвижный угол → указатель» в локальной системе прямоугольника.
  const local = rotatePoint(pointerX, pointerY, oppWorld.x, oppWorld.y, -rotation);
  let w = Math.max(2, Math.abs(local.x - oppWorld.x));
  let h = Math.max(2, Math.abs(local.y - oppWorld.y));
  if (preserveAspect && rect.w > 0 && rect.h > 0) {
    const scale = Math.max(w / rect.w, h / rect.h);
    w = rect.w * scale;
    h = rect.h * scale;
  }

  // Знаки направления от неподвижного угла к перетаскиваемому.
  const sign = {
    nw: { x: -1, y: -1 },
    ne: { x: 1, y: -1 },
    se: { x: 1, y: 1 },
    sw: { x: -1, y: 1 },
  }[corner];

  // Центр нового прямоугольника: от неподвижного угла на половину диагонали,
  // повёрнутую в мир.
  const centerOffset = rotatePoint((sign.x * w) / 2, (sign.y * h) / 2, 0, 0, rotation);
  const newCx = oppWorld.x + centerOffset.x;
  const newCy = oppWorld.y + centerOffset.y;

  return { x: roundMm(newCx - w / 2), y: roundMm(newCy - h / 2), w: roundMm(w), h: roundMm(h) };
}

/** Угол «центр → указатель» в градусах; 0° = ручка сверху. Снап к ключевым углам. */
export function rotationFromPointer(
  cx: number,
  cy: number,
  pointerX: number,
  pointerY: number,
): number {
  const deg = (Math.atan2(pointerY - cy, pointerX - cx) * 180) / Math.PI + 90;
  let normalized = ((deg % 360) + 360) % 360;
  // Магнит к 0/90/180/270 (±5°): фото «боком» чаще всего нужно ровно на 90°.
  for (const snap of [0, 90, 180, 270, 360]) {
    if (Math.abs(normalized - snap) <= 5) {
      normalized = snap % 360;
      break;
    }
  }
  return Math.round(normalized);
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
  if (el.type === 'image') {
    // Осевой bbox повёрнутого прямоугольника — по четырём углам.
    const corners = imageCorners(el);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < corners.length; i++) {
      if (corners[i].x < minX) minX = corners[i].x;
      if (corners[i].x > maxX) maxX = corners[i].x;
      if (corners[i].y < minY) minY = corners[i].y;
      if (corners[i].y > maxY) maxY = corners[i].y;
    }
    return { minX, minY, maxX, maxY };
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
  // Быстрый отсев по кэшированному bbox ДО обхода сегментов: ластик зовёт
  // hitTest для всех элементов на каждый pointermove, и без отсева это
  // O(все точки страницы) на событие (ревью 5.6, P1).
  const bb = elementBoundsCached(el);
  if (
    x < bb.minX - tolerance || x > bb.maxX + tolerance ||
    y < bb.minY - tolerance || y > bb.maxY + tolerance
  ) {
    return false;
  }
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
  if (el.type === 'shape' && (el.kind === 'line' || el.kind === 'arrow')) {
    // Расстояние до отрезка, а не до bbox: у диагонали прямоугольник почти
    // весь пустой, и ластик стирал бы её, «зацепив» воздух рядом. Та же
    // причина, по которой штрих меряется по ломаной.
    return (
      pointSegmentDistance(x, y, el.x, el.y, el.x + el.w, el.y + el.h) <=
      tolerance + el.size / 2
    );
  }
  if (el.type === 'image' && el.rotation !== 0) {
    // Точное попадание в ПОВЁРНУТЫЙ прямоугольник: точка приводится в локальную
    // систему обратным поворотом (bbox-отсев выше уже прошёл).
    const cx = el.x + el.w / 2;
    const cy = el.y + el.h / 2;
    const local = rotatePoint(x, y, cx, cy, -el.rotation);
    return (
      local.x >= el.x - tolerance && local.x <= el.x + el.w + tolerance &&
      local.y >= el.y - tolerance && local.y <= el.y + el.h + tolerance
    );
  }
  // Для фигур, текста и неповёрнутых картинок попадание = bbox (проверен выше).
  return true;
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
    x: roundMm((el as ShapeElement | TextElement | ImageElement).x + dx),
    y: roundMm((el as ShapeElement | TextElement | ImageElement).y + dy),
  } as Partial<ShapeElement | TextElement | ImageElement>);
}

/** Кламп фактора масштабирования выделения (Этап 5, запрос Елены/Вадима). */
export const SCALE_FACTOR_MIN = 0.05;
export const SCALE_FACTOR_MAX = 20;
/** Толщина пера/фигур при масштабировании не уходит в невидимое/абсурдное. */
const SCALED_SIZE_MIN_MM = 0.2;
const SCALED_SIZE_MAX_MM = 10;
/** Текст мельче 2 мм нечитаем — не даём «схлопнуть» его масштабом. */
const SCALED_TEXT_MIN_MM = 2;

/**
 * Пропорциональный масштаб элемента вокруг точки (originX, originY), мм.
 * Возвращает новый объект через bumpVersion — LWW-синк (version/versionNonce)
 * обязан увидеть правку, иначе reconcile отдаст элемент удалённой стороне.
 */
export function scaleElement(
  el: BoardElement,
  factor: number,
  originX: number,
  originY: number,
): BoardElement {
  const k = Math.min(SCALE_FACTOR_MAX, Math.max(SCALE_FACTOR_MIN, factor));
  if (el.type === 'stroke') {
    const points = new Array<number>(el.points.length);
    for (let i = 0; i + 2 < el.points.length; i += 3) {
      points[i] = roundMm((el.points[i] - originX) * k + originX);
      points[i + 1] = roundMm((el.points[i + 1] - originY) * k + originY);
      points[i + 2] = el.points[i + 2];
    }
    return bumpVersion(el, {
      points,
      size: Math.min(SCALED_SIZE_MAX_MM, Math.max(SCALED_SIZE_MIN_MM, el.size * k)),
    } as Partial<StrokeElement>);
  }
  if (el.type === 'shape') {
    return bumpVersion(el, {
      x: roundMm((el.x - originX) * k + originX),
      y: roundMm((el.y - originY) * k + originY),
      w: roundMm(el.w * k),
      h: roundMm(el.h * k),
      size: Math.min(SCALED_SIZE_MAX_MM, Math.max(SCALED_SIZE_MIN_MM, el.size * k)),
    } as Partial<ShapeElement>);
  }
  if (el.type === 'text') {
    return bumpVersion(el, {
      x: roundMm((el.x - originX) * k + originX),
      y: roundMm((el.y - originY) * k + originY),
      size: Math.max(SCALED_TEXT_MIN_MM, el.size * k),
    } as Partial<TextElement>);
  }
  // image: rotation сохраняется, масштабируется рамка.
  return bumpVersion(el, {
    x: roundMm((el.x - originX) * k + originX),
    y: roundMm((el.y - originY) * k + originY),
    w: roundMm(el.w * k),
    h: roundMm(el.h * k),
  } as Partial<ImageElement>);
}

// ─── Сериализация ─────────────────────────────────────────────────────────────

/**
 * Санитайзер входа из БД и broadcast'а. На вход нельзя полагаться: битый
 * элемент не должен ронять весь конспект — он просто отбрасывается.
 * ⚠️ Числа проверяются Number.isFinite, НЕ typeof (ревью синк-пасса, P0 №4):
 * JSON.parse("1e999") даёт Infinity — typeof пропускал его, и он ломал
 * bounds-математику (NaN-камера = белый экран).
 */
export function parseElements(raw: unknown): BoardElement[] {
  if (!Array.isArray(raw)) return [];
  const num = (v: unknown): v is number => Number.isFinite(v);
  const out: BoardElement[] = [];
  for (let i = 0; i < raw.length; i++) {
    const el = raw[i] as Partial<BoardElement> | null;
    if (!el || typeof el !== 'object' || typeof el.id !== 'string') continue;
    const base = {
      id: el.id,
      version: num(el.version) ? el.version : 1,
      versionNonce: num(el.versionNonce) ? el.versionNonce : 0,
      seq: num(el.seq) ? el.seq : i + 1,
    };
    if (el.type === 'stroke') {
      const s = el as Partial<StrokeElement>;
      if (!Array.isArray(s.points) || s.points.length < 3) continue;
      out.push({
        ...base,
        type: 'stroke',
        points: s.points.filter(num),
        color: typeof s.color === 'string' ? s.color : BOARD_COLORS[0],
        size: num(s.size) ? s.size : DEFAULT_PEN_SIZE_MM,
        // Отсутствие поля = непрозрачный штрих: сцены, записанные до появления
        // маркера, читаются без миграции.
        ...(num(s.opacity) && s.opacity < 1 ? { opacity: clampOpacity(s.opacity) } : {}),
      });
    } else if (el.type === 'shape') {
      const s = el as Partial<ShapeElement>;
      if (!num(s.x) || !num(s.y)) continue;
      out.push({
        ...base,
        type: 'shape',
        kind:
          s.kind === 'ellipse' || s.kind === 'line' || s.kind === 'arrow' ? s.kind : 'rect',
        x: s.x,
        y: s.y,
        w: num(s.w) ? s.w : 0,
        h: num(s.h) ? s.h : 0,
        color: typeof s.color === 'string' ? s.color : BOARD_COLORS[0],
        size: num(s.size) ? s.size : DEFAULT_PEN_SIZE_MM,
      });
    } else if (el.type === 'image') {
      const s = el as Partial<ImageElement>;
      if (
        !num(s.x) || !num(s.y) || !num(s.w) || !num(s.h) ||
        typeof s.ref !== 'string' || !s.ref.startsWith('storage://')
      ) {
        continue;
      }
      out.push({
        ...base,
        type: 'image',
        x: s.x,
        y: s.y,
        w: Math.abs(s.w),
        h: Math.abs(s.h),
        rotation: num(s.rotation) ? s.rotation : 0,
        ref: s.ref,
      });
    } else if (el.type === 'text') {
      const s = el as Partial<TextElement>;
      if (!num(s.x) || !num(s.y) || typeof s.text !== 'string') continue;
      out.push({
        ...base,
        type: 'text',
        x: s.x,
        y: s.y,
        text: s.text,
        color: typeof s.color === 'string' ? s.color : BOARD_COLORS[0],
        size: num(s.size) ? s.size : DEFAULT_TEXT_SIZE_MM,
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
