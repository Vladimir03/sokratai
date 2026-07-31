import { describe, expect, it } from 'vitest';
import {
  basePenSize,
  computeLayout,
  containerToImage,
  imageToContainer,
  rotateVector,
  rotatedSize,
  unrotateVector,
} from './annotateGeometry';

/**
 * Здесь легче всего перепутать знак и получить пометку, уезжающую в зеркальную
 * сторону, — а заметит это уже репетитор на реальной работе ученика.
 */

const PORTRAIT = { width: 1200, height: 1600 };
const CONTAINER = { width: 1000, height: 600 };

describe('unrotateVector / rotateVector', () => {
  it('обратны друг другу на всех углах', () => {
    for (const degrees of [0, 90, 180, 270] as const) {
      const forward = rotateVector(7, -3, degrees);
      const back = unrotateVector(forward.x, forward.y, degrees);
      expect(back.x).toBeCloseTo(7, 10);
      expect(back.y).toBeCloseTo(-3, 10);
    }
  });

  it('поворот по часовой на 90° в экранной системе: (x,y) → (−y,x)', () => {
    // Сравниваем по значению, а не toEqual: перестановка рождает -0, который
    // численно равен нулю, но не проходит строгое сравнение объектов.
    const forward = rotateVector(10, 0, 90);
    expect(forward.x).toBeCloseTo(0, 10);
    expect(forward.y).toBeCloseTo(10, 10);

    const back = unrotateVector(0, 10, 90);
    expect(back.x).toBeCloseTo(10, 10);
    expect(back.y).toBeCloseTo(0, 10);
  });

  it('целочисленная перестановка, без тригонометрического дрейфа', () => {
    // sin/cos дали бы 6.1e-17 вместо чистого нуля, и координаты накапливали бы
    // ошибку при каждом пересчёте. Модуль — чтобы -0 не мешал сравнению.
    expect(Math.abs(rotateVector(5, 0, 90).x)).toBe(0);
    expect(Math.abs(rotateVector(0, 5, 270).y)).toBe(0);
    expect(Math.abs(unrotateVector(5, 0, 90).x)).toBe(0);
  });
});

describe('rotatedSize', () => {
  it('меняет стороны только на четвертях', () => {
    expect(rotatedSize(PORTRAIT, 90)).toEqual({ width: 1600, height: 1200 });
    expect(rotatedSize(PORTRAIT, 180)).toEqual(PORTRAIT);
  });
});

describe('computeLayout', () => {
  it('вписывает повёрнутый кадр целиком', () => {
    const layout = computeLayout(PORTRAIT, CONTAINER, 90)!;
    const rotated = rotatedSize(PORTRAIT, 90);
    expect(rotated.width * layout.displayScale).toBeLessThanOrEqual(CONTAINER.width + 0.01);
    expect(rotated.height * layout.displayScale).toBeLessThanOrEqual(CONTAINER.height + 0.01);
  });

  it('мелкое фото РАСТЯГИВАЕТ — иначе по нему невозможно рисовать', () => {
    const layout = computeLayout({ width: 100, height: 100 }, CONTAINER, 0)!;
    expect(layout.displayScale).toBeGreaterThan(1);
  });

  it('вырожденные размеры дают null, а не деление на ноль', () => {
    expect(computeLayout({ width: 0, height: 10 }, CONTAINER, 0)).toBeNull();
    expect(computeLayout(PORTRAIT, { width: 0, height: 0 }, 0)).toBeNull();
  });
});

describe('containerToImage / imageToContainer', () => {
  for (const degrees of [0, 90, 180, 270] as const) {
    it(`взаимно обратны при повороте ${degrees}°`, () => {
      const layout = computeLayout(PORTRAIT, CONTAINER, degrees)!;
      const source = { x: 137, y: 942 };
      const back = containerToImage(imageToContainer(source, layout), layout);
      expect(back.x).toBeCloseTo(source.x, 6);
      expect(back.y).toBeCloseTo(source.y, 6);
    });
  }

  it('центр контейнера — это центр снимка при любом угле', () => {
    for (const degrees of [0, 90, 180, 270] as const) {
      const layout = computeLayout(PORTRAIT, CONTAINER, degrees)!;
      const center = containerToImage(layout.center, layout);
      expect(center.x).toBeCloseTo(PORTRAIT.width / 2, 6);
      expect(center.y).toBeCloseTo(PORTRAIT.height / 2, 6);
    }
  });

  it('при 90° верх снимка уходит вправо, а не влево', () => {
    // Зеркальная ошибка знака выглядит правдоподобно, поэтому фиксируем сторону.
    const layout = computeLayout(PORTRAIT, CONTAINER, 90)!;
    const topOfPhoto = imageToContainer({ x: PORTRAIT.width / 2, y: 0 }, layout);
    expect(topOfPhoto.x).toBeGreaterThan(layout.center.x);
    expect(topOfPhoto.y).toBeCloseTo(layout.center.y, 6);
  });
});

describe('basePenSize', () => {
  it('растёт с разрешением — линия одинаково заметна на любом аппарате', () => {
    expect(basePenSize({ width: 4000, height: 3000 })).toBeGreaterThan(
      basePenSize({ width: 600, height: 400 }),
    );
  });

  it('не вырождается в невидимый волосок на крошечном фото', () => {
    expect(basePenSize({ width: 40, height: 30 })).toBeGreaterThanOrEqual(2);
  });
});
