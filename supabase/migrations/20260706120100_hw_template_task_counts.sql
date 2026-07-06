-- ══════════════════════════════════════════════════════════════
-- unified-task-model — ревью-фикс P1 (2026-07-06)
-- GET /templates считал task_count выборкой ВСЕХ junction-строк клиентски —
-- O(шаблоны×задачи) + тихий PostgREST-кап 1000 строк → неверный счётчик.
-- Фикс: SQL-агрегат одним запросом. Вызывается edge под service_role
-- (видимость шаблонов уже отфильтрована handler'ом) → authenticated не нужен.
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.hw_template_task_counts(p_template_ids UUID[])
RETURNS TABLE (template_id UUID, task_count BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT htt.template_id, COUNT(*) AS task_count
  FROM homework_template_tasks htt
  WHERE htt.template_id = ANY(p_template_ids)
  GROUP BY htt.template_id;
$$;

REVOKE ALL ON FUNCTION public.hw_template_task_counts(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hw_template_task_counts(UUID[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hw_template_task_counts(UUID[]) TO service_role;
