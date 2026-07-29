// Общий парсер строки board_pages → кадр доски (Этап 3): используется
// студенческим и гостевым вью. Репетиторский Whiteboard.tsx держит свой
// (исторический) конвертер с тем же поведением — при следующем касании
// перевести на этот модуль.

import {
  type BoardBackground,
  type BoardElement,
  type BoardGridMm,
  type FrameCell,
  type FramePlacement,
  type PageOrientation,
  cellToPlacement,
  normalizeBackground,
  normalizeFrameCell,
  normalizeGridMm,
  normalizeOrientation,
  parseElements,
  primeSeqCounter,
} from './model';

export interface SharedFrame {
  id: string;
  elements: BoardElement[];
  background: BoardBackground;
  gridMm: BoardGridMm;
  orientation: PageOrientation;
  cell: FrameCell;
  placement: FramePlacement;
  zoneTutorStudentId: string | null;
  /** Текущий rev листа (base_rev для сохранений). 0 — ещё не известен. */
  rev: number;
}

export interface BoardPageRowLike {
  id: string;
  page_index?: number | null;
  elements?: unknown;
  app_state?: unknown;
  background?: unknown;
  grid_mm?: unknown;
  zone_tutor_student_id?: string | null;
}

export function parseFrameRow(row: BoardPageRowLike, index: number, rev = 0): SharedFrame {
  const elements = parseElements(row.elements);
  primeSeqCounter(elements);
  const appState = (row.app_state ?? {}) as Record<string, unknown>;
  const cell = normalizeFrameCell(appState.frame, index);
  return {
    id: row.id,
    elements,
    background: normalizeBackground(row.background),
    gridMm: normalizeGridMm(row.grid_mm),
    orientation: normalizeOrientation(appState.orientation),
    cell,
    placement: cellToPlacement(cell),
    zoneTutorStudentId: row.zone_tutor_student_id ?? null,
    rev,
  };
}
