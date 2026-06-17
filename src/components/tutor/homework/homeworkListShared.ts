// Общие helpers/константы списка ДЗ — вынесены из TutorHomework.tsx, чтобы их
// переиспользовала страница папки (HomeworkFolderPage). Чистый модуль (без JSX)
// → react-refresh/only-export-components не срабатывает. Запрос Елены (2026-06-17).
import type { CSSProperties } from 'react';
import { parseISO } from 'date-fns';
import type {
  HomeworkAssignmentsFilter,
  TutorHomeworkAssignmentListItem,
} from '@/lib/tutorHomeworkApi';

export const FILTER_TABS: { value: HomeworkAssignmentsFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'active', label: 'Активные' },
  { value: 'closed', label: 'Завершённые' },
];

export type HomeworkSortKey = 'created_desc' | 'deadline_asc';

export const SORT_OPTIONS: { value: HomeworkSortKey; label: string }[] = [
  { value: 'created_desc', label: 'Новые первыми' },
  { value: 'deadline_asc', label: 'По дедлайну' },
];

export function sortAssignments(
  items: TutorHomeworkAssignmentListItem[],
  sortKey: HomeworkSortKey,
): TutorHomeworkAssignmentListItem[] {
  const sorted = [...items];
  switch (sortKey) {
    case 'created_desc':
      sorted.sort((a, b) => {
        const da = a.created_at ? parseISO(a.created_at).getTime() : 0;
        const db = b.created_at ? parseISO(b.created_at).getTime() : 0;
        return (isNaN(db) ? 0 : db) - (isNaN(da) ? 0 : da);
      });
      break;
    case 'deadline_asc':
      sorted.sort((a, b) => {
        const ta = a.deadline ? parseISO(a.deadline).getTime() : NaN;
        const tb = b.deadline ? parseISO(b.deadline).getTime() : NaN;
        const aValid = !isNaN(ta);
        const bValid = !isNaN(tb);
        if (!aValid && !bValid) return 0;
        if (!aValid) return 1;
        if (!bValid) return -1;
        return ta - tb;
      });
      break;
  }
  return sorted;
}

function toHexWithAlpha(color: string, alphaHex: string): string | null {
  const trimmed = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return `${trimmed}${alphaHex}`;
  }
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const expanded = `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
    return `${expanded}${alphaHex}`;
  }
  return null;
}

export function getGroupBadgeStyle(color: string | null): CSSProperties | undefined {
  const trimmed = color?.trim();
  if (!trimmed) return undefined;

  const backgroundColor = toHexWithAlpha(trimmed, '1A');
  return {
    color: trimmed,
    borderColor: trimmed,
    ...(backgroundColor ? { backgroundColor } : {}),
  };
}
