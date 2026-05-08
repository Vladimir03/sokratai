// Mock Exams v1 — heatmap cell color helper (TASK-10).
//
// Single source of truth для цветов клеток в `MockExamHeatmap`. Имена
// классов — cell-correct / cell-partial / cell-wrong / cell-empty /
// cell-draft / cell-low-conf — соответствуют именам из mockup.html
// (Screen 3) и спецификации (mock-exams-v1/spec.md §6 UI).
//
// Параллель с homework results: Tailwind tokens напрямую, без CSS
// классов в global stylesheet. См. `src/components/tutor/results/heatmapStyles.ts`
// для аналогичного паттерна.
//
// Семантика клеток в pa.1 (auto-check):
//   cell-correct → ratio === 1
//   cell-partial → 0 < ratio < 1
//   cell-wrong   → ratio === 0 (есть ответ, но 0 баллов)
//   cell-empty   → нет ответа / задача не открыта
//
// Семантика клеток в pa.2 (AI draft, до tutor approval):
//   cell-draft     → AI поставил черновик, confidence=high|medium
//   cell-low-conf  → AI поставил черновик, confidence=low (требует tutor)
//   cell-correct/partial/wrong → tutor подтвердил/изменил, финальный балл
//   cell-empty     → нет фото / пропуск
//
// Phase 1: per-task данные не hydrate'ятся в detail endpoint (только totals
// per attempt). Все task-клетки рендерятся как cell-empty до tutor drill-down.
// Helper `getMockCellStyle` готов к Phase 2 hydration.

export type MockCellKind =
  | 'correct'
  | 'partial'
  | 'wrong'
  | 'empty'
  | 'draft'
  | 'low-conf';

export interface MockCellStyle {
  /** Tailwind classes (bg + text + optional border). */
  className: string;
  /** Текст клетки. `null` → rendering-side решает (em-dash, score, etc.). */
  text: string | null;
}

const KIND_TO_CLASS: Record<MockCellKind, string> = {
  correct: 'bg-emerald-100 text-emerald-900',
  partial: 'bg-amber-100 text-amber-900',
  wrong: 'bg-red-100 text-red-900',
  empty: 'bg-slate-100 text-slate-400',
  draft: 'bg-amber-100 text-amber-900 border border-dashed border-amber-600',
  'low-conf':
    'bg-rose-50 text-rose-900 border border-dashed border-rose-400',
};

/**
 * Resolve cell style from раздельных входов: либо явный `kind`, либо
 * по `(score, maxScore)` для Часть 1 (auto-check семантика).
 *
 * Возвращает class + text. Caller комбинирует с layout-классами клетки.
 */
export function getMockCellStyle(
  score: number | null,
  maxScore: number,
  opts?: { kind?: MockCellKind | null },
): MockCellStyle {
  if (opts?.kind) {
    return { className: KIND_TO_CLASS[opts.kind], text: null };
  }
  if (score === null) {
    return { className: KIND_TO_CLASS.empty, text: '—' };
  }
  if (maxScore <= 0) {
    return { className: KIND_TO_CLASS.empty, text: '—' };
  }
  if (score === 0) {
    return { className: KIND_TO_CLASS.wrong, text: '0' };
  }
  if (score >= maxScore) {
    return { className: KIND_TO_CLASS.correct, text: String(score) };
  }
  return {
    className: KIND_TO_CLASS.partial,
    text: score % 1 === 0 ? String(score) : score.toFixed(1),
  };
}

/**
 * Резолв стиля для итоговых колонок (Часть 1 / Часть 2 / Итого).
 * Те же thresholds что в Homework Results v2 (.claude/rules/40-homework-system.md
 * → AC-2): null → empty, < 0.3 → red, < 0.8 → amber, ≥ 0.8 → emerald.
 */
export function getMockTotalsStyle(
  score: number | null,
  maxScore: number,
): { className: string } {
  if (score === null || maxScore <= 0) {
    return { className: 'text-slate-400' };
  }
  const ratio = score / maxScore;
  if (ratio < 0.3) return { className: 'text-red-700 font-semibold' };
  if (ratio < 0.8) return { className: 'text-amber-700 font-semibold' };
  return { className: 'text-emerald-700 font-semibold' };
}

/** Format helper для табличных значений: целое — без точки, дробное — 1 знак. */
export function formatMockScore(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toFixed(1);
}

/** Mapping для legend-чипов в шапке heatmap'а. */
export const MOCK_CELL_LEGEND: ReadonlyArray<{
  kind: MockCellKind;
  label: string;
}> = [
  { kind: 'correct', label: 'верно' },
  { kind: 'partial', label: 'частично' },
  { kind: 'wrong', label: 'неверно' },
  { kind: 'draft', label: 'AI-черновик' },
  { kind: 'low-conf', label: 'AI не уверен' },
  { kind: 'empty', label: '—' },
];

export function legendChipClassName(kind: MockCellKind): string {
  return KIND_TO_CLASS[kind];
}
