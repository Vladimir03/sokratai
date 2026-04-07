/**
 * Shared constants and helpers for Homework Results v2 (TutorHomeworkResults).
 *
 * Lives in src/lib (not src/components) so backend tasks/jobs and frontend
 * components can import the same threshold without duplication.
 */

/**
 * Threshold above which a student is considered to over-rely on AI hints
 * for a given homework assignment.
 *
 * Rule: 60% of total tasks, rounded up, with a floor of 1.
 *
 * Example: 5 tasks → ceil(5 * 0.6) = 3 hints triggers the chip.
 */
export const hintOveruseThreshold = (taskCount: number): number =>
  Math.max(1, Math.ceil(taskCount * 0.6));

/**
 * Default neutral preset shown in RemindStudentDialog when a tutor opens
 * a per-student "Напомнить" CTA. Tutors can edit before sending.
 *
 * Tone: warm and supportive, no pressure or guilt.
 */
export const remindPresetMessage = (assignmentTitle: string): string =>
  `Привет! Напоминаю про ДЗ «${assignmentTitle}». Если что-то непонятно — напиши, разберём вместе.`;

/** Message length bounds (must match backend handleRemindStudent validation). */
export const REMIND_MESSAGE_MIN_CHARS = 1;
export const REMIND_MESSAGE_MAX_CHARS = 2000;
