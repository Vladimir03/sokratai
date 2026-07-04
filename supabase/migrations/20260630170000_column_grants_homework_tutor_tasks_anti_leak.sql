-- Column-level GRANT whitelist на homework_tutor_tasks (2026-06-30, P0 anti-leak).
--
-- LEAK (обнаружен при ревью Phase A): RLS-политика «HW students select tasks of
-- assigned assignments» (миграция 20260217110038) даёт УЧЕНИКУ SELECT строк его
-- ДЗ (active/closed) БЕЗ column-level фильтра, а table-level GRANT давал доступ
-- ко ВСЕМ колонкам. Значит ученик мог из консоли:
--   supabase.from('homework_tutor_tasks')
--     .select('correct_answer, solution_text, ai_reference_solution')
--     .eq('assignment_id', <своё ДЗ>)
-- и прочитать ОТВЕТ / эталон / критерии. Edge-функции column-whitelist'ят, но
-- прямой PostgREST их обходит (тот же класс, что закрытая дыра mock-exam,
-- rule 45). Течёт и НОВЫЙ `ai_reference_solution` (Phase A), и ПРЕ-СУЩЕСТВУЮЩИЕ
-- `correct_answer` / `solution_*` / `rubric_*` / `grading_criteria_json` /
-- `ocr_text` / `solution_steps`.
--
-- Фикс — зеркало homework_tutor_task_states (20260516120100): REVOKE SELECT у
-- anon/authenticated, GRANT SELECT только на безопасные колонки. Tutor-only поля
-- остаются доступны ТОЛЬКО через service_role (edge functions) — PostgREST с user
-- JWT их физически не вернёт даже на `.select('*')`.
--
-- Sanity (проверено перед миграцией — НИКТО не читает tutor-only колонки напрямую):
--   - `listStudentAssignments` джойнит homework_tutor_assignments, НЕ tasks.
--   - `getStudentAssignment` / student problem — через service_role edge.
--   - HWDrawer path B делает `.insert(tasks)` БЕЗ `.select()` → SELECT-grant не нужен
--     (INSERT/UPDATE/DELETE grants не тронуты).
--   - Тутор читает через homework-api (service_role) — column grants там bypass.
--   - В `src/` прямых `.from('homework_tutor_tasks').select()` нет.
--
-- Новая клиентская (student-safe) колонка в будущем → добавлять в GRANT явно.
-- `*`-select остаётся заблокированным навсегда (whitelist).

REVOKE SELECT ON public.homework_tutor_tasks FROM anon, authenticated;

GRANT SELECT (
  id,
  assignment_id,
  order_num,
  task_text,
  task_image_url,
  max_score,
  check_format,
  task_kind,
  kim_number,
  cefr_level
) ON public.homework_tutor_tasks TO authenticated;

COMMENT ON COLUMN public.homework_tutor_tasks.correct_answer IS
  'Правильный ответ. Tutor-only — column-level REVOKE от authenticated (20260630170000). Доступ только через service_role / edge. НЕ гранить клиенту.';
COMMENT ON COLUMN public.homework_tutor_tasks.solution_text IS
  'Эталонное решение репетитора (AI-visible). Tutor-only — column-level REVOKE (20260630170000). Доступ только через service_role.';
COMMENT ON COLUMN public.homework_tutor_tasks.ai_reference_solution IS
  'AI-эталон решения (Phase A). Tutor-only — column-level REVOKE от authenticated (20260630170000). Доступ только через service_role. НИКОГДА не гранить authenticated.';
