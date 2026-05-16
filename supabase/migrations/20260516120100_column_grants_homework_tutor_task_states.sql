-- Column-level GRANT whitelist on homework_tutor_task_states (2026-05-16, P0 fix)
--
-- Backup defense-in-depth для `stripStudentSensitiveTaskStateFields` edge-function
-- path. До этой миграции:
--   - RLS policy «student_read_own_task_states» (миграция 20260306100000) даёт
--     ученику SELECT на свой row БЕЗ column-level filter.
--   - RLS policy «HW tutor task_states select by assignment owner» (миграция
--     20260422130000) — то же для тутора.
--   - Любой клиент с auth JWT мог сделать
--     `supabase.from('homework_tutor_task_states').select('*')` и прочитать
--     сырые tutor-only поля (`ai_score_comment`, `tutor_score_override_by`,
--     `tutor_force_completed_by`), которые edge-function strip помогает только
--     на service_role path.
--
-- Эта миграция REVOKE'ает SELECT на authenticated role целиком и затем
-- GRANT'ит SELECT только на whitelist колонок. Tutor-only/audit поля остаются
-- доступны только через `service_role` (edge functions) — то есть PostgREST
-- с user JWT их физически не вернёт даже на `.select('*')`.
--
-- Известные клиентские consumer-ы (whitelist sanity-checked):
--   - `src/hooks/useTutorStudentActivity.ts:272` — tutor читает
--     `thread_id, task_id, status, ai_score, earned_score,
--      tutor_score_override, updated_at` — все в whitelist.
--   - Все student-facing reads идут через edge function `homework-api`
--     под service_role, column grants там не применяются (bypass).
--
-- Tutor-only columns (НЕ грантятся authenticated):
--   - ai_score_comment            — AI rationale, нужен только tutor через
--                                   edge function (`handleGetResults`).
--   - tutor_score_override_by     — UUID туторa (audit).
--   - tutor_force_completed_by    — UUID туторa (audit).
--
-- Если в будущем понадобится новая клиентская колонка — добавлять её в GRANT
-- явно. `*` select остаётся заблокированным навсегда (паттерн whitelist).

REVOKE SELECT ON public.homework_tutor_task_states FROM anon, authenticated;

GRANT SELECT (
  id,
  thread_id,
  task_id,
  status,
  attempts,
  best_score,
  available_score,
  earned_score,
  wrong_answer_count,
  hint_count,
  await_mode,
  context_summary,
  last_ai_feedback,
  ai_score,
  tutor_score_override,
  tutor_score_override_comment,
  tutor_score_override_at,
  tutor_force_completed_at,
  created_at,
  updated_at
) ON public.homework_tutor_task_states TO authenticated;

COMMENT ON COLUMN public.homework_tutor_task_states.ai_score_comment IS
  'AI rationale for ai_score. Tutor-only — strip from student via stripStudentSensitiveTaskStateFields AND REVOKE'd from authenticated at column level (see 20260516120100). Access only via service_role / edge functions.';
COMMENT ON COLUMN public.homework_tutor_task_states.tutor_score_override_by IS
  'Audit: tutor user_id who set the override. Tutor-only — column-level REVOKE from authenticated (see 20260516120100). Access only via service_role.';
COMMENT ON COLUMN public.homework_tutor_task_states.tutor_force_completed_by IS
  'Audit trail: tutor user_id who force-closed the task. Tutor-only — column-level REVOKE from authenticated (see 20260516120100). Access only via service_role.';
