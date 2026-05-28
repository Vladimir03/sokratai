-- Voice-Speaking MVP TASK-1 (2026-05-27) — `ai_criteria_json` on task_states
--
-- Adds nullable JSONB column for AI per-criterion grading breakdown
-- (DELF / ЕГЭ EN / IELTS / ОГЭ language rubrics). Format:
--   [{ "label": "Соответствие заданию", "score": 2, "max": 2, "comment": "..." }, ...]
--
-- Sum of scores MUST equal `ai_score` — validated/normalized in
-- `evaluateStudentAnswer::sanitizeCheckResult` (guided_ai.ts) before write.
-- This mirrors the structured-output pattern of mock-exam-grade's
-- `ai_draft_json.elements_check {I, II, III, IV}` (CLAUDE.md §12) but with
-- named criteria + per-criterion comments and max-scores from the
-- subject-rubric layer (`_shared/subject-rubrics/languages-ege.ts`, §19).
--
-- Visibility contract (spec §5):
--   - VISIBLE to student post-submit. It's a feedback layer alongside
--     `last_ai_feedback` / `ai_score`. Server therefore does NOT add it
--     to `stripStudentSensitiveTaskStateFields` (the tutor-only strip
--     covers `ai_score_comment` + `tutor_force_completed_by`).
--   - Column-level GRANT extended below so authenticated PostgREST
--     `.select('ai_criteria_json')` does not trip the REVOKE introduced
--     in migration `20260516120100`. CLAUDE.md §23 GRANT-whitelist rule.
--
-- Anti-leak:
--   - This field stores the AI's own per-criterion breakdown of `ai_score`
--     in plain prose comments — it never includes tutor solution_text /
--     rubric_text content (existing anti-spoiler retry/scrub flow in
--     `evaluateStudentAnswer` re-applies to any comment string).
--   - Non-language subjects (physics, maths, chemistry, informatics, etc.)
--     leave the column NULL — the prompt does not ask the AI for a
--     breakdown when no rubric template is resolved.
--
-- Backward compat: additive, nullable, idempotent (IF NOT EXISTS). Reapply
-- safe — `GRANT SELECT (col)` is additive at the column level.

ALTER TABLE public.homework_tutor_task_states
  ADD COLUMN IF NOT EXISTS ai_criteria_json JSONB NULL;

COMMENT ON COLUMN public.homework_tutor_task_states.ai_criteria_json IS
  'AI per-criterion grading breakdown for language subjects (DELF / ЕГЭ EN / IELTS / ОГЭ). Format: Array<{label, score, max, comment}>. Sum of scores equals ai_score (validated server-side in evaluateStudentAnswer). NULL for physics / maths / chemistry / other subjects without per-criterion rubric. Visible to student post-submit (feedback layer). Added 2026-05-27 (voice-speaking-mvp TASK-1).';

-- Extend column-GRANT whitelist (mirror 20260516120100, CLAUDE.md §23).
-- Per-column GRANT is additive — pre-existing whitelist preserved.
GRANT SELECT (ai_criteria_json)
  ON public.homework_tutor_task_states
  TO authenticated;
