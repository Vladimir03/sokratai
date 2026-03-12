CREATE OR REPLACE VIEW public.kb_topics_with_counts
WITH (security_invoker=on) AS
SELECT
  t.id,
  t.name,
  t.section,
  t.exam,
  t.kim_numbers,
  t.sort_order,
  t.created_at,
  COALESCE(tc.task_count, 0)::INTEGER AS task_count,
  COALESCE(mc.material_count, 0)::INTEGER AS material_count,
  ARRAY(
    SELECT s.name FROM public.kb_subtopics s
    WHERE s.topic_id = t.id ORDER BY s.sort_order
  ) AS subtopic_names
FROM public.kb_topics t
LEFT JOIN (
  SELECT topic_id, COUNT(*)::INTEGER AS task_count
  FROM public.kb_tasks
  WHERE owner_id IS NULL
  GROUP BY topic_id
) tc ON tc.topic_id = t.id
LEFT JOIN (
  SELECT topic_id, COUNT(*)::INTEGER AS material_count
  FROM public.kb_materials
  WHERE owner_id IS NULL
  GROUP BY topic_id
) mc ON mc.topic_id = t.id;