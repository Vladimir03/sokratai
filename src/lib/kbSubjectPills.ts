import { useMemo } from 'react';

import { KB_SUBJECTS } from '@/types/kb';
import { SUBJECTS } from '@/types/homework';

/**
 * Набор предметов для pills витрины Каталога и пикера «+ из БЗ»:
 * union(якорные каталожные, предметы существующих тем, предметы репетитора,
 * активный) в каноническом порядке `SUBJECTS`; неизвестные id — в конец.
 *
 * Вынесено из `SubjectPills.tsx` отдельным модулем по конвенции репо
 * (react-refresh/only-export-components — как `heatmapStyles.ts`).
 *
 * Персонализация: у репетитора-химика появляется pill «Химия» с честным
 * empty-state, у остальных — без шума.
 */
export function useSubjectPillIds({
  value,
  topicSubjects = [],
  tutorSubjects = [],
}: {
  value: string;
  topicSubjects?: readonly (string | null | undefined)[];
  tutorSubjects?: readonly string[];
}): string[] {
  return useMemo(() => {
    const ids = new Set<string>(KB_SUBJECTS.map((s) => s.id));
    for (const s of topicSubjects) if (s) ids.add(s);
    for (const s of tutorSubjects) {
      // 'other' в pills не выносим — это не предметная витрина.
      if (s !== 'other' && SUBJECTS.some((cs) => cs.id === s)) ids.add(s);
    }
    ids.add(value);
    const order = new Map(SUBJECTS.map((s, i) => [s.id, i]));
    return [...ids].sort(
      (a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99) || a.localeCompare(b),
    );
  }, [topicSubjects, tutorSubjects, value]);
}
