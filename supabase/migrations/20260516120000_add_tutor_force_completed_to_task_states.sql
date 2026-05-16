-- Tutor Force-Complete for guided homework tasks (2026-05-16)
--
-- Adds two audit/marker columns on homework_tutor_task_states to support
-- "tutor closed the task manually" semantics, distinguishing it from
-- "AI verdict CORRECT closed it".
--
-- See:
--   plan: ~/.claude/plans/lexical-brewing-gadget.md
--   CLAUDE.md §6 (manual score override + post-pilot fix)
--   .claude/rules/40-homework-system.md "Heatmap cell inclusion invariant"
--
-- Backward compat:
--   - Existing completed rows get tutor_force_completed_at = NULL (semantically
--     "AI-completed" as baseline). No backfill — retroactive labelling is
--     intentionally avoided.
--   - computeFinalScore chain unchanged: tutor_score_override → earned_score
--     → ai_score → status fallback. Force-complete без override = final
--     остаётся через earned_score/ai_score, иначе max_score fallback.
--
-- Anti-leak (см. stripStudentSensitiveTaskStateFields):
--   - tutor_force_completed_at видимо ученику (нужно для бейджа "Закрыто
--     репетитором").
--   - tutor_force_completed_by audit-only, должен strip'аться перед
--     отправкой ученику.

ALTER TABLE public.homework_tutor_task_states
  ADD COLUMN IF NOT EXISTS tutor_force_completed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS tutor_force_completed_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.homework_tutor_task_states.tutor_force_completed_at IS
  'When set, the task was manually closed by tutor (not by AI CORRECT verdict). Distinguishes tutor force-complete from AI-completed for student UI badge + tutor reopen eligibility.';
COMMENT ON COLUMN public.homework_tutor_task_states.tutor_force_completed_by IS
  'Audit trail. Tutor-only — strip from student-visible task_state via stripStudentSensitiveTaskStateFields.';
