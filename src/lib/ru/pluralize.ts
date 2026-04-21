/**
 * Russian plural form selector.
 *
 * @param count - number to pluralize
 * @param forms - [one, few, many] — e.g. ['урок', 'урока', 'уроков']
 * @returns the correct plural form for `count`
 *
 * @example
 * pluralize(1, ['урок', 'урока', 'уроков']) // 'урок'
 * pluralize(2, ['урок', 'урока', 'уроков']) // 'урока'
 * pluralize(5, ['урок', 'урока', 'уроков']) // 'уроков'
 */
export function pluralize(
  count: number,
  forms: readonly [string, string, string],
): string {
  const n = Math.abs(Math.trunc(count));
  const mod10 = n % 10;
  const mod100 = n % 100;

  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

export const PLURAL_LESSONS = ['урок', 'урока', 'уроков'] as const;
export const PLURAL_WORKS = ['работа', 'работы', 'работ'] as const;
export const PLURAL_STUDENTS = ['ученик', 'ученика', 'учеников'] as const;
export const PLURAL_STUDENTS_ATTENTION = [
  'ученик требует внимания',
  'ученика требуют внимания',
  'учеников требуют внимания',
] as const;
export const PLURAL_ASSIGNMENTS = ['задание', 'задания', 'заданий'] as const;
export const PLURAL_SESSIONS = ['занятие', 'занятия', 'занятий'] as const;
