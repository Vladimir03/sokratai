-- KB Search: full-text search function for topics, tasks, materials
-- Uses Postgres tsvector with Russian language configuration.
-- SECURITY DEFINER with search_path pinned (matches kb_folder_owned_by pattern).
-- Uses auth.uid() internally — never trusts caller-supplied identity.

CREATE OR REPLACE FUNCTION public.kb_search(
  query TEXT,
  exam_filter exam_type,           -- required: 'ege' or 'oge'
  source_filter TEXT DEFAULT NULL,  -- 'socrat' | 'my' | NULL (all)
  result_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  result_type TEXT,
  result_id UUID,
  parent_topic_id UUID,   -- topic_id for tasks/materials; NULL for topics
  title TEXT,
  snippet TEXT,
  exam exam_type,
  source TEXT,
  relevance REAL
) AS $$
DECLARE
  _uid UUID := auth.uid();
BEGIN
  RETURN QUERY

  -- Topics: search by topic name + section + subtopic names
  SELECT
    'topic'::TEXT AS result_type,
    t.id AS result_id,
    NULL::UUID AS parent_topic_id,
    t.name AS title,
    t.section AS snippet,
    t.exam,
    'socrat'::TEXT AS source,
    ts_rank(
      to_tsvector('russian', t.name || ' ' || t.section || ' ' || COALESCE(
        (SELECT string_agg(s.name, ' ') FROM public.kb_subtopics s WHERE s.topic_id = t.id), ''
      )),
      plainto_tsquery('russian', query)
    ) AS relevance
  FROM public.kb_topics t
  WHERE
    to_tsvector('russian', t.name || ' ' || t.section || ' ' || COALESCE(
      (SELECT string_agg(s.name, ' ') FROM public.kb_subtopics s WHERE s.topic_id = t.id), ''
    )) @@ plainto_tsquery('russian', query)
    AND t.exam = exam_filter

  UNION ALL

  -- Tasks: search by task text
  SELECT
    'task'::TEXT AS result_type,
    tk.id AS result_id,
    tk.topic_id AS parent_topic_id,
    SUBSTRING(tk.text, 1, 100) AS title,
    tk.answer AS snippet,
    tk.exam,
    CASE WHEN tk.owner_id IS NULL THEN 'socrat' ELSE 'my' END AS source,
    ts_rank(
      to_tsvector('russian', tk.text),
      plainto_tsquery('russian', query)
    ) AS relevance
  FROM public.kb_tasks tk
  WHERE
    to_tsvector('russian', tk.text) @@ plainto_tsquery('russian', query)
    AND tk.exam = exam_filter
    AND (source_filter IS NULL
         OR (source_filter = 'socrat' AND tk.owner_id IS NULL)
         OR (source_filter = 'my' AND tk.owner_id = _uid))
    AND (tk.owner_id IS NULL OR tk.owner_id = _uid)

  UNION ALL

  -- Materials: search by material name, filtered by exam via topic JOIN
  SELECT
    'material'::TEXT AS result_type,
    m.id AS result_id,
    m.topic_id AS parent_topic_id,
    m.name AS title,
    m.format AS snippet,
    tp.exam,
    CASE WHEN m.owner_id IS NULL THEN 'socrat' ELSE 'my' END AS source,
    ts_rank(
      to_tsvector('russian', m.name),
      plainto_tsquery('russian', query)
    ) AS relevance
  FROM public.kb_materials m
  LEFT JOIN public.kb_topics tp ON tp.id = m.topic_id
  WHERE
    to_tsvector('russian', m.name) @@ plainto_tsquery('russian', query)
    AND (m.owner_id IS NULL OR m.owner_id = _uid)
    AND (tp.exam = exam_filter OR tp.id IS NULL)
    AND (source_filter IS NULL
         OR (source_filter = 'socrat' AND m.owner_id IS NULL)
         OR (source_filter = 'my' AND m.owner_id = _uid))

  ORDER BY relevance DESC
  LIMIT result_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
