/**
 * Shared helpers + constants для SubmitSheet draft persistence.
 *
 * Phase 1.2 (preview-QA #6, 2026-05-10) разнесла ответственность:
 *   - SubmitSheet — write side (autosave interval + restore on open + sync
 *     persist on submit-tap)
 *   - HomeworkProblem (parent) — clear side (после CORRECT verdict)
 * Без этого helper файла parent должен был бы знать internal structure
 * SubmitSheet'а, что нарушает encapsulation.
 */

export const DRAFT_STORAGE_PREFIX = 'submitsheet-draft-';

/** Autosave tick: 5s while sheet is open. */
export const AUTOSAVE_INTERVAL_MS = 5_000;

/**
 * localStorage shape for SubmitSheet drafts. Mirrors `SubmitSolutionPayload`
 * minus wire-side normalisation (numeric keeps user's raw form).
 */
export interface SubmitSheetDraftSnapshot {
  numeric: string;
  photos: string[];
  text: string;
  /** Server-clock-independent timestamp for «N сек назад» footer caption. */
  savedAt: number;
}

export function getSubmitSheetDraftKey(taskId: string): string {
  return `${DRAFT_STORAGE_PREFIX}${taskId}`;
}

/**
 * Drop the autosave draft for a specific task. Called by parent after
 * CORRECT verdict — student shouldn't see stale draft если они вернутся
 * на ту же задачу.
 *
 * Silent on storage errors (private mode / quota).
 */
export function clearSubmitSheetDraft(taskId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(getSubmitSheetDraftKey(taskId));
  } catch {
    /* noop */
  }
}
