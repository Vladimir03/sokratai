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

// ОГЭ физика 2026 — первичный балл → оценка (официальные пороги ФИПИ, Егор 2026-06-21).
// Max первичный 39. Пороги АБСОЛЮТНЫЕ: «2» 0–9 · «3» 10–19 · «4» 20–29 · «5» 30–39.
// v1 = физика; иные предметы ОГЭ — версионировать по subject.
export const OGE_PHYS_2026 = {
  scale_year: 2026,
  max_primary: 39,
  bands: [
    { min: 30, mark: 5 },
    { min: 20, mark: 4 },
    { min: 10, mark: 3 },
    { min: 0, mark: 2 },
  ],
};

/** ОГЭ-физика: первичный → оценка (2..5) по абсолютным порогам ФИПИ (Σ макс 39). */
export function ogeMark(raw: number | null | undefined, max: number): number | null {
  if (raw == null || !Number.isFinite(raw) || max <= 0) return null;
  const r = Math.max(0, Math.round(raw));
  for (const b of OGE_PHYS_2026.bands) {
    if (r >= b.min) return b.mark;
  }
  return 2;
}
