-- ══════════════════════════════════════════════════════════════════════════
-- Follow-up к 20260723150000 — ревью ChatGPT-5.6, блокер P1 #3.
--
-- Предыдущая версия `hw_template_task_counts` СКЛАДЫВАЛА junction-агрегат и
-- (при `tasks_migrated_at IS NULL`) длину `tasks_json`. В штатных состояниях это
-- корректно, но есть реально достижимый partial-state:
--
--   `handleCreateTemplateFromAssignment` вставляет junction-строки и ОТДЕЛЬНЫМ
--   запросом ставит маркер `tasks_migrated_at`. Если INSERT прошёл, а UPDATE
--   маркера упал, шаблон остаётся legacy c junction-строками → счётчик выдавал
--   `junction + tasks_json` ≈ 2N («шаблон из 22 задач» вместо 11).
--
-- Фикс — ВЗАИМОИСКЛЮЧАЮЩИЙ `CASE`: маркер есть → junction; маркера нет → только
-- `tasks_json`. Двойной счёт невозможен ни в одном состоянии, включая частичное.
--
-- Вторая половина фикса — в edge (`homework-api`): ошибка UPDATE маркера теперь
-- проверяется, и junction-строки откатываются, так что partial-state больше не
-- создаётся вовсе. Эта миграция — defense-in-depth: RPC обязана быть
-- самосогласованной независимо от аккуратности вызывающего кода.
--
-- Сигнатура, гранты и семантика в штатных состояниях не меняются
-- (CREATE OR REPLACE; ретроспективно счётчики не «поедут»).
-- ══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.hw_template_task_counts(p_template_ids UUID[])
RETURNS TABLE (template_id UUID, task_count BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id AS template_id,
    (
      CASE
        -- Ссылочный шаблон (unified-task-model): источник правды — junction.
        -- Сохранённый `tasks_json` у него остаётся как audit и в счёт НЕ идёт.
        WHEN t.tasks_migrated_at IS NOT NULL THEN (
          SELECT COUNT(*) FROM homework_template_tasks htt WHERE htt.template_id = t.id
        )
        -- Легаси-шаблон: длина снимка. Даже если junction-строки уже есть
        -- (недоделанный промоушен), они НЕ прибавляются — см. шапку.
        WHEN jsonb_typeof(t.tasks_json) = 'array' THEN jsonb_array_length(t.tasks_json)
        ELSE 0
      END
    )::BIGINT AS task_count
  FROM homework_tutor_templates t
  WHERE t.id = ANY(p_template_ids);
$$;

REVOKE ALL ON FUNCTION public.hw_template_task_counts(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hw_template_task_counts(UUID[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hw_template_task_counts(UUID[]) TO service_role;

COMMENT ON FUNCTION public.hw_template_task_counts(UUID[]) IS
  'task_count шаблонов одним агрегатом, ВЗАИМОИСКЛЮЧАЮЩИЙ CASE: migrated → junction, legacy → jsonb_array_length. Двойной счёт в partial-state невозможен (ревью 5.6 P1 #3).';
