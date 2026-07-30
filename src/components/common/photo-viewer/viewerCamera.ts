/**
 * Геометрия просмотра фото: вписывание, зум к точке, клампы панорамы.
 *
 * Чистые функции без React и без DOM — чтобы их можно было проверить тестами
 * (клампы и зум-к-точке — ровно то место, где лайтбоксы «уезжают» и картинка
 * улетает за экран).
 *
 * Единицы: пиксели контейнера. `scale` — множитель ОТ ВПИСАННОГО размера,
 * то есть 1 = «вся картинка видна», MAX_SCALE = максимальное увеличение.
 */

import { type PhotoDegrees, isQuarterTurn } from '@/lib/photoOrientation';

export const MIN_SCALE = 1;
/**
 * 8× от вписанного. Для фото тетради, вписанного в ~800 px при исходных 1600,
 * это ~4× сверх нативного разрешения — дальше растёт только размытие, а не
 * читаемость почерка.
 */
export const MAX_SCALE = 8;
/** Во что уходит двойной тап. */
export const DOUBLE_TAP_SCALE = 2.5;

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface CameraView {
  scale: number;
  /** Смещение центра содержимого относительно центра контейнера, px. */
  x: number;
  y: number;
}

export const IDENTITY_VIEW: CameraView = { scale: MIN_SCALE, x: 0, y: 0 };

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Габариты кадра ПОСЛЕ поворота: при 90/270 ширина и высота меняются местами.
 * Пропустить это — значит вписывать повёрнутое фото по старым габаритам, и
 * альбомный лист, повёрнутый в портрет, вылезет за экран.
 */
export function rotatedSize(natural: Size, degrees: PhotoDegrees): Size {
  return isQuarterTurn(degrees)
    ? { width: natural.height, height: natural.width }
    : { width: natural.width, height: natural.height };
}

/**
 * Коэффициент вписывания (contain). Ограничен единицей: мелкий скриншот
 * не растягиваем по умолчанию — пусть остаётся резким, увеличить можно зумом.
 */
export function fitScale(natural: Size, container: Size, degrees: PhotoDegrees): number {
  if (natural.width <= 0 || natural.height <= 0) return 1;
  if (container.width <= 0 || container.height <= 0) return 1;
  const rotated = rotatedSize(natural, degrees);
  return Math.min(1, container.width / rotated.width, container.height / rotated.height);
}

/**
 * Размер НЕПОВЁРНУТОЙ картинки на экране при scale = 1. Именно его задаём
 * элементу `<img>`: поворот применяется поверх transform'ом, поэтому ширина и
 * высота остаются «до поворота».
 */
export function baseImageSize(natural: Size, container: Size, degrees: PhotoDegrees): Size {
  const k = fitScale(natural, container, degrees);
  return { width: natural.width * k, height: natural.height * k };
}

/** Габариты занятой площади при данном scale — уже с учётом поворота. */
export function occupiedSize(
  natural: Size,
  container: Size,
  degrees: PhotoDegrees,
  scale: number,
): Size {
  const base = baseImageSize(natural, container, degrees);
  const rotated = isQuarterTurn(degrees)
    ? { width: base.height, height: base.width }
    : base;
  return { width: rotated.width * scale, height: rotated.height * scale };
}

/**
 * Держит картинку в контейнере: если по оси она меньше контейнера — строго по
 * центру (смещение 0), иначе не даёт увести край внутрь экрана.
 */
export function clampOffset(
  view: CameraView,
  natural: Size,
  container: Size,
  degrees: PhotoDegrees,
): CameraView {
  const occupied = occupiedSize(natural, container, degrees, view.scale);
  const limitX = Math.max(0, (occupied.width - container.width) / 2);
  const limitY = Math.max(0, (occupied.height - container.height) / 2);
  return {
    scale: view.scale,
    x: Math.min(limitX, Math.max(-limitX, view.x)),
    y: Math.min(limitY, Math.max(-limitY, view.y)),
  };
}

/**
 * Зум с сохранением точки под курсором/центроидом пальцев.
 * `anchor` — координаты внутри контейнера (0..width, 0..height).
 */
export function zoomAtPoint(
  view: CameraView,
  anchor: Point,
  nextScaleRaw: number,
  natural: Size,
  container: Size,
  degrees: PhotoDegrees,
): CameraView {
  const nextScale = clampScale(nextScaleRaw);
  if (nextScale === view.scale) return view;

  // Смещение якоря от центра контейнера — в той же системе, что и view.x/y.
  const ax = anchor.x - container.width / 2;
  const ay = anchor.y - container.height / 2;
  const ratio = nextScale / view.scale;

  return clampOffset(
    {
      scale: nextScale,
      x: ax - (ax - view.x) * ratio,
      y: ay - (ay - view.y) * ratio,
    },
    natural,
    container,
    degrees,
  );
}

/** Панорама на дельту с клампом. */
export function panBy(
  view: CameraView,
  delta: Point,
  natural: Size,
  container: Size,
  degrees: PhotoDegrees,
): CameraView {
  return clampOffset(
    { scale: view.scale, x: view.x + delta.x, y: view.y + delta.y },
    natural,
    container,
    degrees,
  );
}

/** Увеличено ли настолько, что панорама имеет смысл (и свайп надо отключить). */
export function isZoomedIn(view: CameraView): boolean {
  return view.scale > MIN_SCALE + 0.01;
}

export function distanceBetween(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function midpointOf(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** CSS-трансформ сцены. Поворот применяется к самой картинке, не здесь. */
export function viewToTransform(view: CameraView): string {
  return `translate3d(${view.x.toFixed(2)}px, ${view.y.toFixed(2)}px, 0) scale(${view.scale.toFixed(4)})`;
}
