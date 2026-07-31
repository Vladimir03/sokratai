/**
 * Геометрия разметки поверх фото (волна 2, план 1-ancient-quokka).
 *
 * ⚠️ Координаты разметки — ПИКСЕЛИ НЕПОВЁРНУТОГО фото.
 *
 * Так пометка привязана к самому снимку, а не к тому, как он сейчас показан:
 * репетитор может повернуть фото уже после того, как обвёл ошибку, и обводка
 * останется на том же месте рукописи. Храни мы координаты «как видно», поворот
 * после разметки сдвигал бы её, и это была бы неисправимая для пользователя
 * ошибка — он бы решил, что фича сломана.
 *
 * Тот же выбор делает экспорт бесплатно корректным: и фото, и разметка кладутся
 * на канву ОДНИМ и тем же преобразованием поворота.
 *
 * Всё здесь — чистые функции без DOM: именно тут легче всего перепутать знак и
 * получить пометку, уезжающую в зеркальную сторону.
 */

import { type PhotoDegrees, isQuarterTurn } from '@/lib/photoOrientation';

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface PhotoLayout {
  /** Натуральные размеры НЕповёрнутого фото, px. */
  natural: Size;
  degrees: PhotoDegrees;
  /** Экранных px на один пиксель фото. */
  displayScale: number;
  /** Центр показанного фото в координатах контейнера, px. */
  center: Point;
}

/** Габариты кадра после поворота: на четверти стороны меняются местами. */
export function rotatedSize(natural: Size, degrees: PhotoDegrees): Size {
  return isQuarterTurn(degrees)
    ? { width: natural.height, height: natural.width }
    : { width: natural.width, height: natural.height };
}

/**
 * Раскладка фото, вписанного в контейнер. Масштаб НЕ ограничен единицей:
 * мелкое фото ученика надо растянуть, иначе рисовать по нему невозможно.
 */
export function computeLayout(
  natural: Size,
  container: Size,
  degrees: PhotoDegrees,
): PhotoLayout | null {
  if (natural.width <= 0 || natural.height <= 0) return null;
  if (container.width <= 0 || container.height <= 0) return null;
  const rotated = rotatedSize(natural, degrees);
  const displayScale = Math.min(
    container.width / rotated.width,
    container.height / rotated.height,
  );
  return {
    natural,
    degrees,
    displayScale,
    center: { x: container.width / 2, y: container.height / 2 },
  };
}

/**
 * Обратный поворот вектора на кратный 90° угол.
 *
 * Считаем целочисленной перестановкой, а не через sin/cos: тригонометрия дала бы
 * 6.1e-17 вместо нуля, и координаты пометок накапливали бы дрейф при каждом
 * пересчёте. Ось Y направлена ВНИЗ (экранная система), поэтому поворот по
 * часовой стрелке на 90° это (x, y) → (−y, x), а обратный — (x, y) → (y, −x).
 */
export function unrotateVector(dx: number, dy: number, degrees: PhotoDegrees): Point {
  switch (degrees) {
    case 90:
      return { x: dy, y: -dx };
    case 180:
      return { x: -dx, y: -dy };
    case 270:
      return { x: -dy, y: dx };
    default:
      return { x: dx, y: dy };
  }
}

/** Прямой поворот вектора — зеркало `unrotateVector`. */
export function rotateVector(dx: number, dy: number, degrees: PhotoDegrees): Point {
  switch (degrees) {
    case 90:
      return { x: -dy, y: dx };
    case 180:
      return { x: -dx, y: -dy };
    case 270:
      return { x: dy, y: -dx };
    default:
      return { x: dx, y: dy };
  }
}

/** Точка контейнера (экранные px) → пиксели НЕповёрнутого фото. */
export function containerToImage(point: Point, layout: PhotoLayout): Point {
  const local = unrotateVector(
    point.x - layout.center.x,
    point.y - layout.center.y,
    layout.degrees,
  );
  return {
    x: local.x / layout.displayScale + layout.natural.width / 2,
    y: local.y / layout.displayScale + layout.natural.height / 2,
  };
}

/** Пиксели НЕповёрнутого фото → точка контейнера. Обратна `containerToImage`. */
export function imageToContainer(point: Point, layout: PhotoLayout): Point {
  const local = rotateVector(
    (point.x - layout.natural.width / 2) * layout.displayScale,
    (point.y - layout.natural.height / 2) * layout.displayScale,
    layout.degrees,
  );
  return { x: local.x + layout.center.x, y: local.y + layout.center.y };
}

/**
 * Базовая толщина пера в пикселях фото.
 *
 * ⚠️ Считается от диагонали снимка, а НЕ фиксированным числом: на фото 4000 px
 * линия в 3 px была бы волоском, а на скриншоте 600 px — жирной кляксой.
 * Привязка к диагонали делает пометку одинаково заметной на любом аппарате.
 */
export function basePenSize(natural: Size): number {
  const diagonal = Math.hypot(natural.width, natural.height);
  return Math.max(2, diagonal * 0.0035);
}

/** Три толщины пера, как на доске: тонко / обычно / толсто. */
export const PEN_SIZE_FACTORS = [0.6, 1, 1.8] as const;

/** Кегль текста в пикселях фото. */
export function baseTextSize(natural: Size): number {
  return Math.max(12, Math.hypot(natural.width, natural.height) * 0.022);
}
