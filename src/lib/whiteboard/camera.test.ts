import { describe, expect, it } from 'vitest';
import {
  CELL_STEP_X_MM,
  CELL_STEP_Y_MM,
  cameraToFitBounds,
  cameraWorldWindow,
  cellToPlacement,
  compareCellsForExport,
  frameWorldBounds,
  nextCellInColumn,
  nextCellInStrip,
  nextFramePlacement,
  normalizeFrameCell,
  normalizeFramePlacement,
  screenToWorld,
  worldToViewportPx,
  zoomCameraAt,
} from './model';
import { copyElements, pasteElements } from './boardClipboard';
import { createStroke, createText } from './model';

// Камера холста (B0): математика мир↔экран — фундамент рисования, culling и
// follow-режима (B1). Ошибка здесь = «линия уезжает от стилуса».

describe('камера', () => {
  const viewport = { w: 800, h: 600 };

  it('screenToWorld ↔ worldToViewportPx — взаимно обратны', () => {
    const camera = { cx: 150, cy: 200, zoom: 2.5 };
    const world = screenToWorld(613, 42, camera, viewport);
    const back = worldToViewportPx(world.x, world.y, camera, viewport);
    expect(back.x).toBeCloseTo(613, 6);
    expect(back.y).toBeCloseTo(42, 6);
  });

  it('центр вьюпорта — это центр камеры', () => {
    const camera = { cx: -30, cy: 77, zoom: 1.2 };
    const world = screenToWorld(viewport.w / 2, viewport.h / 2, camera, viewport);
    expect(world.x).toBeCloseTo(-30);
    expect(world.y).toBeCloseTo(77);
  });

  it('zoomCameraAt держит мировую точку под курсором неподвижной', () => {
    const camera = { cx: 100, cy: 100, zoom: 1 };
    const anchor = { x: 160, y: 80 };
    const before = worldToViewportPx(anchor.x, anchor.y, camera, viewport);
    const zoomed = zoomCameraAt(camera, 1.7, anchor);
    const after = worldToViewportPx(anchor.x, anchor.y, zoomed, viewport);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('cameraToFitBounds вписывает bounds целиком (contain)', () => {
    const bounds = { minX: 0, minY: 0, maxX: 180, maxY: 267 };
    const camera = cameraToFitBounds(bounds, viewport, 24);
    const window_ = cameraWorldWindow(camera, viewport);
    expect(window_.minX).toBeLessThanOrEqual(bounds.minX);
    expect(window_.maxX).toBeGreaterThanOrEqual(bounds.maxX);
    expect(window_.minY).toBeLessThanOrEqual(bounds.minY);
    expect(window_.maxY).toBeGreaterThanOrEqual(bounds.maxY);
    // Центр совпадает с центром bounds.
    expect(camera.cx).toBeCloseTo(90);
    expect(camera.cy).toBeCloseTo(133.5);
  });

  it('fit-contain одинаково показывает область в РАЗНЫХ окнах (основа follow B1)', () => {
    const bounds = { minX: 50, minY: 50, maxX: 230, maxY: 317 };
    const laptop = cameraToFitBounds(bounds, { w: 1440, h: 900 });
    const tablet = cameraToFitBounds(bounds, { w: 810, h: 1080 });
    for (const [camera, vp] of [
      [laptop, { w: 1440, h: 900 }],
      [tablet, { w: 810, h: 1080 }],
    ] as const) {
      const win = cameraWorldWindow(camera, vp);
      expect(win.minX).toBeLessThanOrEqual(bounds.minX);
      expect(win.maxX).toBeGreaterThanOrEqual(bounds.maxX);
      expect(win.minY).toBeLessThanOrEqual(bounds.minY);
      expect(win.maxY).toBeGreaterThanOrEqual(bounds.maxY);
    }
  });
});

describe('раскладка рамок', () => {
  it('normalizeFramePlacement: доски Фазы 1 ложатся в ряд', () => {
    expect(normalizeFramePlacement(undefined, 0)).toEqual({ x: 0, y: 0 });
    const second = normalizeFramePlacement(null, 1);
    expect(second.x).toBeGreaterThan(180); // ширина листа + зазор
    expect(second.y).toBe(0);
  });

  it('normalizeFramePlacement принимает валидную позицию и отбрасывает мусор', () => {
    expect(normalizeFramePlacement({ x: 500, y: -20 }, 3)).toEqual({ x: 500, y: -20 });
    expect(normalizeFramePlacement({ x: 'иное' }, 0)).toEqual({ x: 0, y: 0 });
    expect(normalizeFramePlacement({ x: Infinity, y: 0 }, 0)).toEqual({ x: 0, y: 0 });
  });

  it('nextFramePlacement кладёт новую рамку справа от самой правой', () => {
    const frames = [
      { placement: { x: 0, y: 0 }, size: { width: 180, height: 267 } },
      { placement: { x: 300, y: 40 }, size: { width: 267, height: 180 } },
    ];
    const next = nextFramePlacement(frames);
    expect(next.x).toBeGreaterThan(567);
    expect(next.y).toBe(40);
  });

  it('frameWorldBounds — позиция + размер', () => {
    expect(frameWorldBounds({ x: 10, y: 20 }, { width: 180, height: 267 })).toEqual({
      minX: 10,
      minY: 20,
      maxX: 190,
      maxY: 287,
    });
  });
});

describe('сетка Chattern (Этап 2)', () => {
  it('normalizeFrameCell: cell → как есть, legacy {x,y} → ближайшая ячейка, мусор → полоса', () => {
    expect(normalizeFrameCell({ col: 2, row: 1 }, 5)).toEqual({ col: 2, row: 1 });
    // Этап 1 успел записать свободные позиции — привязываем к сетке.
    expect(normalizeFrameCell({ x: 400, y: 0 }, 0)).toEqual({ col: 2, row: 0 });
    expect(normalizeFrameCell(undefined, 3)).toEqual({ col: 3, row: 0 });
  });

  it('nextCellInStrip идёт вправо по полосе; ландшафт занимает две колонки', () => {
    const frames = [
      { cell: { col: 0, row: 0 }, orientation: 'portrait' as const },
      { cell: { col: 1, row: 0 }, orientation: 'landscape' as const },
    ];
    // Ландшафт на col 1 занимает 1..2 → следующая полосная ячейка col 3.
    expect(nextCellInStrip(frames)).toEqual({ col: 3, row: 0 });
    // Рулонные листы (row ≥ 1) на полосу не влияют.
    expect(nextCellInStrip([{ cell: { col: 7, row: 2 }, orientation: 'portrait' }])).toEqual({ col: 0, row: 0 });
  });

  it('nextCellInColumn растит рулон вниз', () => {
    const frames = [
      { cell: { col: 1, row: 1 }, orientation: 'portrait' as const },
      { cell: { col: 1, row: 2 }, orientation: 'portrait' as const },
      { cell: { col: 2, row: 1 }, orientation: 'portrait' as const },
    ];
    expect(nextCellInColumn(1, frames)).toEqual({ col: 1, row: 3 });
    expect(nextCellInColumn(2, frames)).toEqual({ col: 2, row: 2 });
    expect(nextCellInColumn(5, frames)).toEqual({ col: 5, row: 1 });
  });

  it('порядок экспорта: полоса слева-направо, затем рулоны по столбцам сверху-вниз', () => {
    const cells = [
      { col: 1, row: 2 }, // рулон col1, второй лист
      { col: 0, row: 1 }, // рулон col0
      { col: 1, row: 0 }, // полоса, второй
      { col: 0, row: 0 }, // полоса, первый
      { col: 1, row: 1 }, // рулон col1, первый лист
    ];
    const sorted = cells.slice().sort(compareCellsForExport);
    expect(sorted).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 0, row: 1 },
      { col: 1, row: 1 },
      { col: 1, row: 2 },
    ]);
  });

  it('cellToPlacement кратен шагам сетки', () => {
    const p = cellToPlacement({ col: 2, row: 1 });
    expect(p.x).toBe(2 * CELL_STEP_X_MM);
    expect(p.y).toBe(CELL_STEP_Y_MM);
  });
});

describe('внутренний clipboard (B3)', () => {
  it('копия получает новые id и ложится в точку вставки', () => {
    const original = [
      createStroke([0, 0, 0.5, 10, 0, 0.5], '#000', 1),
      createText(5, 5, 'привет', '#000', 6),
    ];
    copyElements(original);
    const pasted = pasteElements({ x: 100, y: 100 });
    expect(pasted).toHaveLength(2);
    const originalIds = new Set(original.map((el) => el.id));
    for (const clone of pasted) {
      expect(originalIds.has(clone.id)).toBe(false);
    }
    // Центр группы приехал в точку вставки.
    const text = pasted.find((el) => el.type === 'text');
    expect(text && 'x' in text ? text.x : 0).toBeGreaterThan(50);
  });

  it('повторная вставка даёт НОВЫЕ id (не дубли первой)', () => {
    copyElements([createStroke([0, 0, 0.5, 5, 5, 0.5], '#000', 1)]);
    const first = pasteElements({ x: 50, y: 50 });
    const second = pasteElements({ x: 60, y: 60 });
    expect(first[0].id).not.toBe(second[0].id);
  });
});
