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
