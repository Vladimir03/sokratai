-- Add missing check_format column (upstream assumed present via 20260401140000)
ALTER TABLE public.kb_tasks
  ADD COLUMN IF NOT EXISTS check_format TEXT DEFAULT NULL;
DO $$ BEGIN
  ALTER TABLE public.kb_tasks
    ADD CONSTRAINT kb_tasks_check_format_check
    CHECK (check_format IS NULL OR check_format IN ('short_answer', 'detailed_solution'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- M1
ALTER TABLE public.kb_tasks
  ADD COLUMN IF NOT EXISTS task_kind TEXT,
  ADD COLUMN IF NOT EXISTS cefr_level TEXT,
  ADD COLUMN IF NOT EXISTS grading_criteria_json JSONB;

DO $$ BEGIN
  ALTER TABLE public.kb_tasks
    ADD CONSTRAINT kb_tasks_task_kind_check
    CHECK (task_kind IS NULL OR task_kind IN ('numeric', 'extended', 'proof', 'speaking'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.kb_tasks
    ADD CONSTRAINT kb_tasks_cefr_level_check
    CHECK (cefr_level IS NULL OR cefr_level IN ('A2', 'B1', 'B2', 'C1'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- M2
DROP FUNCTION IF EXISTS public.kb_resync_task(UUID);
DROP FUNCTION IF EXISTS public.kb_publish_task(UUID);

CREATE OR REPLACE FUNCTION public.kb_publish_task(p_source_task_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _src RECORD; _fp TEXT; _fp_hash BIGINT; _existing_id UUID; _new_id UUID;
  _status TEXT := 'active'; _reason TEXT := NULL;
BEGIN
  SELECT * INTO _src FROM kb_tasks WHERE id = p_source_task_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source task % not found', p_source_task_id; END IF;
  IF _src.topic_id IS NULL THEN RAISE EXCEPTION 'Cannot publish task without topic_id'; END IF;
  IF _src.published_task_id IS NOT NULL THEN
    RAISE EXCEPTION 'Task % is already published as %', p_source_task_id, _src.published_task_id;
  END IF;
  _fp := kb_normalize_fingerprint(_src.text, _src.answer, _src.attachment_url);
  _fp_hash := ('x' || left(md5(_fp), 16))::BIT(64)::BIGINT;
  PERFORM pg_advisory_xact_lock(_fp_hash);
  SELECT id INTO _existing_id FROM kb_tasks
  WHERE fingerprint = _fp AND owner_id IS NULL AND moderation_status = 'active' LIMIT 1;
  IF _existing_id IS NOT NULL THEN
    _status := 'hidden_duplicate';
    _reason := 'duplicate of ' || _existing_id::TEXT;
  END IF;
  INSERT INTO kb_tasks (
    topic_id, subtopic_id, owner_id, folder_id,
    exam, kim_number, primary_score, difficulty,
    text, answer, solution, answer_format,
    check_format, task_kind, cefr_level, grading_criteria_json,
    rubric_text, rubric_image_urls,
    source_label, attachment_url, solution_attachment_url,
    source_task_id, fingerprint, moderation_status, hidden_reason,
    published_by, published_at, created_at, updated_at
  ) VALUES (
    _src.topic_id, _src.subtopic_id, NULL, NULL,
    _src.exam, _src.kim_number, _src.primary_score, _src.difficulty,
    _src.text, _src.answer, _src.solution, _src.answer_format,
    _src.check_format, _src.task_kind, _src.cefr_level, _src.grading_criteria_json,
    _src.rubric_text, _src.rubric_image_urls,
    _src.source_label, _src.attachment_url, _src.solution_attachment_url,
    p_source_task_id, _fp, _status, _reason,
    _src.owner_id, NOW(), NOW(), NOW()
  ) RETURNING id INTO _new_id;
  UPDATE kb_tasks SET published_task_id = _new_id, updated_at = NOW() WHERE id = p_source_task_id;
  INSERT INTO kb_moderation_log (action, task_id, source_task_id, moderator_id, details)
  VALUES ('publish', _new_id, p_source_task_id, _src.owner_id,
    jsonb_build_object('fingerprint', _fp, 'status', _status, 'hidden_reason', _reason));
  RETURN _new_id;
END; $$;

CREATE OR REPLACE FUNCTION public.kb_resync_task(p_source_task_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _src RECORD; _pub_id UUID; _new_fp TEXT; _old_fp TEXT; _fp_hash BIGINT; _existing_id UUID;
BEGIN
  SELECT * INTO _src FROM kb_tasks WHERE id = p_source_task_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source task % not found', p_source_task_id; END IF;
  _pub_id := _src.published_task_id;
  IF _pub_id IS NULL THEN RETURN; END IF;
  _new_fp := kb_normalize_fingerprint(_src.text, _src.answer, _src.attachment_url);
  SELECT fingerprint INTO _old_fp FROM kb_tasks WHERE id = _pub_id;
  IF _new_fp IS DISTINCT FROM _old_fp THEN
    _fp_hash := ('x' || left(md5(_new_fp), 16))::BIT(64)::BIGINT;
    PERFORM pg_advisory_xact_lock(_fp_hash);
    SELECT id INTO _existing_id FROM kb_tasks
    WHERE fingerprint = _new_fp AND owner_id IS NULL AND moderation_status = 'active' AND id != _pub_id LIMIT 1;
    IF _existing_id IS NOT NULL THEN
      RAISE EXCEPTION 'Edit blocked: fingerprint collision with task %', _existing_id;
    END IF;
  END IF;
  UPDATE kb_tasks SET
    topic_id = _src.topic_id, subtopic_id = _src.subtopic_id,
    exam = _src.exam, kim_number = _src.kim_number, primary_score = _src.primary_score,
    difficulty = _src.difficulty,
    text = _src.text, answer = _src.answer, solution = _src.solution,
    answer_format = _src.answer_format, source_label = _src.source_label,
    check_format = _src.check_format, task_kind = _src.task_kind,
    cefr_level = _src.cefr_level, grading_criteria_json = _src.grading_criteria_json,
    rubric_text = _src.rubric_text, rubric_image_urls = _src.rubric_image_urls,
    attachment_url = _src.attachment_url, solution_attachment_url = _src.solution_attachment_url,
    fingerprint = _new_fp, updated_at = NOW()
  WHERE id = _pub_id;
  INSERT INTO kb_moderation_log (action, task_id, source_task_id, moderator_id, details)
  VALUES ('resync', _pub_id, p_source_task_id, _src.owner_id,
    jsonb_build_object('old_fingerprint', _old_fp, 'new_fingerprint', _new_fp));
END; $$;

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
      OR NEW.difficulty IS DISTINCT FROM OLD.difficulty
      OR NEW.topic_id IS DISTINCT FROM OLD.topic_id
      OR NEW.subtopic_id IS DISTINCT FROM OLD.subtopic_id
      OR NEW.source_label IS DISTINCT FROM OLD.source_label
      OR NEW.check_format IS DISTINCT FROM OLD.check_format
      OR NEW.task_kind IS DISTINCT FROM OLD.task_kind
      OR NEW.cefr_level IS DISTINCT FROM OLD.cefr_level
      OR NEW.grading_criteria_json IS DISTINCT FROM OLD.grading_criteria_json
      OR NEW.rubric_text IS DISTINCT FROM OLD.rubric_text
      OR NEW.rubric_image_urls IS DISTINCT FROM OLD.rubric_image_urls
      OR NEW.attachment_url IS DISTINCT FROM OLD.attachment_url
      OR NEW.solution_attachment_url IS DISTINCT FROM OLD.solution_attachment_url)
  THEN PERFORM kb_resync_task(NEW.id); RETURN NEW; END IF;
  RETURN NEW;
END; $$;

-- M2b
DROP POLICY IF EXISTS "KB tasks select public or own" ON public.kb_tasks;
DROP POLICY IF EXISTS "KB tasks select catalog tutors or own" ON public.kb_tasks;
CREATE POLICY "KB tasks select catalog tutors or own"
  ON public.kb_tasks FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR (owner_id IS NULL AND (
      (SELECT public.is_tutor(auth.uid()))
      OR (SELECT public.has_role(auth.uid(), 'moderator'))
    ))
  );

-- M3
CREATE TABLE IF NOT EXISTS public.homework_template_tasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES public.homework_tutor_templates(id) ON DELETE CASCADE,
  kb_task_id  UUID NOT NULL REFERENCES public.kb_tasks(id) ON DELETE RESTRICT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT homework_template_tasks_unique UNIQUE (template_id, kb_task_id)
);
CREATE INDEX IF NOT EXISTS idx_hw_template_tasks_template
  ON public.homework_template_tasks(template_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_hw_template_tasks_kb_task
  ON public.homework_template_tasks(kb_task_id);

ALTER TABLE public.homework_tutor_templates
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS published_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS forked_from_template_id UUID NULL
    REFERENCES public.homework_tutor_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS usage_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS tasks_migrated_at TIMESTAMPTZ NULL;

DO $$ BEGIN
  ALTER TABLE public.homework_tutor_templates
    ADD CONSTRAINT homework_tutor_templates_visibility_check
    CHECK (visibility IN ('private', 'shared'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_hw_templates_shared
  ON public.homework_tutor_templates(visibility, subject)
  WHERE visibility = 'shared';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'HW template select shared' AND tablename = 'homework_tutor_templates') THEN
    CREATE POLICY "HW template select shared" ON public.homework_tutor_templates
      FOR SELECT TO authenticated USING (visibility = 'shared');
  END IF;
END $$;

ALTER TABLE public.homework_template_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "HW template tasks select own or shared" ON public.homework_template_tasks;
DROP POLICY IF EXISTS "HW template tasks insert own" ON public.homework_template_tasks;
DROP POLICY IF EXISTS "HW template tasks update own" ON public.homework_template_tasks;
DROP POLICY IF EXISTS "HW template tasks delete own" ON public.homework_template_tasks;

CREATE POLICY "HW template tasks select own or shared" ON public.homework_template_tasks
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.homework_tutor_templates t
    WHERE t.id = template_id AND (t.tutor_id = auth.uid() OR t.visibility = 'shared')));
CREATE POLICY "HW template tasks insert own" ON public.homework_template_tasks
  FOR INSERT TO authenticated WITH CHECK (EXISTS (
    SELECT 1 FROM public.homework_tutor_templates t
    WHERE t.id = template_id AND t.tutor_id = auth.uid()));
CREATE POLICY "HW template tasks update own" ON public.homework_template_tasks
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.homework_tutor_templates t
    WHERE t.id = template_id AND t.tutor_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.homework_tutor_templates t
    WHERE t.id = template_id AND t.tutor_id = auth.uid()));
CREATE POLICY "HW template tasks delete own" ON public.homework_template_tasks
  FOR DELETE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.homework_tutor_templates t
    WHERE t.id = template_id AND t.tutor_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.homework_template_tasks TO authenticated;
GRANT ALL ON public.homework_template_tasks TO service_role;

REVOKE INSERT, UPDATE ON public.homework_tutor_templates FROM anon, authenticated;
GRANT INSERT (tutor_id, title, subject, topic, tags, tasks_json,
              exam_type, feedback_language, disable_ai_bootstrap)
  ON public.homework_tutor_templates TO authenticated;
GRANT UPDATE (title, subject, topic, tags, tasks_json,
              exam_type, feedback_language, disable_ai_bootstrap)
  ON public.homework_tutor_templates TO authenticated;

CREATE OR REPLACE FUNCTION public.hw_mod_publish_template(p_template_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _caller UUID; _tpl RECORD; _ref RECORD; _offenders TEXT := ''; _target UUID; _fp TEXT;
BEGIN
  _caller := public.kb_require_moderator();
  SELECT * INTO _tpl FROM homework_tutor_templates WHERE id = p_template_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Шаблон не найден'; END IF;
  IF _tpl.tutor_id <> _caller THEN RAISE EXCEPTION 'Публиковать можно только свои шаблоны'; END IF;
  IF _tpl.tasks_migrated_at IS NULL THEN
    RAISE EXCEPTION 'Шаблон ещё в старом формате — пересохраните его перед публикацией';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM homework_template_tasks WHERE template_id = p_template_id) THEN
    RAISE EXCEPTION 'В шаблоне нет задач';
  END IF;
  FOR _ref IN
    SELECT kt.id, left(COALESCE(kt.text, ''), 60) AS excerpt
    FROM homework_template_tasks htt JOIN kb_tasks kt ON kt.id = htt.kb_task_id
    WHERE htt.template_id = p_template_id AND kt.owner_id IS NOT NULL AND kt.topic_id IS NULL
  LOOP
    _offenders := _offenders || CASE WHEN _offenders = '' THEN '' ELSE '; ' END || '«' || _ref.excerpt || '…»';
  END LOOP;
  IF _offenders <> '' THEN
    RAISE EXCEPTION 'У задач не указана тема (нужна для публикации в каталог): %', _offenders;
  END IF;
  FOR _ref IN
    SELECT htt.id AS ref_id, kt.*
    FROM homework_template_tasks htt JOIN kb_tasks kt ON kt.id = htt.kb_task_id
    WHERE htt.template_id = p_template_id ORDER BY htt.sort_order
  LOOP
    _target := NULL;
    IF _ref.owner_id IS NULL THEN
      IF _ref.moderation_status = 'active' THEN CONTINUE; END IF;
      SELECT id INTO _target FROM kb_tasks
      WHERE fingerprint = _ref.fingerprint AND owner_id IS NULL
        AND moderation_status = 'active' AND id <> _ref.id LIMIT 1;
      IF _target IS NULL THEN
        RAISE EXCEPTION 'Каталожная задача «%…» скрыта и не имеет активной копии — замените её в шаблоне',
          left(COALESCE(_ref.text, ''), 60);
      END IF;
    ELSE
      IF _ref.published_task_id IS NOT NULL THEN
        _target := _ref.published_task_id;
        IF NOT EXISTS (SELECT 1 FROM kb_tasks WHERE id = _target AND moderation_status = 'active') THEN
          SELECT id INTO _target FROM kb_tasks
          WHERE fingerprint = _ref.fingerprint AND owner_id IS NULL AND moderation_status = 'active' LIMIT 1;
          IF _target IS NULL THEN
            RAISE EXCEPTION 'Опубликованная копия задачи «%…» скрыта — переопубликуйте её из Базы',
              left(COALESCE(_ref.text, ''), 60);
          END IF;
        END IF;
      ELSE
        _fp := kb_normalize_fingerprint(_ref.text, _ref.answer, _ref.attachment_url);
        SELECT id INTO _target FROM kb_tasks
        WHERE fingerprint = _fp AND owner_id IS NULL AND moderation_status = 'active' LIMIT 1;
        IF _target IS NULL THEN
          _target := kb_publish_task(_ref.id);
          IF NOT EXISTS (SELECT 1 FROM kb_tasks WHERE id = _target AND moderation_status = 'active') THEN
            SELECT id INTO _target FROM kb_tasks
            WHERE fingerprint = _fp AND owner_id IS NULL AND moderation_status = 'active' LIMIT 1;
          END IF;
        END IF;
      END IF;
    END IF;
    IF _target IS NULL THEN
      RAISE EXCEPTION 'Не удалось опубликовать задачу «%…» в каталог', left(COALESCE(_ref.text, ''), 60);
    END IF;
    BEGIN
      UPDATE homework_template_tasks SET kb_task_id = _target WHERE id = _ref.ref_id;
    EXCEPTION WHEN unique_violation THEN
      DELETE FROM homework_template_tasks WHERE id = _ref.ref_id;
      RAISE NOTICE 'hw_mod_publish_template: дубль-ссылка % схлопнута в %', _ref.ref_id, _target;
    END;
  END LOOP;
  UPDATE homework_tutor_templates
  SET visibility = 'shared', published_by = _caller, published_at = now(), updated_at = now()
  WHERE id = p_template_id;
  RETURN p_template_id;
END; $$;

CREATE OR REPLACE FUNCTION public.hw_mod_unpublish_template(p_template_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _caller UUID;
BEGIN
  _caller := public.kb_require_moderator();
  UPDATE homework_tutor_templates SET visibility = 'private', updated_at = now()
  WHERE id = p_template_id AND visibility = 'shared';
  IF NOT FOUND THEN RAISE EXCEPTION 'Шаблон не найден или уже не опубликован'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.kb_task_template_refs(p_task_ids UUID[])
RETURNS TABLE (kb_task_id UUID, template_count BIGINT, template_titles TEXT[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT htt.kb_task_id, COUNT(DISTINCT t.id) AS template_count,
         (ARRAY_AGG(DISTINCT t.title))[1:5] AS template_titles
  FROM homework_template_tasks htt
  JOIN homework_tutor_templates t ON t.id = htt.template_id
  WHERE htt.kb_task_id = ANY(p_task_ids)
    AND (t.tutor_id = auth.uid() OR t.visibility = 'shared')
  GROUP BY htt.kb_task_id;
$$;

REVOKE ALL ON FUNCTION public.hw_mod_publish_template(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hw_mod_unpublish_template(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kb_task_template_refs(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hw_mod_publish_template(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hw_mod_unpublish_template(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kb_task_template_refs(UUID[]) TO authenticated, service_role;

-- M4
ALTER TABLE public.homework_tutor_tasks
  ADD COLUMN IF NOT EXISTS source_kb_task_id UUID NULL
    REFERENCES public.kb_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_kb_synced_at TIMESTAMPTZ NULL;
CREATE INDEX IF NOT EXISTS idx_hw_tasks_source_kb
  ON public.homework_tutor_tasks(source_kb_task_id)
  WHERE source_kb_task_id IS NOT NULL;
ALTER TABLE public.homework_tutor_assignments
  ADD COLUMN IF NOT EXISTS source_template_id UUID NULL
    REFERENCES public.homework_tutor_templates(id) ON DELETE SET NULL;

-- M5
CREATE OR REPLACE FUNCTION public.hw_materialize_legacy_templates()
RETURNS TABLE (templates_migrated INTEGER, tasks_created INTEGER, tasks_reused INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _tpl RECORD; _elem JSONB; _idx INTEGER;
  _root_id UUID; _sub_id UUID; _target UUID; _src_id UUID; _fp TEXT;
  _kim INTEGER; _check_format TEXT; _task_kind TEXT; _cefr TEXT; _criteria JSONB;
  _max_score NUMERIC; _primary SMALLINT; _exam exam_type;
  _n_tpl INTEGER := 0; _n_created INTEGER := 0; _n_reused INTEGER := 0;
BEGIN
  FOR _tpl IN
    SELECT * FROM homework_tutor_templates
    WHERE tasks_migrated_at IS NULL
      AND jsonb_typeof(tasks_json) = 'array'
      AND jsonb_array_length(tasks_json) > 0
    ORDER BY created_at
  LOOP
    SELECT id INTO _root_id FROM kb_folders
    WHERE owner_id = _tpl.tutor_id AND parent_id IS NULL AND lower(name) = lower('Из шаблонов') LIMIT 1;
    IF _root_id IS NULL THEN
      INSERT INTO kb_folders (owner_id, parent_id, name) VALUES (_tpl.tutor_id, NULL, 'Из шаблонов')
      RETURNING id INTO _root_id;
    END IF;
    SELECT id INTO _sub_id FROM kb_folders
    WHERE owner_id = _tpl.tutor_id AND parent_id = _root_id
      AND lower(name) = lower(left(COALESCE(NULLIF(trim(_tpl.title), ''), 'Без названия'), 120)) LIMIT 1;
    IF _sub_id IS NULL THEN
      INSERT INTO kb_folders (owner_id, parent_id, name)
      VALUES (_tpl.tutor_id, _root_id, left(COALESCE(NULLIF(trim(_tpl.title), ''), 'Без названия'), 120))
      RETURNING id INTO _sub_id;
    END IF;
    _exam := CASE WHEN _tpl.exam_type IN ('ege', 'oge') THEN _tpl.exam_type::exam_type ELSE NULL END;
    _idx := 0;
    FOR _elem IN SELECT jsonb_array_elements(_tpl.tasks_json)
    LOOP
      _target := NULL; _src_id := NULL;
      BEGIN _src_id := NULLIF(trim(_elem->>'source_kb_task_id'), '')::UUID;
      EXCEPTION WHEN invalid_text_representation THEN _src_id := NULL; END;
      IF _src_id IS NOT NULL THEN
        SELECT id INTO _target FROM kb_tasks
        WHERE id = _src_id
          AND (owner_id = _tpl.tutor_id OR (owner_id IS NULL AND moderation_status = 'active'))
        LIMIT 1;
      END IF;
      IF _target IS NULL THEN
        _fp := kb_normalize_fingerprint(
          COALESCE(NULLIF(trim(_elem->>'task_text'), ''), '[Задача на фото]'),
          NULLIF(trim(_elem->>'correct_answer'), ''),
          NULLIF(trim(_elem->>'task_image_url'), '')
        );
        SELECT id INTO _target FROM kb_tasks
        WHERE owner_id = _tpl.tutor_id AND fingerprint = _fp LIMIT 1;
        IF _target IS NOT NULL THEN _n_reused := _n_reused + 1; END IF;
      ELSE _n_reused := _n_reused + 1; END IF;
      IF _target IS NULL THEN
        _kim := CASE WHEN (_elem->>'kim_number') ~ '^\d+$'
                     THEN LEAST(GREATEST((_elem->>'kim_number')::INTEGER, 1), 40) ELSE NULL END;
        _check_format := CASE WHEN _elem->>'check_format' IN ('short_answer', 'detailed_solution')
                              THEN _elem->>'check_format' ELSE NULL END;
        _task_kind := CASE WHEN _elem->>'task_kind' IN ('numeric', 'extended', 'proof', 'speaking')
                           THEN _elem->>'task_kind' ELSE NULL END;
        _cefr := CASE WHEN _elem->>'cefr_level' IN ('A2', 'B1', 'B2', 'C1')
                      THEN _elem->>'cefr_level' ELSE NULL END;
        _criteria := CASE WHEN jsonb_typeof(_elem->'grading_criteria_json') = 'array'
                          THEN _elem->'grading_criteria_json' ELSE NULL END;
        BEGIN _max_score := NULLIF(trim(_elem->>'max_score'), '')::NUMERIC;
        EXCEPTION WHEN invalid_text_representation THEN _max_score := NULL; END;
        _primary := CASE WHEN _max_score IS NOT NULL AND _max_score > 0
                         THEN LEAST(ROUND(_max_score), 32767)::SMALLINT ELSE NULL END;
        INSERT INTO kb_tasks (
          owner_id, folder_id, topic_id, subtopic_id,
          exam, kim_number, primary_score,
          text, answer, solution, answer_format,
          check_format, task_kind, cefr_level, grading_criteria_json,
          rubric_text, rubric_image_urls,
          attachment_url, solution_attachment_url,
          source_label, fingerprint
        ) VALUES (
          _tpl.tutor_id, _sub_id, NULL, NULL,
          _exam, _kim, _primary,
          COALESCE(NULLIF(trim(_elem->>'task_text'), ''), '[Задача на фото]'),
          NULLIF(trim(_elem->>'correct_answer'), ''),
          NULLIF(trim(_elem->>'solution_text'), ''),
          NULL,
          _check_format, _task_kind, _cefr, _criteria,
          NULLIF(trim(_elem->>'rubric_text'), ''),
          NULLIF(trim(_elem->>'rubric_image_urls'), ''),
          NULLIF(trim(_elem->>'task_image_url'), ''),
          NULLIF(trim(_elem->>'solution_image_urls'), ''),
          'my', _fp
        ) RETURNING id INTO _target;
        _n_created := _n_created + 1;
      END IF;
      INSERT INTO homework_template_tasks (template_id, kb_task_id, sort_order)
      VALUES (_tpl.id, _target, _idx) ON CONFLICT (template_id, kb_task_id) DO NOTHING;
      _idx := _idx + 1;
    END LOOP;
    UPDATE homework_tutor_templates SET tasks_migrated_at = now() WHERE id = _tpl.id;
    _n_tpl := _n_tpl + 1;
  END LOOP;
  UPDATE homework_tutor_templates SET tasks_migrated_at = now()
  WHERE tasks_migrated_at IS NULL
    AND (jsonb_typeof(tasks_json) <> 'array' OR jsonb_array_length(tasks_json) = 0);
  RETURN QUERY SELECT _n_tpl, _n_created, _n_reused;
END; $$;

REVOKE ALL ON FUNCTION public.hw_materialize_legacy_templates() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hw_materialize_legacy_templates() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hw_materialize_legacy_templates() TO service_role;

DO $$
DECLARE _r RECORD;
BEGIN
  SELECT * INTO _r FROM public.hw_materialize_legacy_templates();
  RAISE NOTICE 'hw_materialize_legacy_templates: templates=%, created=%, reused=%',
    _r.templates_migrated, _r.tasks_created, _r.tasks_reused;
END $$;

-- P0
CREATE OR REPLACE FUNCTION public.kb_require_tutor_or_moderator()
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Требуется вход в систему'; END IF;
  IF NOT (public.is_tutor(auth.uid()) OR public.has_role(auth.uid(), 'moderator')) THEN
    RAISE EXCEPTION 'Каталог задач доступен только репетиторам';
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.kb_require_tutor_or_moderator() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kb_require_tutor_or_moderator() TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.fetch_catalog_tasks_v2(UUID);
CREATE OR REPLACE FUNCTION public.fetch_catalog_tasks_v2(p_topic_id UUID)
RETURNS SETOF public.kb_tasks LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.kb_require_tutor_or_moderator();
  RETURN QUERY
  SELECT t.* FROM kb_tasks t
  WHERE t.topic_id = p_topic_id AND t.owner_id IS NULL AND t.moderation_status = 'active'
  ORDER BY t.created_at;
END; $$;

DROP FUNCTION IF EXISTS public.fetch_catalog_tasks_all(UUID);
CREATE OR REPLACE FUNCTION public.fetch_catalog_tasks_all(p_topic_id UUID)
RETURNS SETOF public.kb_tasks LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.kb_require_tutor_or_moderator();
  RETURN QUERY
  SELECT t.* FROM kb_tasks t
  WHERE t.topic_id = p_topic_id AND t.owner_id IS NULL
    AND (t.moderation_status = 'active' OR has_role(auth.uid(), 'moderator'))
  ORDER BY t.moderation_status, t.created_at;
END; $$;

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

-- P1
CREATE OR REPLACE FUNCTION public.hw_template_task_counts(p_template_ids UUID[])
RETURNS TABLE (template_id UUID, task_count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT htt.template_id, COUNT(*) AS task_count
  FROM homework_template_tasks htt
  WHERE htt.template_id = ANY(p_template_ids)
  GROUP BY htt.template_id;
$$;
REVOKE ALL ON FUNCTION public.hw_template_task_counts(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hw_template_task_counts(UUID[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hw_template_task_counts(UUID[]) TO service_role;
