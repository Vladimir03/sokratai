-- homework-work-modes (Ф1 минимальный срез, Т1 + anti-leak Т5):
-- 1) work_mode на назначении и шаблоне ('homework' | 'independent'), additive.
-- 2) RESTRICTIVE RLS: в самостоятельной работе до завершения треда ученик не может
--    прочитать вердикты/баллы прямым PostgREST (edge-функции идут под service_role
--    и не затронуты; репетитор-владелец проходит через ветку tutor_id = auth.uid()).
-- Spec: docs/delivery/features/homework-work-modes/spec.md §2

-- 1. Колонки work_mode --------------------------------------------------------

ALTER TABLE public.homework_tutor_assignments
  ADD COLUMN IF NOT EXISTS work_mode text NOT NULL DEFAULT 'homework'
  CHECK (work_mode IN ('homework', 'independent'));

ALTER TABLE public.homework_tutor_templates
  ADD COLUMN IF NOT EXISTS work_mode text NOT NULL DEFAULT 'homework'
  CHECK (work_mode IN ('homework', 'independent'));

-- 2. Helper: видимы ли вердикты треда текущему пользователю -------------------
-- true, когда: обычная домашка ИЛИ самостоятельная уже завершена (thread.status =
-- 'completed') ИЛИ вызывающий — репетитор-владелец назначения ИЛИ админ.
-- Несуществующий тред -> false (fail-closed).
--
-- Админ-ветка ОБЯЗАТЕЛЬНА (ревью-фикс P1 р.1): на homework_tutor_thread_messages
-- и homework_tutor_task_states уже есть permissive-политики «Admin select …»
-- (миграция 20260320154843). RESTRICTIVE-политики ниже AND-ятся со ВСЕМИ
-- permissive, поэтому без этой ветки админка (AdminHWThreadView) теряла бы
-- task_states и assistant-сообщения на любой АКТИВНОЙ самостоятельной.
-- Гард — канонические has_role/is_admin_email (тот же критерий, что в 20260320154843).

CREATE OR REPLACE FUNCTION public.hw_thread_verdicts_visible(_thread_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    has_role(auth.uid(), 'admin'::app_role)
    OR is_admin_email(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM homework_tutor_threads t
      JOIN homework_tutor_student_assignments sa ON sa.id = t.student_assignment_id
      JOIN homework_tutor_assignments a ON a.id = sa.assignment_id
      WHERE t.id = _thread_id
        AND (
          a.work_mode <> 'independent'
          OR t.status = 'completed'
          OR a.tutor_id = auth.uid()
        )
    );
$$;

REVOKE ALL ON FUNCTION public.hw_thread_verdicts_visible(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hw_thread_verdicts_visible(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.hw_thread_verdicts_visible(uuid) TO authenticated, service_role;

-- 3. RESTRICTIVE-политики (AND поверх существующих permissive; additive) ------
-- Сообщения: ученик в незавершённой самостоятельной видит только свои (user)
-- и человеческие тьюторские (tutor) строки; assistant/system (вердикты, интро)
-- скрыты. task_states скрываются целиком (баллы/статусы = вердикт-носители);
-- UI ученика читает их только через edge (service_role), поэтому не ломается.

DROP POLICY IF EXISTS hw_independent_verdict_block_messages ON public.homework_tutor_thread_messages;
CREATE POLICY hw_independent_verdict_block_messages
  ON public.homework_tutor_thread_messages
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    role IN ('user', 'tutor')
    OR public.hw_thread_verdicts_visible(thread_id)
  );

DROP POLICY IF EXISTS hw_independent_verdict_block_task_states ON public.homework_tutor_task_states;
CREATE POLICY hw_independent_verdict_block_task_states
  ON public.homework_tutor_task_states
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (public.hw_thread_verdicts_visible(thread_id));
