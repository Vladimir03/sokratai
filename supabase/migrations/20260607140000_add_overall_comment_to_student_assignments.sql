-- Phase 12 (2026-06-07): Общий комментарий репетитора к ДЗ (per-student wrap-up).
--
-- Репетитор оставляет один свободный комментарий ко ВСЕМУ ДЗ конкретному ученику
-- (напр. «Вася, ты молодец, но было две ошибки на закон Ома, повтори его»).
-- Хранится на per-student link-таблице (1:1 на пару ученик+ДЗ) — естественный дом.
--
-- Anti-leak:
--   * tutor_overall_comment + tutor_overall_comment_at — student-visible BY DESIGN
--     (mirror homework_tutor_task_states.tutor_score_override_comment). Отдаются
--     ученику через service_role edge (handleGetStudentProblem / handleGetStudentAssignment)
--     и через RLS list-select (StudentHomework badge).
--   * tutor_overall_comment_by — audit-only, НИКОГДА не возвращается клиенту
--     (mirror tutor_force_completed_by). Никаких client-SELECT этой колонки.
--
-- GRANT: homework_tutor_student_assignments использует table-level GRANT + RLS
-- (НЕ column-grant whitelist как homework_tutor_task_states — см.
-- 20260327200000_delivery_multichannel.sql, которая просто ADD COLUMN).
-- Поэтому отдельный GRANT на новые колонки НЕ нужен — они покрыты table-level grant.
--
-- Additive, idempotent. Backward-compat: NULL по умолчанию → карточка/бейдж скрыты.

ALTER TABLE public.homework_tutor_student_assignments
  ADD COLUMN IF NOT EXISTS tutor_overall_comment TEXT NULL,
  ADD COLUMN IF NOT EXISTS tutor_overall_comment_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS tutor_overall_comment_by UUID NULL;

COMMENT ON COLUMN public.homework_tutor_student_assignments.tutor_overall_comment IS
  'Общий комментарий репетитора ко всему ДЗ для этого ученика (per-student wrap-up). Student-visible by design (mirror tutor_score_override_comment).';
COMMENT ON COLUMN public.homework_tutor_student_assignments.tutor_overall_comment_at IS
  'Когда комментарий последний раз сохранён/изменён (ISO). NULL = комментария нет.';
COMMENT ON COLUMN public.homework_tutor_student_assignments.tutor_overall_comment_by IS
  'Audit: auth.users.id репетитора, оставившего комментарий. TUTOR-ONLY — никогда не возвращается клиенту (mirror tutor_force_completed_by).';
