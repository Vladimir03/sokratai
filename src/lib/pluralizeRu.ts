/**
 * Русское склонение существительного по числу.
 *
 * @example
 * pluralizeRu(1, ['задача', 'задачи', 'задач'])  // 'задача'
 * pluralizeRu(2, ['задача', 'задачи', 'задач'])  // 'задачи'
 * pluralizeRu(5, ['задача', 'задачи', 'задач'])  // 'задач'
 * pluralizeRu(21, ['задача', 'задачи', 'задач']) // 'задача'
 * pluralizeRu(11, ['задача', 'задачи', 'задач']) // 'задач'
 */
export function pluralizeRu(
  n: number,
  forms: [one: string, few: string, many: string],
): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs >= 11 && abs <= 14) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}
