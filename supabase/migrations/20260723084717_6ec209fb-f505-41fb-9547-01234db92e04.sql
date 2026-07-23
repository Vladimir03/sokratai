-- ========== 20260723100000_mock_exam_ordered_lenient_check_mode.sql ==========
BEGIN;

DO $$
DECLARE
  _con RECORD;
BEGIN
  FOR _con IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.mock_exam_variant_tasks'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%check_mode%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.mock_exam_variant_tasks DROP CONSTRAINT %I',
      _con.conname
    );
  END LOOP;
END $$;

ALTER TABLE public.mock_exam_variant_tasks
  ADD CONSTRAINT mock_exam_variant_tasks_check_mode_check CHECK (
    check_mode IS NULL OR check_mode IN (
      'strict', 'ordered', 'ordered_lenient', 'unordered', 'multi_choice',
      'task20', 'pair', 'manual'
    )
  );

ALTER TABLE public.mock_exam_variant_tasks
  ADD CONSTRAINT mock_exam_variant_tasks_part1_needs_check_mode CHECK (
    part = 2 OR check_mode IN (
      'strict', 'ordered', 'ordered_lenient', 'unordered', 'multi_choice',
      'task20', 'pair'
    )
  );

COMMENT ON COLUMN public.mock_exam_variant_tasks.check_mode IS
  'strict — точное совпадение. ordered — последовательность через запятую (физика: длина ≠ → 0). ordered_lenient — последовательность, 1 ошибка/лишняя/недостающая позиция = 1 балл (обществознание № 6/13/15). unordered — множество без порядка. multi_choice — несколько вариантов (1 ошибка = 1 балл). task20 — набор цифр, порядок неважен, всё-или-ничего. pair — пара значение/единица. manual — оценивает tutor (Часть 2).';

COMMIT;

-- ========== 20260723110000_kb_mod_hard_delete_catalog_task.sql ==========
BEGIN;

CREATE OR REPLACE FUNCTION public.kb_mod_preview_delete_task(p_task_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _c public.kb_tasks%ROWTYPE; _subject TEXT; _caller UUID;
  _src_owner UUID; _src_pub UUID; _tpl INT; _src_tpl INT := 0; _branch TEXT;
BEGIN
  SELECT * INTO _c FROM public.kb_tasks WHERE id = p_task_id AND owner_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Задача не найдена в каталоге'; END IF;
  SELECT subject INTO _subject FROM public.kb_topics WHERE id = _c.topic_id;
  _caller := public.kb_require_moderator_subject(COALESCE(_subject, 'physics'));

  SELECT count(DISTINCT htt.template_id) INTO _tpl
    FROM public.homework_template_tasks htt WHERE htt.kb_task_id = _c.id;

  IF _c.source_task_id IS NULL THEN
    _branch := 'orphan';
  ELSE
    SELECT owner_id, published_task_id INTO _src_owner, _src_pub
      FROM public.kb_tasks WHERE id = _c.source_task_id;
    IF _src_owner IS NULL THEN
      _branch := 'orphan';
    ELSIF _src_owner <> _caller THEN
      _branch := 'foreign';
    ELSIF _src_pub IS NULL THEN
      _branch := 'own_source_detached';
    ELSIF _src_pub = _c.id THEN
      _branch := 'own_source';
      SELECT count(DISTINCT htt.template_id) INTO _src_tpl
        FROM public.homework_template_tasks htt WHERE htt.kb_task_id = _c.source_task_id;
    ELSE
      _branch := 'link_broken';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'branch', _branch,
    'template_count', _tpl,
    'source_template_count', _src_tpl
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.kb_mod_delete_catalog_task(p_task_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _c public.kb_tasks%ROWTYPE; _subject TEXT; _caller UUID;
  _src_owner UUID; _src_pub UUID; _tpl INT; _src_tpl INT; _result TEXT;
BEGIN
  SELECT * INTO _c FROM public.kb_tasks
   WHERE id = p_task_id AND owner_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Задача не найдена в каталоге'; END IF;
  SELECT subject INTO _subject FROM public.kb_topics WHERE id = _c.topic_id;
  _caller := public.kb_require_moderator_subject(COALESCE(_subject, 'physics'));

  SELECT * INTO _c FROM public.kb_tasks
   WHERE id = p_task_id AND owner_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Задача не найдена в каталоге'; END IF;

  SELECT count(DISTINCT htt.template_id) INTO _tpl
    FROM public.homework_template_tasks htt WHERE htt.kb_task_id = _c.id;
  IF _tpl > 0 THEN
    RAISE EXCEPTION 'Задача используется в шаблонах ДЗ (%) — сначала уберите её из шаблонов.', _tpl;
  END IF;

  IF _c.source_task_id IS NOT NULL THEN
    SELECT owner_id, published_task_id INTO _src_owner, _src_pub
      FROM public.kb_tasks WHERE id = _c.source_task_id FOR UPDATE;
  END IF;

  IF _c.source_task_id IS NULL OR _src_owner IS NULL THEN
    DELETE FROM public.kb_tasks WHERE id = _c.id;
    _result := 'deleted';

  ELSIF _src_owner = _caller AND _src_pub IS NULL THEN
    DELETE FROM public.kb_tasks WHERE id = _c.id;
    _result := 'deleted';

  ELSIF _src_owner = _caller AND _src_pub = _c.id THEN
    SELECT count(DISTINCT htt.template_id) INTO _src_tpl
      FROM public.homework_template_tasks htt WHERE htt.kb_task_id = _c.source_task_id;
    IF _src_tpl > 0 THEN
      RAISE EXCEPTION 'Исходник задачи используется в шаблонах ДЗ (%) — сначала уберите его из шаблонов.', _src_tpl;
    END IF;
    DELETE FROM public.kb_tasks WHERE id = _c.id;
    DELETE FROM public.kb_tasks WHERE id = _c.source_task_id;
    _result := 'deleted_with_source';

  ELSIF _src_owner = _caller THEN
    RAISE EXCEPTION 'Нарушена связь публикации задачи — обратитесь к владельцу';

  ELSE
    RAISE EXCEPTION 'Эта задача опубликована из папки другого модератора — удалить её может только он';
  END IF;

  INSERT INTO public.kb_moderation_log (action, task_id, source_task_id, moderator_id, details)
  VALUES (
    'hard_delete', _c.id, _c.source_task_id, _caller,
    jsonb_build_object(
      'result', _result,
      'topic_id', _c.topic_id,
      'subtopic_id', _c.subtopic_id,
      'kim_number', _c.kim_number,
      'fingerprint', _c.fingerprint
    )
  );

  RETURN jsonb_build_object('task_id', p_task_id, 'result', _result);
END;
$$;

GRANT EXECUTE ON FUNCTION public.kb_mod_preview_delete_task(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kb_mod_delete_catalog_task(UUID) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kb_mod_preview_delete_task(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_mod_delete_catalog_task(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_mod_preview_delete_task(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.kb_mod_delete_catalog_task(UUID) FROM anon;

COMMIT;