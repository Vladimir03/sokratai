BEGIN;

CREATE OR REPLACE FUNCTION public.kb_require_moderator_subject(p_subject TEXT)
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE _caller UUID;
BEGIN
  _caller := auth.uid();
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Требуется вход в систему';
  END IF;
  IF public.is_admin(_caller) THEN
    RETURN _caller;
  END IF;
  IF NOT public.has_role(_caller, 'moderator') THEN
    RAISE EXCEPTION 'Доступно только модераторам каталога';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tutors
    WHERE user_id = _caller AND p_subject = ANY(COALESCE(subjects, '{}'))
  ) THEN
    RAISE EXCEPTION 'Раздел «%» не входит в ваши предметы (укажите их в профиле)', p_subject;
  END IF;
  RETURN _caller;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.kb_require_moderator_subject(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_require_moderator_subject(TEXT) FROM anon;

CREATE OR REPLACE FUNCTION public._kb_mod_copy_to_base(
  p_copy_id UUID, p_caller UUID, p_folder UUID
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _c public.kb_tasks%ROWTYPE; _src_owner UUID; _src_pub UUID; _tpl_count INT;
BEGIN
  SELECT * INTO _c FROM public.kb_tasks
   WHERE id = p_copy_id AND owner_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN 'skip'; END IF;

  SELECT count(DISTINCT htt.template_id) INTO _tpl_count
    FROM public.homework_template_tasks htt WHERE htt.kb_task_id = p_copy_id;
  IF _tpl_count > 0 THEN
    RAISE EXCEPTION 'Задача используется в шаблонах ДЗ (%) — сначала уберите её из шаблонов.', _tpl_count;
  END IF;

  IF _c.source_task_id IS NOT NULL THEN
    SELECT owner_id, published_task_id INTO _src_owner, _src_pub
      FROM public.kb_tasks WHERE id = _c.source_task_id FOR UPDATE;
  END IF;

  IF _c.source_task_id IS NOT NULL AND _src_owner = p_caller THEN
    IF _src_pub IS DISTINCT FROM _c.id THEN
      RAISE EXCEPTION 'Нарушена связь публикации задачи — обратитесь к владельцу';
    END IF;
    UPDATE public.kb_tasks SET
      published_task_id = NULL, folder_id = p_folder,
      topic_id = NULL, subtopic_id = NULL,
      moderation_status = 'active', source_label = 'my', updated_at = NOW()
    WHERE id = _c.source_task_id;
    DELETE FROM public.kb_tasks WHERE id = _c.id;
    RETURN 'relocated';

  ELSIF _c.source_task_id IS NULL THEN
    INSERT INTO public.kb_tasks (
      owner_id, folder_id, topic_id, subtopic_id,
      exam, kim_number, primary_score, difficulty,
      text, answer, solution, answer_format,
      check_format, task_kind, cefr_level, grading_criteria_json,
      rubric_text, rubric_image_urls,
      source_label, attachment_url, solution_attachment_url,
      moderation_status
    ) VALUES (
      p_caller, p_folder, NULL, NULL,
      _c.exam, _c.kim_number, _c.primary_score, _c.difficulty,
      _c.text, _c.answer, _c.solution, _c.answer_format,
      _c.check_format, _c.task_kind, _c.cefr_level, _c.grading_criteria_json,
      _c.rubric_text, _c.rubric_image_urls,
      'my', _c.attachment_url, _c.solution_attachment_url,
      'active'
    );
    DELETE FROM public.kb_tasks WHERE id = _c.id;
    RETURN 'orphan_copied';

  ELSE
    RAISE EXCEPTION 'Эта задача опубликована из папки другого модератора — перенести её в вашу базу нельзя';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._kb_mod_copy_to_base(UUID, UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._kb_mod_copy_to_base(UUID, UUID, UUID) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public._kb_mod_check_target_folder(p_folder UUID, p_caller UUID)
RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.kb_folder_owned_by(p_folder, p_caller) THEN
    RAISE EXCEPTION 'Папка не найдена или принадлежит другому пользователю';
  END IF;
  IF public.kb_is_in_socrat_tree(p_folder) THEN
    RAISE EXCEPTION 'Нельзя переносить в папку «сократ» — выберите личную папку';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._kb_mod_check_target_folder(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._kb_mod_check_target_folder(UUID, UUID) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.kb_mod_move_task_to_my_base(p_task_id UUID, p_folder_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _caller UUID; _subject TEXT; _topic UUID; _r TEXT;
BEGIN
  SELECT topic_id INTO _topic FROM public.kb_tasks WHERE id = p_task_id AND owner_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Задача не найдена в каталоге'; END IF;
  SELECT subject INTO _subject FROM public.kb_topics WHERE id = _topic;
  _caller := public.kb_require_moderator_subject(COALESCE(_subject, 'physics'));
  PERFORM public._kb_mod_check_target_folder(p_folder_id, _caller);

  _r := public._kb_mod_copy_to_base(p_task_id, _caller, p_folder_id);
  RETURN jsonb_build_object('task_id', p_task_id, 'result', _r);
END;
$$;

CREATE OR REPLACE FUNCTION public.kb_mod_delete_topic_to_my_base(p_topic_id UUID, p_folder_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _caller UUID; _subject TEXT; _cid UUID; _moved INT := 0; _own_moved INT := 0; _left INT;
BEGIN
  SELECT subject INTO _subject FROM public.kb_topics WHERE id = p_topic_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Тема не найдена'; END IF;
  _caller := public.kb_require_moderator_subject(COALESCE(_subject, 'physics'));

  IF EXISTS (SELECT 1 FROM public.kb_materials WHERE topic_id = p_topic_id) THEN
    RAISE EXCEPTION 'В теме есть материалы — удалите их перед удалением темы';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.kb_tasks
     WHERE topic_id = p_topic_id AND (owner_id IS NULL OR owner_id = _caller)
  ) THEN
    IF p_folder_id IS NULL THEN
      RAISE EXCEPTION 'Выберите папку для переноса задач темы';
    END IF;
    PERFORM public._kb_mod_check_target_folder(p_folder_id, _caller);

    FOR _cid IN
      SELECT id FROM public.kb_tasks WHERE topic_id = p_topic_id AND owner_id IS NULL ORDER BY id
    LOOP
      PERFORM public._kb_mod_copy_to_base(_cid, _caller, p_folder_id);
      _moved := _moved + 1;
    END LOOP;

    UPDATE public.kb_tasks SET
      published_task_id = NULL, folder_id = p_folder_id, topic_id = NULL, subtopic_id = NULL,
      moderation_status = 'active', source_label = 'my', updated_at = NOW()
    WHERE owner_id = _caller AND topic_id = p_topic_id;
    GET DIAGNOSTICS _own_moved = ROW_COUNT;
    _moved := _moved + _own_moved;
  END IF;

  UPDATE public.kb_tasks SET topic_id = NULL, subtopic_id = NULL, updated_at = NOW()
  WHERE topic_id = p_topic_id
    AND owner_id IS NOT NULL AND owner_id <> _caller
    AND folder_id IS NOT NULL AND NOT public.kb_is_in_socrat_tree(folder_id);

  SELECT count(*) INTO _left FROM public.kb_tasks
   WHERE topic_id = p_topic_id
      OR subtopic_id IN (SELECT id FROM public.kb_subtopics WHERE topic_id = p_topic_id);
  IF _left > 0 THEN
    RAISE EXCEPTION 'В теме остались задачи, которые нельзя перенести автоматически (%). Обратитесь к владельцу.', _left;
  END IF;

  DELETE FROM public.kb_topics WHERE id = p_topic_id;
  RETURN jsonb_build_object('topic_id', p_topic_id, 'moved', _moved);
END;
$$;

CREATE OR REPLACE FUNCTION public.kb_mod_delete_section_to_my_base(
  p_subject TEXT, p_section TEXT, p_filter TEXT, p_folder_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _caller UUID; _tid UUID; _n INT := 0; _moved INT := 0; _r JSONB;
BEGIN
  IF p_filter IS NULL OR p_filter NOT IN ('ege', 'oge', 'olympiad') THEN
    RAISE EXCEPTION 'Неверный фильтр раздела';
  END IF;
  _caller := public.kb_require_moderator_subject(p_subject);

  FOR _tid IN
    SELECT id FROM public.kb_topics
     WHERE subject = p_subject AND section = p_section
       AND ( (p_filter = 'olympiad' AND kind = 'olympiad')
             OR (kind = 'exam' AND exam::text = p_filter) )
     ORDER BY id
  LOOP
    _r := public.kb_mod_delete_topic_to_my_base(_tid, p_folder_id);
    _n := _n + 1;
    _moved := _moved + COALESCE((_r->>'moved')::INT, 0);
  END LOOP;

  RETURN jsonb_build_object('topics_deleted', _n, 'moved', _moved);
END;
$$;

CREATE OR REPLACE FUNCTION public.kb_mod_delete_subtopic(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _subject TEXT;
BEGIN
  SELECT t.subject INTO _subject
    FROM public.kb_subtopics s JOIN public.kb_topics t ON t.id = s.topic_id
   WHERE s.id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Подтема не найдена'; END IF;
  PERFORM public.kb_require_moderator_subject(COALESCE(_subject, 'physics'));

  IF EXISTS (SELECT 1 FROM public.kb_tasks WHERE subtopic_id = p_id) THEN
    RAISE EXCEPTION 'В подтеме есть задачи — сначала перенесите их в другую подтему';
  END IF;
  DELETE FROM public.kb_subtopics WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.kb_mod_delete_topic(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _subject TEXT;
BEGIN
  SELECT subject INTO _subject FROM public.kb_topics WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Тема не найдена'; END IF;
  PERFORM public.kb_require_moderator_subject(COALESCE(_subject, 'physics'));

  IF EXISTS (SELECT 1 FROM public.kb_tasks WHERE topic_id = p_id) THEN
    RAISE EXCEPTION 'В теме есть задачи — переместите или снимите их публикацию перед удалением темы';
  END IF;
  IF EXISTS (SELECT 1 FROM public.kb_materials WHERE topic_id = p_id) THEN
    RAISE EXCEPTION 'В теме есть материалы — удалите их перед удалением темы';
  END IF;
  DELETE FROM public.kb_topics WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.kb_mod_preview_delete_topic(p_topic_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE _subject TEXT; _caller UUID; _move INT; _has_mat BOOLEAN;
BEGIN
  SELECT subject INTO _subject FROM public.kb_topics WHERE id = p_topic_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Тема не найдена'; END IF;
  _caller := public.kb_require_moderator_subject(COALESCE(_subject, 'physics'));
  SELECT count(*) INTO _move FROM public.kb_tasks
   WHERE topic_id = p_topic_id AND (owner_id IS NULL OR owner_id = _caller);
  SELECT EXISTS (SELECT 1 FROM public.kb_materials WHERE topic_id = p_topic_id) INTO _has_mat;
  RETURN jsonb_build_object('move_count', _move, 'needs_folder', _move > 0, 'has_materials', _has_mat);
END;
$$;

CREATE OR REPLACE FUNCTION public.kb_mod_preview_delete_section(p_subject TEXT, p_section TEXT, p_filter TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE _caller UUID; _tids UUID[]; _topic_count INT; _move INT;
BEGIN
  IF p_filter IS NULL OR p_filter NOT IN ('ege', 'oge', 'olympiad') THEN
    RAISE EXCEPTION 'Неверный фильтр раздела';
  END IF;
  _caller := public.kb_require_moderator_subject(p_subject);
  SELECT array_agg(id) INTO _tids FROM public.kb_topics
   WHERE subject = p_subject AND section = p_section
     AND ( (p_filter = 'olympiad' AND kind = 'olympiad') OR (kind = 'exam' AND exam::text = p_filter) );
  _topic_count := COALESCE(array_length(_tids, 1), 0);
  SELECT count(*) INTO _move FROM public.kb_tasks
   WHERE topic_id = ANY(COALESCE(_tids, ARRAY[]::uuid[]))
     AND (owner_id IS NULL OR owner_id = _caller);
  RETURN jsonb_build_object('topic_count', _topic_count, 'move_count', _move, 'needs_folder', _move > 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.kb_mod_move_task_to_my_base(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_mod_delete_topic_to_my_base(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_mod_delete_section_to_my_base(TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_mod_preview_delete_topic(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_mod_preview_delete_section(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kb_mod_move_task_to_my_base(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kb_mod_delete_topic_to_my_base(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kb_mod_delete_section_to_my_base(TEXT, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kb_mod_preview_delete_topic(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kb_mod_preview_delete_section(TEXT, TEXT, TEXT) TO authenticated;

COMMIT;