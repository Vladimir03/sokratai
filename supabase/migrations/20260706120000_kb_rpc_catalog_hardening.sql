-- ══════════════════════════════════════════════════════════════
-- unified-task-model — ревью-фикс P0 (2026-07-06, независимое ревью ChatGPT-5.5)
-- Каталожные SECURITY DEFINER RPC обходили M2b-hardening (20260705120200).
--
-- M2b сузил RLS SELECT каталога до tutors/moderators, но SECURITY DEFINER
-- обходит RLS: `fetch_catalog_tasks_v2` / `fetch_catalog_tasks_all`
-- (RETURNS SETOF kb_tasks = ВСЕ колонки, после M2 включая rubric_text /
-- grading_criteria_json / solution) и `kb_search` (snippet = answer)
-- выданы authenticated БЕЗ role-гарда → ученик с JWT мог читать каталог
-- напрямую через supabase.rpc(...).
--
-- Фикс: tutor/moderator гард ВНУТРИ всех трёх функций (та же пара хелперов,
-- что в M2b: public.is_tutor — SECURITY DEFINER, 20260117211049 — и has_role).
-- RETURNS SETOF kb_tasks СОХРАНЁН (НЕ сужаем до whitelist — осознанно:
-- rubric/criteria/solution в каталоге — ценность Банка ДЗ для РЕПЕТИТОРОВ,
-- kbTaskToDraftTask/пикер их импортируют; модель угрозы — ученики, гард
-- закрывает её целиком, а сужение сломало бы unified-model импорт и
-- RPC-return-шейпы в types.ts, rule 50).
--
-- Тела скопированы verbatim из последних канонических версий:
--   fetch_catalog_tasks_v2  → 20260318150000 (SQL → plpgsql ради гарда)
--   fetch_catalog_tasks_all → 20260330100000 (SQL → plpgsql ради гарда)
--   kb_search               → 20260611181252 (гард добавлен в начало)
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- ── helper: гард «только репетиторы/модераторы» (единая рус. ошибка, rule 97) ──
CREATE OR REPLACE FUNCTION public.kb_require_tutor_or_moderator()
RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Требуется вход в систему';
  END IF;
  IF NOT (public.is_tutor(auth.uid()) OR public.has_role(auth.uid(), 'moderator')) THEN
    RAISE EXCEPTION 'Каталог задач доступен только репетиторам';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.kb_require_tutor_or_moderator() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kb_require_tutor_or_moderator() TO authenticated, service_role;

-- ── 1) fetch_catalog_tasks_v2 — verbatim 20260318150000 + гард ────────────────
CREATE OR REPLACE FUNCTION public.fetch_catalog_tasks_v2(p_topic_id UUID)
RETURNS SETOF public.kb_tasks
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.kb_require_tutor_or_moderator();
  RETURN QUERY
  SELECT t.*
  FROM kb_tasks t
  WHERE t.topic_id = p_topic_id
    AND t.owner_id IS NULL
    AND t.moderation_status = 'active'
  ORDER BY t.created_at;
END;
$$;

COMMENT ON FUNCTION public.fetch_catalog_tasks_v2 IS
  'Returns catalog tasks (owner_id=NULL, moderation_status=active) for a topic. '
  'V2: canonical public copies only. Tutor/moderator-gated (2026-07-06, ревью-фикс P0 — '
  'после M2 каталог несёт rubric/criteria; ученикам недоступен).';

-- ── 2) fetch_catalog_tasks_all — verbatim 20260330100000 + гард ───────────────
CREATE OR REPLACE FUNCTION public.fetch_catalog_tasks_all(p_topic_id UUID)
RETURNS SETOF public.kb_tasks
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.kb_require_tutor_or_moderator();
  RETURN QUERY
  SELECT t.*
  FROM kb_tasks t
  WHERE t.topic_id = p_topic_id
    AND t.owner_id IS NULL
    AND (
      t.moderation_status = 'active'
      OR has_role(auth.uid(), 'moderator')
    )
  ORDER BY t.moderation_status, t.created_at;
END;
$$;

COMMENT ON FUNCTION public.fetch_catalog_tasks_all IS
  'Returns catalog tasks for a topic. Moderators see all statuses; tutors see only active. '
  'Tutor/moderator-gated (2026-07-06, ревью-фикс P0).';

-- ── 3) kb_search — verbatim 20260611181252 + гард ─────────────────────────────
-- (snippet = tk.answer → ответы каталожных задач; KB — tutor-домен.)
CREATE OR REPLACE FUNCTION public.kb_search(
  query TEXT, exam_filter exam_type, source_filter TEXT DEFAULT NULL,
  result_limit INTEGER DEFAULT 20, kind_filter TEXT DEFAULT NULL
) RETURNS TABLE (
  result_type TEXT, result_id UUID, parent_topic_id UUID, title TEXT, snippet TEXT,
  exam exam_type, source TEXT, relevance REAL
) AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  PERFORM public.kb_require_tutor_or_moderator();
  RETURN QUERY
  SELECT 'topic'::TEXT, t.id, NULL::UUID, t.name, t.section, t.exam, 'socrat'::TEXT,
    ts_rank(to_tsvector('russian', t.name||' '||t.section||' '||COALESCE(
      (SELECT string_agg(s.name,' ') FROM public.kb_subtopics s WHERE s.topic_id=t.id),'')),
      plainto_tsquery('russian', query))
  FROM public.kb_topics t
  WHERE to_tsvector('russian', t.name||' '||t.section||' '||COALESCE(
      (SELECT string_agg(s.name,' ') FROM public.kb_subtopics s WHERE s.topic_id=t.id),''))
      @@ plainto_tsquery('russian', query)
    AND (CASE WHEN kind_filter='olympiad' THEN t.kind='olympiad' ELSE t.exam=exam_filter END)
  UNION ALL
  SELECT 'task'::TEXT, tk.id, tk.topic_id, SUBSTRING(tk.text,1,100), tk.answer, tk.exam,
    CASE WHEN tk.owner_id IS NULL THEN 'socrat' ELSE 'my' END,
    ts_rank(to_tsvector('russian', tk.text), plainto_tsquery('russian', query))
  FROM public.kb_tasks tk
  WHERE to_tsvector('russian', tk.text) @@ plainto_tsquery('russian', query)
    AND (CASE WHEN kind_filter='olympiad'
              THEN tk.owner_id IS NULL AND EXISTS (
                SELECT 1 FROM public.kb_topics tp2 WHERE tp2.id=tk.topic_id AND tp2.kind='olympiad')
              ELSE tk.exam=exam_filter END)
    AND (source_filter IS NULL OR (source_filter='socrat' AND tk.owner_id IS NULL)
         OR (source_filter='my' AND tk.owner_id=_uid))
    AND (tk.owner_id IS NULL OR tk.owner_id=_uid)
  UNION ALL
  SELECT 'material'::TEXT, m.id, m.topic_id, m.name, m.format, tp.exam,
    CASE WHEN m.owner_id IS NULL THEN 'socrat' ELSE 'my' END,
    ts_rank(to_tsvector('russian', m.name), plainto_tsquery('russian', query))
  FROM public.kb_materials m
  LEFT JOIN public.kb_topics tp ON tp.id=m.topic_id
  WHERE to_tsvector('russian', m.name) @@ plainto_tsquery('russian', query)
    AND (m.owner_id IS NULL OR m.owner_id=_uid)
    AND (CASE WHEN kind_filter='olympiad' THEN tp.kind='olympiad' ELSE (tp.exam=exam_filter OR tp.id IS NULL) END)
    AND (source_filter IS NULL OR (source_filter='socrat' AND m.owner_id IS NULL)
         OR (source_filter='my' AND m.owner_id=_uid))
  ORDER BY relevance DESC LIMIT result_limit;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMIT;
