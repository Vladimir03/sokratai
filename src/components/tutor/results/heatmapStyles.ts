// Shared color/text helpers for Homework Results v2 heatmap (TASK-5 AC-2,
// TASK-6 drill-down mini-cards). Lives in a separate file so Fast Refresh
// still works for HeatmapGrid / TaskMiniCard components.
//
// Cell color thresholds per spec.md P0-3:
//   null         → bg-slate-100 text-slate-400 (—)
//   ratio < 0.3  → bg-red-100 text-red-900
//   ratio < 0.8  → bg-amber-100 text-amber-900
//   ratio >= 0.8 → bg-emerald-100 text-emerald-900

export function formatScore(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toFixed(1);
}

export type CellStyle = {
  className: string;
  text: string;
};

export function getCellStyle(score: number | null, maxScore: number): CellStyle {
  if (score === null) {
    return { className: 'bg-slate-100 text-slate-400', text: '—' };
  }
  const ratio = maxScore > 0 ? score / maxScore : 0;
  const text = `${formatScore(score)}/${formatScore(maxScore)}`;
  if (ratio < 0.3) return { className: 'bg-red-100 text-red-900', text };
  if (ratio < 0.8) return { className: 'bg-amber-100 text-amber-900', text };
  return { className: 'bg-emerald-100 text-emerald-900', text };
}

// ─── Per-student display status (homework-student-totals TASK-2) ─────────────
//
// Derived in HeatmapGrid from per_student[*]:
//   submitted=true                                  → 'completed'
//   submitted=false, total_time_minutes !== null    → 'in_progress'
//   submitted=false, total_time_minutes === null    → 'not_started'
//
// Drives the right-side Балл / Подсказки / Время columns. See
// docs/delivery/features/homework-student-totals/spec.md AC-3 / AC-4.
export type StudentDisplayStatus = 'completed' | 'in_progress' | 'not_started';

/**
 * Format the wall-clock time for the right-side "Время" column.
 *
 * Per spec AC-3 / AC-4:
 * - not_started → '—'
 * - in_progress → '— в процессе'
 * - completed + null minutes → '—'
 * - completed + N minutes → '{N} мин'
 *
 * The status argument is the single source of truth — minutes alone is
 * ambiguous (a not-started student also has `null`). Always pass the
 * derived status from HeatmapGrid.
 */
export function formatTotalTime(
  minutes: number | null,
  status: StudentDisplayStatus,
): string {
  if (status === 'not_started') return '—';
  if (status === 'in_progress') return '— в процессе';
  // completed
  if (minutes === null) return '—';
  return `${minutes} мин`;
}
