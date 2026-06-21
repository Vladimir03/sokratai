// Score scales for «Прогресс ученика» (student-progress R2).
//
// Single source of truth for ЕГЭ-физика primary→scaled lookup, ОГЭ ratio-mark,
// and native-unit rollup formatting. Color of cells is ALWAYS % of max
// (exam-agnostic) — handled by `heatmapStyles.getCellStyle`, NOT here.
//
// ⚠️ DENO MIRROR: `supabase/functions/_shared/score-scales.ts` must stay logically
// identical (EGE_PHYS_2026.map + egePrimaryToScaled + ogeMark). Grep both before
// merge. Source of the table: `docs/delivery/features/student-progress/04-score-scales.md`
// + `design-handoff/hero2/data.js`.
//
// Каверзный инвариант (04-score-scales): официальная шкала ФИПИ публикуется весной →
// версионируется по году (`scale_year`). v1 = 2026, physics-ЕГЭ only.

export type ScoreKind = 'primary' | 'ege_scaled' | 'oge_grade' | 'school_grade';
export type ProgressTrack = 'ege' | 'oge' | 'school';

// ЕГЭ физика 2026 — первичный → тестовый (официальная таблица ФИПИ). Index =
// первичный балл (0..45), value = тестовый (0..100). No interpolation — pure lookup.
export const EGE_PHYS_2026 = {
  scale_year: 2026,
  max_primary: 45,
  // тест-баллы: порог аттестата / вуза
  thresholds: { attestat: 36, vuz: 39 },
  map: [
    0, 5, 9, 14, 18, 23, 27, 32, 36, 39, 40, 43, 44, 46, 48, 49, 51, 53, 54, 56, 58,
    59, 61, 62, 64, 65, 67, 68, 70, 71, 73, 74, 76, 77, 79, 80, 82, 84, 86, 88, 90,
    92, 94, 96, 98, 100,
  ] as const,
};

/** ЕГЭ-физика: первичный → тестовый (0..100). Direct lookup. 21 → 59, 23 → 62. */
export function egePrimaryToScaled(primary: number | null | undefined): number | null {
  if (primary == null || !Number.isFinite(primary)) return null;
  const i = Math.max(0, Math.min(EGE_PHYS_2026.map.length - 1, Math.round(primary)));
  return EGE_PHYS_2026.map[i];
}

// ОГЭ физика 2026 — первичный балл → оценка (официальные пороги ФИПИ, предоставил
// Егор 2026-06-21). Max первичный 39. Пороги АБСОЛЮТНЫЕ (не ratio):
// «2» 0–9 · «3» 10–19 · «4» 20–29 · «5» 30–39. v1 = физика; для других предметов ОГЭ
// (иные пороги/max) — версионировать по subject.
export const OGE_PHYS_2026 = {
  scale_year: 2026,
  max_primary: 39,
  // min — нижняя граница первичного балла для оценки (проверяются сверху вниз).
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

/** Trim trailing zero, comma decimal for RU display: 2.5 → «2,5», 2.0 → «2». */
export function formatScoreNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
}

export interface NativeRollup {
  /** Primary line, e.g. «23/45», «9/12», «4». */
  main: string;
  /** Native-unit suffix line, e.g. «≈59 ЕГЭ», «оценка 4». null if none. */
  sub: string | null;
  /** Inline suffix for primary, e.g. «б». null if none. */
  suffix: string | null;
  /** Fraction of max (0..1) for cell color. null when no score. */
  ratio: number | null;
  /** True for holistic «оценка N» marks (school) — no «/max». */
  markTag: boolean;
}

/**
 * Native-unit rollup per `score_kind` (mirror `hero2/data.js::rollup`). Color =
 * `ratio` everywhere. НЕ усреднять разные шкалы в одно число (spec §11 Q2).
 */
export function rollupByScoreKind(
  scoreKind: ScoreKind,
  raw: number | null | undefined,
  rawMax: number,
): NativeRollup {
  if (raw == null || !Number.isFinite(raw)) {
    return { main: '—', sub: null, suffix: null, ratio: null, markTag: false };
  }
  const ratio = rawMax > 0 ? raw / rawMax : null;
  switch (scoreKind) {
    case 'ege_scaled': {
      const scaled = egePrimaryToScaled(raw);
      return {
        main: `${formatScoreNumber(raw)}/${rawMax}`,
        sub: scaled != null ? `≈${scaled} ЕГЭ` : null,
        suffix: null,
        ratio,
        markTag: false,
      };
    }
    case 'oge_grade': {
      const mark = ogeMark(raw, rawMax);
      return {
        main: `${formatScoreNumber(raw)}/${rawMax}`,
        sub: mark != null ? `оценка ${mark}` : null,
        suffix: null,
        ratio,
        markTag: false,
      };
    }
    case 'school_grade':
      return {
        main: `${formatScoreNumber(raw)}`,
        sub: null,
        suffix: null,
        ratio: rawMax > 0 ? raw / rawMax : raw / 5,
        markTag: true,
      };
    case 'primary':
    default:
      return {
        main: `${formatScoreNumber(raw)}/${rawMax}`,
        sub: null,
        suffix: 'б',
        ratio,
        markTag: false,
      };
  }
}

/** Native-scale bounds + thresholds for the goal card per track. */
export function goalScaleForTrack(track: ProgressTrack): {
  floor: number;
  ceil: number;
  noun: string;
  thresholds: { v: number; label: string }[];
} {
  if (track === 'ege') {
    return {
      floor: 0,
      ceil: 100,
      noun: 'балл',
      thresholds: [
        { v: EGE_PHYS_2026.thresholds.attestat, label: 'аттестат' },
        { v: EGE_PHYS_2026.thresholds.vuz, label: 'вуз' },
      ],
    };
  }
  // oge / school — оценка 2..5
  return { floor: 2, ceil: 5, noun: 'оценка', thresholds: [] };
}
