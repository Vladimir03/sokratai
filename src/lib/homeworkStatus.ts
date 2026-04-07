// Shared visual presentation for HomeworkAssignmentStatus.
//
// Single source of truth for the tutor-facing homework status badge. Both
// the list page (`TutorHomework.tsx`) and the detail page
// (`TutorHomeworkDetail.tsx`) consume this so any palette / label change
// happens in exactly one place.
//
// Token note: the design system documents `Accent-lt = #DCFCE7` for success
// surfaces but does not yet expose it as a Tailwind token, so we keep the
// stock `green-100/800` utilities here. When/if `bg-accent-soft` lands in
// `tailwind.config.ts`, this is the only file to touch.

import type { HomeworkAssignmentStatus } from '@/lib/tutorHomeworkApi';

export interface HomeworkStatusBadge {
  label: string;
  className: string;
}

export const HOMEWORK_STATUS_CONFIG: Record<HomeworkAssignmentStatus, HomeworkStatusBadge> = {
  draft: {
    label: 'Черновик',
    className: 'bg-muted text-muted-foreground border-muted',
  },
  active: {
    label: 'Активное',
    className:
      'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800',
  },
  closed: {
    label: 'Завершено',
    className:
      'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700',
  },
};

/**
 * Format a homework score as `score/max` (e.g. `2.5/4`, `10/16`) when a
 * positive `maxScore` is given, otherwise as a percentage. Returns `'—'` for
 * null/undefined scores. Trims trailing zeros for half-step values.
 */
export function formatHomeworkScore(score: number | null | undefined, maxScore?: number | null): string {
  if (score === null || score === undefined) return '—';
  if (maxScore != null && maxScore > 0) {
    const s = Number.isInteger(score) ? String(score) : score.toFixed(1);
    const m = Number.isInteger(maxScore) ? String(maxScore) : maxScore.toFixed(1);
    return `${s}/${m}`;
  }
  return `${Math.round(score)}%`;
}
