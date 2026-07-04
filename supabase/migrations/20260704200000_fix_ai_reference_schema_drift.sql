-- HOTFIX 2026-07-04 — schema drift: прод-БД отстала от кода homework-api
--
-- Что случилось: Lovable-коммит 649075d/0ddeca2 («Applied migrations and
-- deployed», 2026-07-04 15:34 UTC) применил к проду НЕ репозиторные миграции
-- Phase A (20260630160000 + 20260630170000), а самодельную урезанную версию
-- (20260704153448_f939de4a-…): из четырёх ai_reference_* колонок добавлена
-- только ai_reference_solution — и с типом jsonb вместо TEXT.
--
-- Следствие: edge homework-api (задеплоен сегодня с кодом Phase A/B/C)
-- SELECT'ит ai_reference_confidence / ai_reference_status /
-- ai_reference_generated_at → PostgREST «column does not exist» →
--   1) handleGetAssignment глотал ошибку → tasks=[] → «В задании нет задач»
--      во ВСЕХ ДЗ у репетиторов;
--   2) грейдинг-SELECTы (check/submission) падали у учеников;
--   3) THREAD_SELECT с ai_nodes_json (Phase C, 20260704160000) мог падать,
--      если та миграция тоже не применилась.
--
-- Эта миграция идемпотентно доводит схему до состояния, которое ожидает код.
-- Reapply-safe: IF NOT EXISTS / условный DO-блок / additive GRANT.

-- 1. Недостающие Phase-A колонки (зеркало 20260630160000; tutor-only —
--    НЕ грантятся authenticated, column-GRANT whitelist 20260630170000 цел).
ALTER TABLE public.homework_tutor_tasks
  ADD COLUMN IF NOT EXISTS ai_reference_confidence TEXT,
  ADD COLUMN IF NOT EXISTS ai_reference_status TEXT,
  ADD COLUMN IF NOT EXISTS ai_reference_generated_at TIMESTAMPTZ;

-- 2. ai_reference_solution: код пишет/читает СТРОКУ (TEXT, 20260630160000).
--    Урезанная миграция создала jsonb → конвертируем с сохранением данных.
--    На средах, где колонка уже TEXT (или отсутствует), блок no-op / ADD.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'homework_tutor_tasks'
      AND column_name = 'ai_reference_solution'
      AND data_type = 'jsonb'
  ) THEN
    ALTER TABLE public.homework_tutor_tasks
      ALTER COLUMN ai_reference_solution TYPE TEXT
      USING CASE
        WHEN ai_reference_solution IS NULL THEN NULL
        WHEN jsonb_typeof(ai_reference_solution) = 'string'
          THEN ai_reference_solution #>> '{}'
        ELSE ai_reference_solution::text
      END;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'homework_tutor_tasks'
      AND column_name = 'ai_reference_solution'
  ) THEN
    ALTER TABLE public.homework_tutor_tasks
      ADD COLUMN ai_reference_solution TEXT;
  END IF;
END $$;

-- 3. Phase C (20260704160000) — переутверждаем на случай, если она не
--    применилась (запушена ПОСЛЕ Lovable-коммита). Полностью идемпотентно.
ALTER TABLE public.homework_tutor_task_states
  ADD COLUMN IF NOT EXISTS ai_nodes_json JSONB NULL;

GRANT SELECT (ai_nodes_json)
  ON public.homework_tutor_task_states
  TO authenticated;
