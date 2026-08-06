export function calculateLessonPaymentAmount(
  durationMin: number,
  hourlyRateCents: number | null | undefined
): number | null {
  if (hourlyRateCents == null || hourlyRateCents <= 0 || durationMin <= 0) {
    return null;
  }

  // Convert hourly rate from cents to rubles and prorate by lesson duration.
  return Math.round((durationMin / 60) * (hourlyRateCents / 100));
}

/**
 * Парсинг поля «Стоимость занятия» при создании/правке.
 * Пусто/мусор/отрицательное → null (= цена выводится из ставки×длительности при списании).
 * «0» → 0 (waive, не списывать). «1700» → 1700. РУБЛИ.
 * Отличается от `parseRubleAmount` (тот отбрасывает 0) — здесь 0 значим.
 * Жил в TutorSchedule.tsx, вынесен при извлечении AddLessonDialog (Волна 1).
 */
export function parseLessonPriceInput(raw: string): number | null {
  const s = (raw ?? '').trim().replace(/\s+/g, '');
  if (s === '') return null;
  if (!/^\d{1,7}$/.test(s)) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
