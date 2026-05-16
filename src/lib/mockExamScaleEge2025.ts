/**
 * ФИПИ 2025 шкала перевода первичных баллов ЕГЭ по физике в тестовые баллы.
 *
 * **TODO (Vladimir, перед merge в прод):** проверить таблицу против
 * официального источника Рособрнадзора/ФИПИ «Шкала пересчёта первичных
 * баллов ЕГЭ по физике в тестовые баллы 2025 года». Если есть расхождения —
 * заменить значения. Не отдавать в прод с приблизительными значениями.
 *
 * Source (approximate, training-data based — НЕ официальный документ):
 *   - max primary = 45
 *   - max secondary = 100
 *   - threshold = 11 первичных → 36 тестовых (минимум для поступления в ВУЗ)
 *   - линейный участок 11..40 первичных → 36..91 тестовых
 *   - финальный участок 41..45 первичных → 92..100 тестовых
 *
 * Эта шкала применяется ТОЛЬКО для ЕГЭ физика 2025. Для ОГЭ / других предметов /
 * прошлых лет — нужна отдельная таблица.
 */

const PRIMARY_TO_SECONDARY_EGE_PHYSICS_2025: Record<number, number> = {
  0: 0,
  1: 4,
  2: 7,
  3: 10,
  4: 14,
  5: 17,
  6: 20,
  7: 24,
  8: 27,
  9: 30,
  10: 33,
  11: 36, // минимальный порог
  12: 38,
  13: 40,
  14: 42,
  15: 44,
  16: 46,
  17: 48,
  18: 50,
  19: 52,
  20: 54,
  21: 56,
  22: 58,
  23: 60,
  24: 62,
  25: 64,
  26: 66,
  27: 68,
  28: 70,
  29: 72,
  30: 74,
  31: 76,
  32: 78,
  33: 80,
  34: 82,
  35: 84,
  36: 86,
  37: 88,
  38: 90,
  39: 91,
  40: 92,
  41: 94,
  42: 96,
  43: 97,
  44: 99,
  45: 100,
};

/** Maximum primary score для ЕГЭ физика 2025. */
export const MAX_PRIMARY_EGE_PHYSICS_2025 = 45;
/** Maximum secondary (test) score для ЕГЭ физика 2025. */
export const MAX_SECONDARY_EGE_PHYSICS_2025 = 100;

/**
 * Convert primary score (0..45) → secondary score (0..100).
 * Null-safe: returns null if input is null/undefined/out-of-range.
 *
 * @example
 *   primaryToSecondary(18) // → 50
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
 *   formatPrimaryWithSecondary(18, 45)   // → "18/45 ≈ 50 тестовых"
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
