// Mock Exams v1 — pure helper for inferring contact type from a free-form
// "Telegram or email" lead capture input.
//
// Heuristic only — server validates separately. Used by `PublicMockInvite`
// (TASK-14) to set `contact_type` field of the lead row, and to drive the
// post-submit success-state's "репетитор свяжется в Telegram/email" copy.
//
// Test coverage: `scripts/test-mockexam-contact-type.mjs`.

import type { ContactType } from './mockExamPublicApi';

/**
 * Heuristic for "is this a Telegram contact or an email?":
 *
 * - Leading `@` → Telegram (e.g. `@misha_dad`).
 *   Critical: a previous version classified anything with `@` as email,
 *   which silently mis-routed a real lead's success-state copy
 *   ("свяжется в email" instead of "в Telegram"). Caught in smoke 2026-05-07.
 * - Non-leading `@` → email (e.g. `parent@example.com`).
 * - Otherwise → Telegram (bare username `misha_dad`, phone `+7…`,
 *   `t.me/foo`, etc.).
 *
 * Server-side `mock-exam-public::handleInviteStart` performs canonical
 * validation; this is purely for UX inference.
 */
export function detectContactType(value: string): ContactType {
  const trimmed = value.trim();
  if (trimmed.startsWith('@')) return 'telegram';
  const at = trimmed.indexOf('@');
  return at > 0 ? 'email' : 'telegram';
}
