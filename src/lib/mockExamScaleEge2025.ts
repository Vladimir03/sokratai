/**
 * ФИПИ 2025 шкала перевода первичных баллов ЕГЭ по физике в тестовые баллы.
 *
 * Source: 4ege.ru ([Шкала перевода баллов ЕГЭ-2025](https://4ege.ru/novosti-ege/4023-shkala-perevoda-ballov-ege.html)).
 * Vladimir verified 2026-05-16 — точные 45 значений.
 *
 * Color bands в источнике (для контекста — НЕ используются в коде):
 *   - Красная зона (не сдал, < МФТИ minimum):  1-7   primary → 5-32   secondary
 *   - Жёлтая зона (порог сдачи 36 тестовых):   8-9   primary → 36-39  secondary
 *   - Зелёная зона (хорошо ≥ 80 тестовых):     35+   primary → 80+    secondary
 *
 * Ключевые пороги:
 *   - 8 primary → 36 secondary (минимум сдачи ЕГЭ для поступления в ВУЗ)
 *   - 36 primary → 82 secondary (~ 80% — «хорошо»)
 *   - 45 primary → 100 secondary (max)
 *
 * Эта шкала применяется ТОЛЬКО для ЕГЭ физика 2025. Для ОГЭ / других предметов /
 * прошлых лет — нужна отдельная таблица.
 */

import { getExamProfile } from '@/lib/examProfiles';

const PRIMARY_TO_SECONDARY_EGE_PHYSICS_2025: Record<number, number> = {
  0: 0,
  // Красная зона (не сдал)
  1: 5,
  2: 9,
  3: 14,
  4: 18,
  5: 23,
  6: 27,
  7: 32,
  // Жёлтая зона (минимальный порог сдачи = 36)
  8: 36,
  9: 39,
  // Зелёная зона начинается с 10 primary
  10: 41,
  11: 43,
  12: 44,
  13: 46,
  14: 48,
  15: 49,
  16: 51,
  17: 53,
  18: 54,
  19: 56,
  20: 58,
  21: 59,
  22: 61,
  23: 62,
  24: 64,
  25: 65,
  26: 67,
  27: 68,
  28: 70,
  29: 71,
  30: 73,
  31: 74,
  32: 76,
  33: 77,
  34: 79,
  // «Хорошо» (≥ 80 тестовых)
  35: 80,
  36: 82,
  37: 84,
  38: 86,
  39: 88,
  40: 90,
  41: 92,
  42: 94,
  43: 96,
  44: 98,
  45: 100,
};

// Бенчмарки первичной шкалы — из ExamProfile registry (техдолг 5.6, 2026-07-23):
// single source `src/lib/examProfiles.ts` (physics:ege). Шкала перевода
// первичный→тестовый (карта выше) остаётся здесь — под smoke §10 parity.
const EGE_PHYSICS_BENCHMARKS = getExamProfile('physics', 'ege')!.benchmarks!;

/** Maximum primary score для ЕГЭ физика 2025 (= benchmarks.maxPrimary registry). */
export const MAX_PRIMARY_EGE_PHYSICS_2025 = EGE_PHYSICS_BENCHMARKS.maxPrimary;
/** Maximum secondary (test) score для ЕГЭ физика 2025. */
export const MAX_SECONDARY_EGE_PHYSICS_2025 = 100;
/** Минимальный порог сдачи ЕГЭ для поступления в ВУЗ (secondary). */
export const PASS_THRESHOLD_SECONDARY_EGE_PHYSICS_2025 = 36;
/** Минимальный первичный для порога сдачи (8 первичных → 36 тестовых). */
export const PASS_THRESHOLD_PRIMARY_EGE_PHYSICS_2025 = EGE_PHYSICS_BENCHMARKS.pass;
/**
 * «Хорошо» — граница школьной оценки «5» (27 первичных ≈ 68 тестовых).
 * Vladimir подтвердил 2026-06-07.
 */
export const GOOD_THRESHOLD_PRIMARY_EGE_PHYSICS_2025 = EGE_PHYSICS_BENCHMARKS.good;

/**
 * Бенчмарки «порог» / «хорошо» (в первичных баллах) для прогресс-бара результата.
 * Шкала применяется ТОЛЬКО для ЕГЭ физика (max 45). Возвращает null, если:
 *   - `totalMax !== 45`, ИЛИ
 *   - `examType` явно НЕ `'ege_physics'` (напр. `'oge_physics'` — у него другая
 *     шкала и оценка 2–5, не 100-балльная).
 * `examType` null/undefined → **null** (ревью 5.6 P1 #6). Раньше трактовался
 * пермиссивно «по max», из-за чего ручные записи (variant = null → max
 * подставлялся 45) и любой предмет без exam_type получали ФИЗИЧЕСКУЮ шкалу и
 * фиктивный тестовый балл /100. С мультипредметностью пермиссивность = ложь.
 * Single source of truth для обоих result-экранов (StudentMockExamResult +
 * PublicMockResult), чтобы не разъезжались.
 *
 * @example
 *   getEgePhysicsBenchmarks({ totalMax: 45, examType: 'ege_physics' }) // → { pass: 8, good: 27 }
 *   getEgePhysicsBenchmarks({ totalMax: 45, examType: 'oge_physics' }) // → null
 *   getEgePhysicsBenchmarks({ totalMax: 20 }) // → null
 */
export function getEgePhysicsBenchmarks(params: {
  totalMax: number | null | undefined;
  examType?: string | null;
}): { pass: number; good: number } | null {
  const { totalMax, examType } = params;
  if (totalMax !== MAX_PRIMARY_EGE_PHYSICS_2025) return null;
  // Строго: только явная физика-ЕГЭ. null/undefined больше НЕ проходит.
  if (examType !== 'ege_physics') return null;
  return {
    pass: PASS_THRESHOLD_PRIMARY_EGE_PHYSICS_2025,
    good: GOOD_THRESHOLD_PRIMARY_EGE_PHYSICS_2025,
  };
}

/**
 * Convert primary score (0..45) → secondary score (0..100).
 * Null-safe: returns null if input is null/undefined/out-of-range.
 *
 * @example
 *   primaryToSecondary(18) // → 54
 *   primaryToSecondary(36) // → 82
 *   primaryToSecondary(45) // → 100
 *   primaryToSecondary(null) // → null
 */
export function primaryToSecondary(primary: number | null | undefined): number | null {
  if (primary === null || primary === undefined) return null;
  if (!Number.isFinite(primary)) return null;
  const rounded = Math.round(primary);
  if (rounded < 0 || rounded > MAX_PRIMARY_EGE_PHYSICS_2025) return null;
  return PRIMARY_TO_SECONDARY_EGE_PHYSICS_2025[rounded] ?? null;
}

/**
 * Format primary + secondary pair as «primary/max ≈ secondary тестовых» для UI.
 * Returns plain string for inline rendering. Если secondary недоступен — только primary.
 *
 * @example
 *   formatPrimaryWithSecondary(18, 45)   // → "18/45 ≈ 54 тестовых"
 *   formatPrimaryWithSecondary(null, 45) // → "—"
 */
export function formatPrimaryWithSecondary(
  primary: number | null | undefined,
  max: number = MAX_PRIMARY_EGE_PHYSICS_2025,
): string {
  if (primary === null || primary === undefined) return '—';
  const secondary = primaryToSecondary(primary);
  if (secondary === null) return `${primary}/${max}`;
  return `${primary}/${max} ≈ ${secondary} тестовых`;
}
