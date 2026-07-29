import { describe, expect, it } from 'vitest';
import {
  type StrokeElement,
  PAGE_HEIGHT_MM,
  PAGE_WIDTH_MM,
  clampToPage,
  createShape,
  createStroke,
  createText,
  elementBounds,
  hitTest,
  normalizeBackground,
  normalizeGridMm,
  normalizeOrientation,
  pageSizeMm,
  parseElements,
  translateElement,
} from './model';
import { backgroundToSvg, elementToSvg, pageToSvgString } from './svg';

// Геометрия доски — самая ошибкоопасная часть Фазы 1: точки штриха лежат в
// ПЛОСКОМ массиве тройками [x,y,pressure], и границы циклов там легко сдвинуть
// на один шаг (две такие ошибки уже были пойманы при написании). Тесты чистые,
// без DOM — окружение vitest здесь `node`.

const STRAIGHT_LINE: number[] = [
  0, 0, 0.5,
  10, 0, 0.5,
  20, 0, 0.5,
];

describe('границы элементов', () => {
  it('покрывает ВСЕ точки штриха, включая последнюю', () => {
    const stroke = createStroke(STRAIGHT_LINE, '#000', 1);
    const bounds = elementBounds(stroke);
    // Если цикл не дойдёт до последней тройки, maxX останется 10.
    expect(bounds.maxX).toBeGreaterThanOrEqual(20);
    expect(bounds.minX).toBeLessThanOrEqual(0);
  });

  it('учитывает толщину пера как поле вокруг штриха', () => {
    const thin = elementBounds(createStroke(STRAIGHT_LINE, '#000', 1));
    const thick = elementBounds(createStroke(STRAIGHT_LINE, '#000', 4));
    expect(thick.maxY - thick.minY).toBeGreaterThan(thin.maxY - thin.minY);
  });

  it('нормализует фигуру с отрицательными размерами (тянули влево-вверх)', () => {
    const shape = createShape('rect', 50, 50, -20, -10, '#000', 1);
    const bounds = elementBounds(shape);
    expect(bounds.minX).toBeLessThan(bounds.maxX);
    expect(bounds.minY).toBeLessThan(bounds.maxY);
  });
});

describe('попадание указателя', () => {
  it('ловит последний сегмент штриха, а не только начальные', () => {
    const stroke = createStroke(STRAIGHT_LINE, '#000', 1);
    // Точка на отрезке 10→20: срабатывает только если цикл проходит его целиком.
    expect(hitTest(stroke, 15, 0, 0.5)).toBe(true);
  });

  it('не срабатывает на пустом месте рядом с диагональю', () => {
    const diagonal = createStroke([0, 0, 0.5, 40, 40, 0.5], '#000', 0.5);
    // Угол описанного прямоугольника — далеко от самой линии. Проверка по
    // bounding box дала бы здесь ложное попадание и стирала бы чужие штрихи.
    expect(hitTest(diagonal, 39, 1, 1)).toBe(false);
  });
});

describe('перенос элементов', () => {
  it('сдвигает каждую точку штриха и сохраняет давление', () => {
    const stroke = createStroke(STRAIGHT_LINE, '#000', 1);
    const moved = translateElement(stroke, 5, 3) as StrokeElement;
    expect(moved.points[0]).toBeCloseTo(5);
    expect(moved.points[1]).toBeCloseTo(3);
    expect(moved.points[2]).toBeCloseTo(0.5);
    // Последняя тройка тоже должна уехать — иначе штрих «растянется».
    expect(moved.points[6]).toBeCloseTo(25);
    expect(moved.points[7]).toBeCloseTo(3);
    expect(moved.points[8]).toBeCloseTo(0.5);
  });

  it('инкрементирует версию — на ней держится разрешение конфликтов в Фазе 2', () => {
    const stroke = createStroke(STRAIGHT_LINE, '#000', 1);
    const moved = translateElement(stroke, 1, 1);
    expect(moved.version).toBe(stroke.version + 1);
    expect(moved.id).toBe(stroke.id);
  });

  it('не мутирует исходный элемент', () => {
    const stroke = createStroke(STRAIGHT_LINE.slice(), '#000', 1);
    const before = stroke.points.slice();
    translateElement(stroke, 10, 10);
    expect(stroke.points).toEqual(before);
  });
});

describe('границы страницы', () => {
  it('прижимает координаты к листу', () => {
    expect(clampToPage(-5, -5)).toEqual({ x: 0, y: 0 });
    expect(clampToPage(1e4, 1e4)).toEqual({ x: PAGE_WIDTH_MM, y: PAGE_HEIGHT_MM });
  });
});

describe('чтение сцены из БД', () => {
  it('отбрасывает битые элементы, но сохраняет целые', () => {
    const parsed = parseElements([
      null,
      { id: 'a', type: 'stroke' }, // без points
      { id: 'b', type: 'stroke', points: [0, 0, 0.5, 1, 1, 0.5], color: '#000', size: 1 },
      { id: 'c', type: 'text', x: 1, y: 2, text: 'привет' },
      { id: 'd', type: 'unknown' },
    ]);
    expect(parsed.map((el) => el.id)).toEqual(['b', 'c']);
  });

  it('переживает мусор вместо массива', () => {
    expect(parseElements(null)).toEqual([]);
    expect(parseElements({ nope: true })).toEqual([]);
  });

  it('нормализует разлиновку к допустимым значениям', () => {
    expect(normalizeBackground('лишнее')).toBe('grid');
    expect(normalizeBackground('dots')).toBe('dots');
    expect(normalizeGridMm(7)).toBe(5);
    expect(normalizeGridMm(10)).toBe(10);
  });
});

describe('SVG-слой (общий для экрана и PDF)', () => {
  it('отдаёт штрих ЗАЛИВКОЙ контура, а не обводкой', () => {
    // perfect-freehand возвращает контур пера: обводка убила бы переменную толщину.
    const nodes = elementToSvg(createStroke(STRAIGHT_LINE, '#123456', 1));
    expect(nodes).toHaveLength(1);
    expect(nodes[0].tag).toBe('path');
    expect(nodes[0].attrs.fill).toBe('#123456');
    expect(nodes[0].attrs.stroke).toBe('none');
  });

  it('разбивает многострочный текст на отдельные строки со сдвигом', () => {
    const nodes = elementToSvg(createText(10, 20, 'первая\nвторая', '#000', 6));
    expect(nodes).toHaveLength(2);
    expect(Number(nodes[1].attrs.y)).toBeGreaterThan(Number(nodes[0].attrs.y));
  });

  it('собирает разлиновку в ОДИН узел — тысячи точек не должны стать тысячей элементов', () => {
    const dots = backgroundToSvg('dots', 5);
    expect(dots).toHaveLength(1);
    expect(String(dots[0].attrs.d).length).toBeGreaterThan(100);
    expect(backgroundToSvg('blank', 5)).toHaveLength(0);
  });

  it('экранирует пользовательский текст в экспортируемом SVG', () => {
    // Иначе кавычка или < в подписи ломала бы документ, который уходит в PDF.
    const markup = pageToSvgString(
      [createText(5, 5, '<script>"a" & b', '#000', 6)],
      'blank',
      5,
    );
    expect(markup).not.toContain('<script>');
    expect(markup).toContain('&lt;script&gt;');
    expect(markup).toContain('&amp;');
  });

  it('задаёт viewBox в миллиметрах — из него берётся масштаб печати', () => {
    const markup = pageToSvgString([], 'grid', 5);
    expect(markup).toContain(`viewBox="0 0 ${PAGE_WIDTH_MM} ${PAGE_HEIGHT_MM}"`);
    expect(markup).toContain(`width="${PAGE_WIDTH_MM}mm"`);
  });

  it('при клетке 5 мм в ширину листа укладывается 36 клеток (модель тетради)', () => {
    // spec Р2: это и есть мост между экраном и бумагой.
    expect(PAGE_WIDTH_MM / 5).toBe(36);
  });

  it('горизонтальный лист меняет местами стороны и даёт +48% ширины', () => {
    const portrait = pageSizeMm('portrait');
    const landscape = pageSizeMm('landscape');
    expect(landscape.width).toBe(portrait.height);
    expect(landscape.height).toBe(portrait.width);
    expect(landscape.width / portrait.width).toBeCloseTo(267 / 180, 2);

    const markup = pageToSvgString([], 'grid', 5, undefined, true, landscape);
    expect(markup).toContain(`viewBox="0 0 ${landscape.width} ${landscape.height}"`);
  });

  it('normalizeOrientation отбрасывает мусор к вертикальному', () => {
    expect(normalizeOrientation('landscape')).toBe('landscape');
    expect(normalizeOrientation('иное')).toBe('portrait');
    expect(normalizeOrientation(undefined)).toBe('portrait');
  });
});
