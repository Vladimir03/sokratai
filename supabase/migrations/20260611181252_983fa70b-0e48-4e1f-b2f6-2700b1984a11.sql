-- 20260611130000_kb_catalog_self_serve_schema.sql
ALTER TABLE public.kb_topics ADD COLUMN IF NOT EXISTS subject TEXT NOT NULL DEFAULT 'physics';
ALTER TABLE public.kb_topics ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'exam';
DO $$ BEGIN
  ALTER TABLE public.kb_topics ADD CONSTRAINT kb_topics_kind_check CHECK (kind IN ('exam','olympiad'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE public.kb_topics ALTER COLUMN exam DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kb_topics_kind ON public.kb_topics(kind);
COMMENT ON COLUMN public.kb_topics.subject IS 'Предмет темы (physics по умолчанию).';
COMMENT ON COLUMN public.kb_topics.kind IS 'exam = тема ЕГЭ/ОГЭ; olympiad = олимпиадная тема.';

ALTER TABLE public.kb_folders ADD COLUMN IF NOT EXISTS catalog_topic_id UUID REFERENCES public.kb_topics(id) ON DELETE SET NULL;
ALTER TABLE public.kb_folders ADD COLUMN IF NOT EXISTS catalog_subtopic_id UUID REFERENCES public.kb_subtopics(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.kb_folders.catalog_topic_id IS 'Тема каталога, в которую публикуется эта папка.';

CREATE OR REPLACE VIEW public.kb_topics_with_counts AS
SELECT t.id, t.name, t.section, t.exam, t.kim_numbers, t.sort_order, t.created_at,
  COALESCE(tc.task_count, 0)::INTEGER AS task_count,
  COALESCE(mc.material_count, 0)::INTEGER AS material_count,
  ARRAY(SELECT s.name FROM public.kb_subtopics s WHERE s.topic_id = t.id ORDER BY s.sort_order) AS subtopic_names,
  t.subject, t.kind
FROM public.kb_topics t
LEFT JOIN (SELECT topic_id, COUNT(*)::INTEGER AS task_count FROM public.kb_tasks WHERE owner_id IS NULL AND moderation_status='active' GROUP BY topic_id) tc ON tc.topic_id=t.id
LEFT JOIN (SELECT topic_id, COUNT(*)::INTEGER AS material_count FROM public.kb_materials WHERE owner_id IS NULL GROUP BY topic_id) mc ON mc.topic_id=t.id;

-- 20260611130100_kb_moderator_taxonomy_rpcs.sql
CREATE OR REPLACE FUNCTION public.kb_require_moderator()
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _caller UUID;
BEGIN
  _caller := auth.uid();
  IF _caller IS NULL THEN RAISE EXCEPTION 'Требуется вход в систему'; END IF;
  IF NOT has_role(_caller, 'moderator') THEN RAISE EXCEPTION 'Доступно только модераторам каталога'; END IF;
  RETURN _caller;
END; $$;

CREATE OR REPLACE FUNCTION public.kb_mod_create_topic(
  p_name TEXT, p_section TEXT, p_kind TEXT DEFAULT 'exam', p_exam exam_type DEFAULT NULL,
  p_subject TEXT DEFAULT 'physics', p_kim_numbers INTEGER[] DEFAULT '{}', p_sort_order INTEGER DEFAULT 0
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id UUID;
BEGIN
  PERFORM public.kb_require_moderator();
  IF COALESCE(TRIM(p_name),'')='' THEN RAISE EXCEPTION 'Укажите название темы'; END IF;
  IF COALESCE(TRIM(p_section),'')='' THEN RAISE EXCEPTION 'Укажите раздел темы'; END IF;
  IF p_kind NOT IN ('exam','olympiad') THEN RAISE EXCEPTION 'Неверный тип темы'; END IF;
  IF p_kind='exam' AND p_exam IS NULL THEN RAISE EXCEPTION 'Для темы ЕГЭ/ОГЭ выберите экзамен'; END IF;
  INSERT INTO public.kb_topics (name, section, kind, exam, subject, kim_numbers, sort_order)
  VALUES (TRIM(p_name), TRIM(p_section), p_kind,
    CASE WHEN p_kind='olympiad' THEN NULL ELSE p_exam END,
    COALESCE(NULLIF(TRIM(p_subject),''),'physics'),
    COALESCE(p_kim_numbers,'{}'), COALESCE(p_sort_order,0))
  RETURNING id INTO _id;
  RETURN _id;
END; $$;

CREATE OR REPLACE FUNCTION public.kb_mod_update_topic(
  p_id UUID, p_name TEXT DEFAULT NULL, p_section TEXT DEFAULT NULL, p_exam exam_type DEFAULT NULL,
  p_subject TEXT DEFAULT NULL, p_kim_numbers INTEGER[] DEFAULT NULL, p_sort_order INTEGER DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.kb_require_moderator();
  UPDATE public.kb_topics SET
    name = COALESCE(NULLIF(TRIM(p_name),''), name),
    section = COALESCE(NULLIF(TRIM(p_section),''), section),
    exam = CASE WHEN kind='olympiad' THEN NULL ELSE COALESCE(p_exam, exam) END,
    subject = COALESCE(NULLIF(TRIM(p_subject),''), subject),
    kim_numbers = COALESCE(p_kim_numbers, kim_numbers),
    sort_order = COALESCE(p_sort_order, sort_order)
  WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Тема не найдена'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.kb_mod_delete_topic(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.kb_require_moderator();
  IF EXISTS (SELECT 1 FROM public.kb_tasks WHERE topic_id=p_id) THEN
    RAISE EXCEPTION 'В теме есть задачи — переместите или снимите их публикацию перед удалением темы';
  END IF;
  IF EXISTS (SELECT 1 FROM public.kb_materials WHERE topic_id=p_id) THEN
    RAISE EXCEPTION 'В теме есть материалы — удалите их перед удалением темы';
  END IF;
  DELETE FROM public.kb_topics WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Тема не найдена'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.kb_mod_create_subtopic(p_topic_id UUID, p_name TEXT, p_sort_order INTEGER DEFAULT 0)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id UUID;
BEGIN
  PERFORM public.kb_require_moderator();
  IF COALESCE(TRIM(p_name),'')='' THEN RAISE EXCEPTION 'Укажите название подтемы'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.kb_topics WHERE id=p_topic_id) THEN RAISE EXCEPTION 'Тема не найдена'; END IF;
  INSERT INTO public.kb_subtopics (topic_id, name, sort_order)
  VALUES (p_topic_id, TRIM(p_name), COALESCE(p_sort_order,0)) RETURNING id INTO _id;
  RETURN _id;
END; $$;

CREATE OR REPLACE FUNCTION public.kb_mod_update_subtopic(p_id UUID, p_name TEXT DEFAULT NULL, p_sort_order INTEGER DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.kb_require_moderator();
  UPDATE public.kb_subtopics SET
    name = COALESCE(NULLIF(TRIM(p_name),''), name),
    sort_order = COALESCE(p_sort_order, sort_order)
  WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Подтема не найдена'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.kb_mod_delete_subtopic(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.kb_require_moderator();
  IF EXISTS (SELECT 1 FROM public.kb_tasks WHERE subtopic_id=p_id) THEN
    RAISE EXCEPTION 'В подтеме есть задачи — сначала перенесите их в другую подтему';
  END IF;
  DELETE FROM public.kb_subtopics WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Подтема не найдена'; END IF;
END; $$;

REVOKE EXECUTE ON FUNCTION public.kb_require_moderator() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_mod_create_topic(TEXT,TEXT,TEXT,exam_type,TEXT,INTEGER[],INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_mod_update_topic(UUID,TEXT,TEXT,exam_type,TEXT,INTEGER[],INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_mod_delete_topic(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_mod_create_subtopic(UUID,TEXT,INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_mod_update_subtopic(UUID,TEXT,INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_mod_delete_subtopic(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kb_mod_create_topic(TEXT,TEXT,TEXT,exam_type,TEXT,INTEGER[],INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kb_mod_update_topic(UUID,TEXT,TEXT,exam_type,TEXT,INTEGER[],INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kb_mod_delete_topic(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kb_mod_create_subtopic(UUID,TEXT,INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kb_mod_update_subtopic(UUID,TEXT,INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kb_mod_delete_subtopic(UUID) TO authenticated;

-- 20260611130200_kb_publish_folder_rpc.sql
CREATE OR REPLACE FUNCTION public.kb_publish_folder_to_catalog(
  p_folder_id UUID, p_topic_id UUID, p_subtopic_id UUID DEFAULT NULL
) RETURNS TABLE(published_count INT, skipped_count INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _caller UUID; _folder_owner UUID; _topic_kind TEXT; _topic_exam exam_type;
  _task RECORD; _pub UUID; _published INT := 0; _skipped INT := 0;
BEGIN
  _caller := public.kb_require_moderator();
  SELECT owner_id INTO _folder_owner FROM public.kb_folders WHERE id=p_folder_id;
  IF _folder_owner IS NULL THEN RAISE EXCEPTION 'Папка не найдена'; END IF;
  IF _folder_owner <> _caller THEN RAISE EXCEPTION 'Публиковать можно только свою папку'; END IF;
  SELECT kind, exam INTO _topic_kind, _topic_exam FROM public.kb_topics WHERE id=p_topic_id;
  IF _topic_kind IS NULL THEN RAISE EXCEPTION 'Тема не найдена'; END IF;
  IF p_subtopic_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.kb_subtopics WHERE id=p_subtopic_id AND topic_id=p_topic_id
  ) THEN RAISE EXCEPTION 'Подтема не относится к выбранной теме'; END IF;

  FOR _task IN
    SELECT id, published_task_id FROM public.kb_tasks
    WHERE folder_id=p_folder_id AND owner_id=_caller ORDER BY created_at
  LOOP
    IF _task.published_task_id IS NOT NULL THEN _skipped := _skipped+1; CONTINUE; END IF;
    UPDATE public.kb_tasks
    SET topic_id=p_topic_id, subtopic_id=p_subtopic_id,
        exam=_topic_exam,
        kim_number=CASE WHEN _topic_kind='olympiad' THEN NULL ELSE kim_number END,
        updated_at=NOW()
    WHERE id=_task.id;
    SELECT published_task_id INTO _pub FROM public.kb_tasks WHERE id=_task.id;
    IF _pub IS NULL THEN PERFORM public.kb_publish_task(_task.id); END IF;
    _published := _published+1;
  END LOOP;

  UPDATE public.kb_folders SET catalog_topic_id=p_topic_id, catalog_subtopic_id=p_subtopic_id WHERE id=p_folder_id;
  published_count := _published; skipped_count := _skipped; RETURN NEXT;
END; $$;

REVOKE EXECUTE ON FUNCTION public.kb_publish_folder_to_catalog(UUID,UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kb_publish_folder_to_catalog(UUID,UUID,UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_fn_kb_after_update_moderation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.published_task_id IS NULL
    AND NEW.topic_id IS NOT NULL
    AND kb_is_in_socrat_tree(NEW.folder_id)
    AND has_role(NEW.owner_id, 'moderator')
    AND (OLD.folder_id IS DISTINCT FROM NEW.folder_id OR (OLD.topic_id IS NULL AND NEW.topic_id IS NOT NULL))
  THEN PERFORM kb_publish_task(NEW.id); RETURN NEW; END IF;
  IF NEW.published_task_id IS NOT NULL
    AND (NEW.text IS DISTINCT FROM OLD.text
      OR NEW.answer IS DISTINCT FROM OLD.answer
      OR NEW.solution IS DISTINCT FROM OLD.solution
      OR NEW.answer_format IS DISTINCT FROM OLD.answer_format
      OR NEW.exam IS DISTINCT FROM OLD.exam
      OR NEW.kim_number IS DISTINCT FROM OLD.kim_number
      OR NEW.primary_score IS DISTINCT FROM OLD.primary_score
      OR NEW.topic_id IS DISTINCT FROM OLD.topic_id
      OR NEW.subtopic_id IS DISTINCT FROM OLD.subtopic_id
      OR NEW.source_label IS DISTINCT FROM OLD.source_label
      OR NEW.attachment_url IS DISTINCT FROM OLD.attachment_url
      OR NEW.solution_attachment_url IS DISTINCT FROM OLD.solution_attachment_url)
  THEN PERFORM kb_resync_task(NEW.id); RETURN NEW; END IF;
  RETURN NEW;
END; $$;

-- 20260611130300_kb_search_kind_aware_and_promote_antileak.sql
DROP FUNCTION IF EXISTS public.kb_search(text, exam_type, text, integer);

CREATE OR REPLACE FUNCTION public.kb_search(
  query TEXT, exam_filter exam_type, source_filter TEXT DEFAULT NULL,
  result_limit INTEGER DEFAULT 20, kind_filter TEXT DEFAULT NULL
) RETURNS TABLE (
  result_type TEXT, result_id UUID, parent_topic_id UUID, title TEXT, snippet TEXT,
  exam exam_type, source TEXT, relevance REAL
) AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
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

GRANT EXECUTE ON FUNCTION public.kb_search(text, exam_type, text, integer, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.promote_folder_to_catalog(uuid, uuid, uuid, text) FROM authenticated, PUBLIC;

UPDATE public.kb_tasks SET rubric_text=NULL, rubric_image_urls=NULL
WHERE owner_id IS NULL AND (rubric_text IS NOT NULL OR rubric_image_urls IS NOT NULL);