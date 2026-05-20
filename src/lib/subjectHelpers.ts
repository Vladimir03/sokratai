/**
 * Subject UX helpers. Distinct from `getSubjectLabel` in `@/types/homework`
 * (label rendering) — this module classifies subjects for **UX adaptations**
 * inside the student homework problem screen.
 *
 * See plan §«UX (Phase 2 — humanities-aware)»: для письменных гуманитарных
 * предметов (French / English / Russian письмо / сочинение по литературе)
 * стандартный «Краткий ответ»/«Развёрнутое решение» banner и numeric input
 * в SubmitSheet звучат как физика. Этот хелпер — единый switch для
 * humanities-aware UX в `ProblemContext.tsx` и `SubmitSheet.tsx`.
 */

const HUMANITIES_WRITING_SUBJECTS = new Set<string>([
  "russian",
  "literature",
  "english",
  "french",
  "spanish",
  // Legacy aliases (see `LEGACY_SUBJECT_LABELS` in @/types/homework).
  "rus",
]);

/**
 * Returns true for subjects where the canonical extended task is a piece of
 * **writing** — letter, essay, composition — rather than a numeric problem
 * with computed answer.
 *
 * UX implications when true (only in combination with `task_kind === 'extended'`):
 * - Numeric input row in SubmitSheet is hidden (no «числовой ответ» для письма).
 * - Big-CTA subtitle says «Текст или фото готового решения» instead of
 *   «Ответ + фото решения от руки».
 * - amber-banner in ProblemContext says «Это письменная задача — напиши
 *   развёрнутый ответ с ходом рассуждений» instead of physics-flavoured
 *   «покажи ход рассуждений».
 *
 * Defensive: accepts unknown/empty subjects (returns false) — non-humanities
 * subjects keep existing physics/maths-oriented UX.
 */
export function isHumanitiesWritingSubject(subject: string | null | undefined): boolean {
  if (!subject) return false;
  // Phase 7 round 2 (2026-05-20): `.toLowerCase()` для symmetry с Deno
  // mirror (`_shared/subject-rubrics/index.ts::isHumanitiesSubject`) и
  // `GuidedChatMessage.tsx::isHumanitiesWritingSubjectLocal`. DB CHECK
  // constraint хранит subject lowercase, но defensive normalization
  // против case-mismatch (например, если когда-то в БД попадёт «French»).
  return HUMANITIES_WRITING_SUBJECTS.has(subject.trim().toLowerCase());
}
