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
