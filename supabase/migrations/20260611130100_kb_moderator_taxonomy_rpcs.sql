-- ══════════════════════════════════════════════════════════════
-- KB moderator taxonomy CRUD — self-serve темы/подтемы без кода
--
-- kb_topics/kb_subtopics — read-only для authenticated (только GRANT SELECT,
-- нет write-политик). Модераторские правки идут через SECURITY DEFINER RPC
-- (зеркало kb_mod_unpublish/kb_mod_reassign): проверка роли внутри,
-- REVOKE FROM PUBLIC + GRANT authenticated. Ошибки — рус. фразы (rule 97).
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- ── helper: гарантировать роль модератора ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kb_require_moderator()
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE _caller UUID;
BEGIN
  _caller := auth.uid();
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Требуется вход в систему';
  END IF;
  IF NOT has_role(_caller, 'moderator') THEN
    RAISE EXCEPTION 'Доступно только модераторам каталога';
  END IF;
  RETURN _caller;
END;
$$;

-- ── TOPIC: create ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kb_mod_create_topic(
  p_name TEXT,
  p_section TEXT,
  p_kind TEXT DEFAULT 'exam',
  p_exam exam_type DEFAULT NULL,
  p_subject TEXT DEFAULT 'physics',
  p_kim_numbers INTEGER[] DEFAULT '{}',
  p_sort_order INTEGER DEFAULT 0
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _id UUID;
BEGIN
  PERFORM public.kb_require_moderator();

  IF COALESCE(TRIM(p_name), '') = '' THEN
    RAISE EXCEPTION 'Укажите название темы';
  END IF;
  IF COALESCE(TRIM(p_section), '') = '' THEN
    RAISE EXCEPTION 'Укажите раздел темы';
  END IF;
  IF p_kind NOT IN ('exam', 'olympiad') THEN
    RAISE EXCEPTION 'Неверный тип темы';
  END IF;
  IF p_kind = 'exam' AND p_exam IS NULL THEN
    RAISE EXCEPTION 'Для темы ЕГЭ/ОГЭ выберите экзамен';
  END IF;

  INSERT INTO public.kb_topics (name, section, kind, exam, subject, kim_numbers, sort_order)
  VALUES (
    TRIM(p_name),
    TRIM(p_section),
    p_kind,
    CASE WHEN p_kind = 'olympiad' THEN NULL ELSE p_exam END,
    COALESCE(NULLIF(TRIM(p_subject), ''), 'physics'),
    COALESCE(p_kim_numbers, '{}'),
    COALESCE(p_sort_order, 0)
  )
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

-- ── TOPIC: update (kind НЕ меняется после создания) ──────────────────────────
CREATE OR REPLACE FUNCTION public.kb_mod_update_topic(
  p_id UUID,
  p_name TEXT DEFAULT NULL,
  p_section TEXT DEFAULT NULL,
  p_exam exam_type DEFAULT NULL,
  p_subject TEXT DEFAULT NULL,
  p_kim_numbers INTEGER[] DEFAULT NULL,
  p_sort_order INTEGER DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.kb_require_moderator();

  UPDATE public.kb_topics SET
    name        = COALESCE(NULLIF(TRIM(p_name), ''), name),
    section     = COALESCE(NULLIF(TRIM(p_section), ''), section),
    -- exam меняется только у exam-тем; у олимпиадных всегда NULL
    exam        = CASE WHEN kind = 'olympiad' THEN NULL ELSE COALESCE(p_exam, exam) END,
    subject     = COALESCE(NULLIF(TRIM(p_subject), ''), subject),
    kim_numbers = COALESCE(p_kim_numbers, kim_numbers),
    sort_order  = COALESCE(p_sort_order, sort_order)
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Тема не найдена';
  END IF;
END;
$$;

-- ── TOPIC: delete (только пустую — без задач) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.kb_mod_delete_topic(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.kb_require_moderator();

  -- Любая задача (опубликованная ИЛИ source-задача с проставленной темой)
  -- блокирует удаление: FK kb_tasks.topic_id = RESTRICT, плюс это защита
  -- от случайного сноса наполненной темы.
  IF EXISTS (SELECT 1 FROM public.kb_tasks WHERE topic_id = p_id) THEN
    RAISE EXCEPTION 'В теме есть задачи — переместите или снимите их публикацию перед удалением темы';
  END IF;

  -- kb_materials.topic_id — тоже FK без cascade (review P2-3): без этого гейта
  -- была бы низкоуровневая FK-ошибка вместо человекочитаемой фразы.
  IF EXISTS (SELECT 1 FROM public.kb_materials WHERE topic_id = p_id) THEN
    RAISE EXCEPTION 'В теме есть материалы — удалите их перед удалением темы';
  END IF;

  DELETE FROM public.kb_topics WHERE id = p_id; -- подтемы каскадом (FK ON DELETE CASCADE)
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Тема не найдена';
  END IF;
END;
$$;

-- ── SUBTOPIC: create ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kb_mod_create_subtopic(
  p_topic_id UUID,
  p_name TEXT,
  p_sort_order INTEGER DEFAULT 0
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _id UUID;
BEGIN
  PERFORM public.kb_require_moderator();

  IF COALESCE(TRIM(p_name), '') = '' THEN
    RAISE EXCEPTION 'Укажите название подтемы';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.kb_topics WHERE id = p_topic_id) THEN
    RAISE EXCEPTION 'Тема не найдена';
  END IF;

  INSERT INTO public.kb_subtopics (topic_id, name, sort_order)
  VALUES (p_topic_id, TRIM(p_name), COALESCE(p_sort_order, 0))
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

-- ── SUBTOPIC: update ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kb_mod_update_subtopic(
  p_id UUID,
  p_name TEXT DEFAULT NULL,
  p_sort_order INTEGER DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.kb_require_moderator();

  UPDATE public.kb_subtopics SET
    name       = COALESCE(NULLIF(TRIM(p_name), ''), name),
    sort_order = COALESCE(p_sort_order, sort_order)
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Подтема не найдена';
  END IF;
END;
$$;

-- ── SUBTOPIC: delete (только без задач) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kb_mod_delete_subtopic(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.kb_require_moderator();

  IF EXISTS (SELECT 1 FROM public.kb_tasks WHERE subtopic_id = p_id) THEN
    RAISE EXCEPTION 'В подтеме есть задачи — сначала перенесите их в другую подтему';
  END IF;

  DELETE FROM public.kb_subtopics WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Подтема не найдена';
  END IF;
END;
$$;

-- ── GRANTS (REVOKE FROM PUBLIC + GRANT authenticated; роль проверяется внутри) ─
REVOKE EXECUTE ON FUNCTION public.kb_require_moderator() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_mod_create_topic(TEXT, TEXT, TEXT, exam_type, TEXT, INTEGER[], INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_mod_update_topic(UUID, TEXT, TEXT, exam_type, TEXT, INTEGER[], INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_mod_delete_topic(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_mod_create_subtopic(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_mod_update_subtopic(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_mod_delete_subtopic(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.kb_mod_create_topic(TEXT, TEXT, TEXT, exam_type, TEXT, INTEGER[], INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kb_mod_update_topic(UUID, TEXT, TEXT, exam_type, TEXT, INTEGER[], INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kb_mod_delete_topic(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kb_mod_create_subtopic(UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kb_mod_update_subtopic(UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kb_mod_delete_subtopic(UUID) TO authenticated;

COMMIT;
