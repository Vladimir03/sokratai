import { describe, expect, it } from 'vitest';
import {
  MAX_SCALE,
  MIN_SCALE,
  baseImageSize,
  clampOffset,
  clampScale,
  fitScale,
  isZoomedIn,
  occupiedSize,
  panBy,
  rotatedSize,
  zoomAtPoint,
} from './viewerCamera';

/**
 * Клампы и зум-к-точке — ровно то место, где лайтбоксы «уезжают»: картинка
 * улетает за экран и вернуть её можно только закрыв окно. Плюс вписывание с
 * поворотом: пропустив смену сторон при 90°, альбомный лист в портрете
 * вылезает за края.
 */

const CONTAINER = { width: 1000, height: 600 };
/** Типичное фото тетради: портрет, длинная сторона 1600. */
const PORTRAIT = { width: 1200, height: 1600 };

describe('rotatedSize', () => {
  it('меняет стороны местами на 90 и 270', () => {
    expect(rotatedSize(PORTRAIT, 90)).toEqual({ width: 1600, height: 1200 });
    expect(rotatedSize(PORTRAIT, 270)).toEqual({ width: 1600, height: 1200 });
  });

  it('оставляет стороны на 0 и 180', () => {
    expect(rotatedSize(PORTRAIT, 0)).toEqual({ width: 1200, height: 1600 });
    expect(rotatedSize(PORTRAIT, 180)).toEqual({ width: 1200, height: 1600 });
  });
});

describe('fitScale', () => {
  it('вписывает по узкой стороне', () => {
    // Портрет 1200×1600 в 1000×600: ограничение по высоте → 600/1600.
    expect(fitScale(PORTRAIT, CONTAINER, 0)).toBeCloseTo(600 / 1600, 5);
  });

  it('после поворота вписывает по ДРУГОЙ стороне', () => {
    // Повёрнутый кадр 1600×1200: ограничение всё ещё по высоте → 600/1200.
    expect(fitScale(PORTRAIT, CONTAINER, 90)).toBeCloseTo(600 / 1200, 5);
  });

  it('не увеличивает мелкое фото по умолчанию — оно осталось бы мыльным', () => {
    expect(fitScale({ width: 200, height: 100 }, CONTAINER, 0)).toBe(1);
  });

  it('не падает на нулевых размерах', () => {
    expect(fitScale({ width: 0, height: 0 }, CONTAINER, 0)).toBe(1);
    expect(fitScale(PORTRAIT, { width: 0, height: 0 }, 0)).toBe(1);
  });
});

describe('baseImageSize', () => {
  it('после поворота на 90 повёрнутый кадр помещается в контейнер', () => {
    const base = baseImageSize(PORTRAIT, CONTAINER, 90);
    // Элемент задаётся в НЕповёрнутых размерах, на экране стороны меняются.
    expect(base.height).toBeLessThanOrEqual(CONTAINER.width + 0.01);
    expect(base.width).toBeLessThanOrEqual(CONTAINER.height + 0.01);
  });
});

describe('clampScale', () => {
  it('держит границы и переживает мусор', () => {
    expect(clampScale(0.1)).toBe(MIN_SCALE);
    expect(clampScale(999)).toBe(MAX_SCALE);
    expect(clampScale(Number.NaN)).toBe(MIN_SCALE);
    expect(clampScale(3)).toBe(3);
  });
});

describe('clampOffset', () => {
  it('во вписанном виде центрирует — смещаться некуда', () => {
    const clamped = clampOffset({ scale: 1, x: 400, y: 400 }, PORTRAIT, CONTAINER, 0);
    expect(clamped.x).toBe(0);
    expect(clamped.y).toBe(0);
  });

  it('при увеличении не даёт увести край внутрь экрана', () => {
    const scale = 4;
    const occupied = occupiedSize(PORTRAIT, CONTAINER, 0, scale);
    const limitX = (occupied.width - CONTAINER.width) / 2;

    const clamped = clampOffset({ scale, x: 99999, y: 0 }, PORTRAIT, CONTAINER, 0);
    expect(clamped.x).toBeCloseTo(limitX, 5);

    const clampedNegative = clampOffset({ scale, x: -99999, y: 0 }, PORTRAIT, CONTAINER, 0);
    expect(clampedNegative.x).toBeCloseTo(-limitX, 5);
  });

  it('ось, по которой картинка уже меньше контейнера, остаётся по центру', () => {
    // На scale=1.2 портрет по ширине всё ещё уже контейнера.
    const clamped = clampOffset({ scale: 1.2, x: 500, y: 0 }, PORTRAIT, CONTAINER, 0);
    expect(clamped.x).toBe(0);
  });
});

describe('zoomAtPoint', () => {
  it('удерживает точку под курсором на месте', () => {
    // Якорь в центре: смещение обязано остаться нулевым.
    const zoomed = zoomAtPoint(
      { scale: 1, x: 0, y: 0 },
      { x: CONTAINER.width / 2, y: CONTAINER.height / 2 },
      2,
      PORTRAIT,
      CONTAINER,
      0,
    );
    expect(zoomed.scale).toBe(2);
    expect(zoomed.x).toBe(0);
    expect(zoomed.y).toBe(0);
  });

  it('при зуме в левый край уводит картинку вправо', () => {
    const zoomed = zoomAtPoint(
      { scale: 1, x: 0, y: 0 },
      { x: 0, y: CONTAINER.height / 2 },
      4,
      PORTRAIT,
      CONTAINER,
      0,
    );
    expect(zoomed.scale).toBe(4);
    expect(zoomed.x).toBeGreaterThan(0);
  });

  it('не выходит за MAX_SCALE и сразу клампит смещение', () => {
    const zoomed = zoomAtPoint(
      { scale: 1, x: 0, y: 0 },
      { x: 0, y: 0 },
      10_000,
      PORTRAIT,
      CONTAINER,
      0,
    );
    expect(zoomed.scale).toBe(MAX_SCALE);
    const occupied = occupiedSize(PORTRAIT, CONTAINER, 0, MAX_SCALE);
    expect(Math.abs(zoomed.x)).toBeLessThanOrEqual((occupied.width - CONTAINER.width) / 2 + 0.01);
  });
});

describe('panBy', () => {
  it('во вписанном виде не двигает — иначе жест конфликтовал бы со свайпом', () => {
    const panned = panBy({ scale: 1, x: 0, y: 0 }, { x: 200, y: 200 }, PORTRAIT, CONTAINER, 0);
    expect(panned).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it('при увеличении двигает и клампит', () => {
    const panned = panBy({ scale: 4, x: 0, y: 0 }, { x: 50, y: 30 }, PORTRAIT, CONTAINER, 0);
    expect(panned.x).toBeCloseTo(50, 5);
    expect(panned.y).toBeCloseTo(30, 5);
  });
});

describe('isZoomedIn', () => {
  it('порог не срабатывает на арифметическом шуме', () => {
    expect(isZoomedIn({ scale: 1, x: 0, y: 0 })).toBe(false);
    expect(isZoomedIn({ scale: 1.001, x: 0, y: 0 })).toBe(false);
    expect(isZoomedIn({ scale: 1.5, x: 0, y: 0 })).toBe(true);
  });
});
