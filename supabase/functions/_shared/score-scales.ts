// Score scales — Deno mirror of `src/lib/scoreScales.ts` (student-progress R2).
//
// ⚠️ MIRROR INVARIANT: `EGE_PHYS_2026.map`, `egePrimaryToScaled`, `ogeMark` MUST stay
// logically identical to the frontend copy. Grep both before merge. Server uses these
// for `current_level` (last approved mock → scaled), `pct_to_goal`, and the trend series.
// Native-unit rollup FORMATTING lives frontend-only (backend returns raw numbers).
//
// Source table: `docs/delivery/features/student-progress/04-score-scales.md`.
// v1 = 2026, physics-ЕГЭ only; ОГЭ ratio-mark is a placeholder (04-score-scales §4).

export type ScoreKind = "primary" | "ege_scaled" | "oge_grade" | "school_grade";
export type ProgressTrack = "ege" | "oge" | "school";

export const EGE_PHYS_2026 = {
  scale_year: 2026,
  max_primary: 45,
  thresholds: { attestat: 36, vuz: 39 },
  map: [
    0, 5, 9, 14, 18, 23, 27, 32, 36, 39, 40, 43, 44, 46, 48, 49, 51, 53, 54, 56, 58,
    59, 61, 62, 64, 65, 67, 68, 70, 71, 73, 74, 76, 77, 79, 80, 82, 84, 86, 88, 90,
    92, 94, 96, 98, 100,
  ],
};

/** ЕГЭ-физика: первичный → тестовый (0..100). Direct lookup. 21 → 59. */
export function egePrimaryToScaled(primary: number | null | undefined): number | null {
  if (primary == null || !Number.isFinite(primary)) return null;
  const i = Math.max(0, Math.min(EGE_PHYS_2026.map.length - 1, Math.round(primary)));
  return EGE_PHYS_2026.map[i];
}

/** ОГЭ: первичный → оценка (2..5). Ratio placeholder до офиц. per-subject порогов. */
export function ogeMark(raw: number | null | undefined, max: number): number | null {
  if (raw == null || !Number.isFinite(raw) || max <= 0) return null;
  const r = raw / max;
  if (r < 0.4) return 2;
  if (r < 0.55) return 3;
  if (r < 0.75) return 4;
  return 5;
}
