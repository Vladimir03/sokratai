-- ══════════════════════════════════════════════════════════════
-- Round-1 review fixes (ChatGPT-5.5):
--   P1-1: kb_search не находит олимпиадные темы/задачи (strict t.exam=exam_filter,
--         а у олимпиад exam=NULL). Добавляем kind_filter и фильтруем по kind.
--   P1-3: legacy promote_folder_to_catalog публикует личную строку прямым
--         owner_id=NULL без strip рубрики → утечка rubric_text/rubric_image_urls
--         в каталог. REVOKE от authenticated (в UI/edge не вызывается) + scrub.
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- ── P1-1: kind-aware kb_search ───────────────────────────────────────────────
-- DROP+CREATE (новый параметр меняет сигнатуру). Старые клиенты с 4 аргументами
-- продолжают работать: kind_filter по умолчанию NULL → ветка exam (как было).
DROP FUNCTION IF EXISTS public.kb_search(text, exam_type, text, integer);

CREATE OR REPLACE FUNCTION public.kb_search(
  query TEXT,
  exam_filter exam_type,
  source_filter TEXT DEFAULT NULL,
  result_limit INTEGER DEFAULT 20,
  kind_filter TEXT DEFAULT NULL
)
RETURNS TABLE (
  result_type TEXT,
  result_id UUID,
  parent_topic_id UUID,
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
    AND (CASE WHEN kind_filter = 'olympiad' THEN t.kind = 'olympiad'
              ELSE t.exam = exam_filter END)

  UNION ALL

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
    AND (CASE WHEN kind_filter = 'olympiad'
              THEN tk.owner_id IS NULL AND EXISTS (
                     SELECT 1 FROM public.kb_topics tp2
                     WHERE tp2.id = tk.topic_id AND tp2.kind = 'olympiad')
              ELSE tk.exam = exam_filter END)
    AND (source_filter IS NULL
         OR (source_filter = 'socrat' AND tk.owner_id IS NULL)
         OR (source_filter = 'my' AND tk.owner_id = _uid))
    AND (tk.owner_id IS NULL OR tk.owner_id = _uid)

  UNION ALL

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
    AND (CASE WHEN kind_filter = 'olympiad' THEN tp.kind = 'olympiad'
              ELSE (tp.exam = exam_filter OR tp.id IS NULL) END)
    AND (source_filter IS NULL
         OR (source_filter = 'socrat' AND m.owner_id IS NULL)
         OR (source_filter = 'my' AND m.owner_id = _uid))

  ORDER BY relevance DESC
  LIMIT result_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.kb_search(text, exam_type, text, integer, text) TO authenticated;

-- ── P1-3: neutralize legacy promote_folder_to_catalog (anti-leak) ────────────
-- Не вызывается из UI/edge (только types.ts). Это destructive-move путь в обход
-- source→copy: не strip'ает рубрику и обходит fingerprint-dedup. Закрываем для
-- клиента; миграции/сиды (superuser) не затронуты.
REVOKE EXECUTE ON FUNCTION public.promote_folder_to_catalog(uuid, uuid, uuid, text)
  FROM authenticated, PUBLIC;

-- Подчистить рубрику, если она когда-либо утекла в каталог через legacy promote.
-- Каноничный source→copy (kb_publish_task/kb_resync_task) рубрику не копирует —
-- у корректных каталожных копий этих полей и так нет (no-op в норме).
UPDATE public.kb_tasks
SET rubric_text = NULL, rubric_image_urls = NULL
WHERE owner_id IS NULL
  AND (rubric_text IS NOT NULL OR rubric_image_urls IS NOT NULL);

COMMIT;
