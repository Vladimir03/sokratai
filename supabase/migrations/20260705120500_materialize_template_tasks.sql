-- ══════════════════════════════════════════════════════════════
-- Единая модель задач (unified-task-model, Фаза 0 / M5) — 2026-07-05
-- Материализация legacy-шаблонов: tasks_json (JSON-снимки) → личные kb_tasks
-- (папка «Из шаблонов» / подпапка по названию шаблона) + ссылки
-- homework_template_tasks. Решение владельца №5: только шаблоны (=явное
-- «буду переиспользовать»), задачи старых ВЫДАННЫХ ДЗ НЕ бэкфиллим.
--
-- Идемпотентность: маркер tasks_migrated_at + fingerprint-дедуп против
-- существующих задач владельца + UNIQUE(template_id, kb_task_id) ON CONFLICT.
-- Провенанс: elem->>'source_kb_task_id' (жив и читаем владельцем) → reuse.
--
-- Re-runnable: тело живёт в hw_materialize_legacy_templates() (service_role
-- only) — для шаблонов, созданных старым фронтом в окно deploy-skew, функция
-- перезапускается на Фазе 3. tasks_json НЕ дропается (read-fallback + audit);
-- умирают только его записи (Фаза 3 cleanup).
-- ══════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.hw_materialize_legacy_templates()
RETURNS TABLE (templates_migrated INTEGER, tasks_created INTEGER, tasks_reused INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tpl RECORD;
  _elem JSONB;
  _idx INTEGER;
  _root_id UUID;
  _sub_id UUID;
  _target UUID;
  _src_id UUID;
  _fp TEXT;
  _kim INTEGER;
  _check_format TEXT;
  _task_kind TEXT;
  _cefr TEXT;
  _criteria JSONB;
  _max_score NUMERIC;
  _primary SMALLINT;
  _exam exam_type;
  _n_tpl INTEGER := 0;
  _n_created INTEGER := 0;
  _n_reused INTEGER := 0;
BEGIN
  FOR _tpl IN
    SELECT * FROM homework_tutor_templates
    WHERE tasks_migrated_at IS NULL
      AND jsonb_typeof(tasks_json) = 'array'
      AND jsonb_array_length(tasks_json) > 0
    ORDER BY created_at
  LOOP
    -- Корневая папка «Из шаблонов» владельца (find-or-create, case-insensitive).
    SELECT id INTO _root_id FROM kb_folders
    WHERE owner_id = _tpl.tutor_id AND parent_id IS NULL AND lower(name) = lower('Из шаблонов')
    LIMIT 1;
    IF _root_id IS NULL THEN
      INSERT INTO kb_folders (owner_id, parent_id, name)
      VALUES (_tpl.tutor_id, NULL, 'Из шаблонов')
      RETURNING id INTO _root_id;
    END IF;

    -- Подпапка по названию шаблона (одноимённые шаблоны сливаются — приемлемо).
    SELECT id INTO _sub_id FROM kb_folders
    WHERE owner_id = _tpl.tutor_id AND parent_id = _root_id
      AND lower(name) = lower(left(COALESCE(NULLIF(trim(_tpl.title), ''), 'Без названия'), 120))
    LIMIT 1;
    IF _sub_id IS NULL THEN
      INSERT INTO kb_folders (owner_id, parent_id, name)
      VALUES (_tpl.tutor_id, _root_id, left(COALESCE(NULLIF(trim(_tpl.title), ''), 'Без названия'), 120))
      RETURNING id INTO _sub_id;
    END IF;

    _exam := CASE WHEN _tpl.exam_type IN ('ege', 'oge') THEN _tpl.exam_type::exam_type ELSE NULL END;

    _idx := 0;
    FOR _elem IN SELECT jsonb_array_elements(_tpl.tasks_json)
    LOOP
      _target := NULL;

      -- 1) Провенанс: source_kb_task_id жив и читаем владельцем шаблона.
      _src_id := NULL;
      BEGIN
        _src_id := NULLIF(trim(_elem->>'source_kb_task_id'), '')::UUID;
      EXCEPTION WHEN invalid_text_representation THEN _src_id := NULL; END;
      IF _src_id IS NOT NULL THEN
        SELECT id INTO _target FROM kb_tasks
        WHERE id = _src_id
          AND (owner_id = _tpl.tutor_id OR (owner_id IS NULL AND moderation_status = 'active'))
        LIMIT 1;
      END IF;

      -- 2) Fingerprint-дедуп против существующих задач владельца.
      IF _target IS NULL THEN
        _fp := kb_normalize_fingerprint(
          COALESCE(NULLIF(trim(_elem->>'task_text'), ''), '[Задача на фото]'),
          NULLIF(trim(_elem->>'correct_answer'), ''),
          NULLIF(trim(_elem->>'task_image_url'), '')
        );
        SELECT id INTO _target FROM kb_tasks
        WHERE owner_id = _tpl.tutor_id AND fingerprint = _fp
        LIMIT 1;
        IF _target IS NOT NULL THEN
          _n_reused := _n_reused + 1;
        END IF;
      ELSE
        _n_reused := _n_reused + 1;
      END IF;

      -- 3) Иначе — материализуем в личную Базу (полный набор полей).
      IF _target IS NULL THEN
        _kim := CASE WHEN (_elem->>'kim_number') ~ '^\d+$'
                     THEN LEAST(GREATEST((_elem->>'kim_number')::INTEGER, 1), 40)
                     ELSE NULL END;
        _check_format := CASE WHEN _elem->>'check_format' IN ('short_answer', 'detailed_solution')
                              THEN _elem->>'check_format' ELSE NULL END;
        _task_kind := CASE WHEN _elem->>'task_kind' IN ('numeric', 'extended', 'proof', 'speaking')
                           THEN _elem->>'task_kind' ELSE NULL END;
        _cefr := CASE WHEN _elem->>'cefr_level' IN ('A2', 'B1', 'B2', 'C1')
                      THEN _elem->>'cefr_level' ELSE NULL END;
        _criteria := CASE WHEN jsonb_typeof(_elem->'grading_criteria_json') = 'array'
                          THEN _elem->'grading_criteria_json' ELSE NULL END;
        BEGIN
          _max_score := NULLIF(trim(_elem->>'max_score'), '')::NUMERIC;
        EXCEPTION WHEN invalid_text_representation THEN _max_score := NULL; END;
        _primary := CASE WHEN _max_score IS NOT NULL AND _max_score > 0
                         THEN LEAST(ROUND(_max_score), 32767)::SMALLINT
                         ELSE NULL END;
        IF _max_score IS NOT NULL AND _primary IS NOT NULL AND _max_score <> _primary THEN
          RAISE NOTICE 'hw_materialize: max_score % округлён до % (template %, idx %)',
            _max_score, _primary, _tpl.id, _idx;
        END IF;

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
        )
        RETURNING id INTO _target;
        _n_created := _n_created + 1;
      END IF;

      INSERT INTO homework_template_tasks (template_id, kb_task_id, sort_order)
      VALUES (_tpl.id, _target, _idx)
      ON CONFLICT (template_id, kb_task_id) DO NOTHING;

      _idx := _idx + 1;
    END LOOP;

    UPDATE homework_tutor_templates SET tasks_migrated_at = now() WHERE id = _tpl.id;
    _n_tpl := _n_tpl + 1;
  END LOOP;

  -- Пустые legacy-шаблоны — просто маркируем (нечего материализовать).
  UPDATE homework_tutor_templates
  SET tasks_migrated_at = now()
  WHERE tasks_migrated_at IS NULL
    AND (jsonb_typeof(tasks_json) <> 'array' OR jsonb_array_length(tasks_json) = 0);

  RETURN QUERY SELECT _n_tpl, _n_created, _n_reused;
END;
$$;

REVOKE ALL ON FUNCTION public.hw_materialize_legacy_templates() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hw_materialize_legacy_templates() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hw_materialize_legacy_templates() TO service_role;

-- One-shot прогон (от имени миграции = superuser).
DO $$
DECLARE _r RECORD;
BEGIN
  SELECT * INTO _r FROM public.hw_materialize_legacy_templates();
  RAISE NOTICE 'hw_materialize_legacy_templates: templates=%, created=%, reused=%',
    _r.templates_migrated, _r.tasks_created, _r.tasks_reused;
END $$;

COMMIT;
