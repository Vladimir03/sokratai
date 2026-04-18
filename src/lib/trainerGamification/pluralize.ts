/**
 * Russian plural form for "день / дня / дней".
 * 1 → день, 2..4 → дня, 5..20 → дней, 21 → день, 25 → дней, etc.
 */
export function pluralDays(n: number): string {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'дня';
  return 'дней';
}
