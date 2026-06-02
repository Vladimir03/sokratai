-- Tutor "reviewed" flag on homework_tutor_task_states (2026-06-02, student-progress R1)
--
-- R1-5 «галочка проверено» — паритет с approve-экраном пробника. AI ставит
-- предварительный балл; репетитор ПОДТВЕРЖДАЕТ его перед показом ученику/родителю.
-- До подтверждения балл — черновик; после `tutor_reviewed_at != NULL` — залочен и
-- виден ученику с бейджем «Проверено».
--
-- Семантика ОРТОГОНАЛЬНА `status` (spec §2.1):
--   - `tutor_reviewed_at` != NULL = задача подтверждена репетитором.
--   - Отлична от `tutor_force_completed_at` («закрыто без AI») и от AI-вердикта
--     CORRECT (`status='completed'`). Задача может быть completed но reviewed_at IS
--     NULL (тьютор ещё не подтвердил).
--   - Reopen review = `tutor_reviewed_at = NULL` (mirror reopen force-complete),
--     status НЕ трогается.
--
-- Column-GRANT (mirror 20260516120100): после того как та миграция сделала
-- `REVOKE SELECT ... FROM authenticated` (table-level) + `GRANT SELECT (whitelist)`,
-- НОВЫЕ колонки, добавленные ALTER TABLE, НЕ получают grant автоматически. Значит:
--   - `tutor_reviewed_at` — нужно ЯВНО открыть authenticated (ученик видит бейдж).
--   - `tutor_reviewed_by` — audit, tutor-only: ничего не грантим → authenticated
--     физически не прочитает даже через `.select('*')`. Дополнительно стрипается в
--     `stripStudentSensitiveTaskStateFields` (defense-in-depth, mirror
--     tutor_force_completed_by).

ALTER TABLE public.homework_tutor_task_states
  ADD COLUMN IF NOT EXISTS tutor_reviewed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS tutor_reviewed_by UUID NULL;

-- Открываем только timestamp ученику; tutor_reviewed_by остаётся service_role-only.
GRANT SELECT (tutor_reviewed_at) ON public.homework_tutor_task_states TO authenticated;

COMMENT ON COLUMN public.homework_tutor_task_states.tutor_reviewed_at IS
  'Tutor confirmed (approved) the score — R1-5 «проверено». Student-visible badge. GRANT''ed to authenticated (20260602090000). Orthogonal to status / tutor_force_completed_at.';
COMMENT ON COLUMN public.homework_tutor_task_states.tutor_reviewed_by IS
  'Audit: tutor user_id who reviewed. Tutor-only — NOT granted to authenticated (mirror tutor_force_completed_by). Stripped via stripStudentSensitiveTaskStateFields. Access only via service_role.';
