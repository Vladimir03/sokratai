-- HOTFIX: создание варианта С БЛОКАМИ падало всегда (регрессия 20260801120000)
-- ---------------------------------------------------------------------------
-- Инцидент 01.08.2026, репортер — София (репетитор школы Эмилии, работает под
-- её аккаунтом): «вариант который я сделала не сохранился (писало что нельзя
-- сохранить попробуйте позже и всё вылетело)». Потеряна работа над вариантом
-- DELF A1 целиком.
--
-- ПРИЧИНА. `mock_exam_variant_create_with_tasks` работает в два шага:
--   1) INSERT строки варианта — вместе с task_blocks_json;
--   2) PERFORM mock_exam_variant_replace_tasks(v_id, _tasks) — двумя
--      позиционными аргументами, остальные берут DEFAULT.
-- После добавления CAS (20260801120000) во втором шаге появился гард:
--
--   ELSIF v_has_blocks AND _tasks IS NOT NULL THEN RAISE 'VARIANT_STALE';
--
-- Он задуман против УСТАРЕВШЕГО КЛИЕНТА, который не умеет присылать ревизию и
-- потому молча стёр бы привязки блоков. Но `create_with_tasks` — внутренний
-- вызов, он тоже не передаёт `_expected_revision`, а блоки к этому моменту
-- УЖЕ вставлены шагом 1 ⇒ v_has_blocks = TRUE ⇒ VARIANT_STALE ⇒ откат всей
-- транзакции. То есть: любой НОВЫЙ вариант с блоками не создавался никогда,
-- а редактирование существующего работало (там клиент шлёт ревизию).
--
-- Косвенное подтверждение из прода: в бакете mock-exam-listening-audio 11
-- файлов, а в блоках используется 3 — 8 осиротевших загрузок, это и есть
-- следы неудачных попыток сохранить (аудио уходит в Storage сразу, ref
-- записывается только вместе с вариантом).
--
-- ФИКС: передаём ревизию явно и ИМЕНОВАННО. Именованные аргументы здесь не
-- стилистика: у функции 11 параметров, и позиционный вызов на 11 мест —
-- ровно тот способ, которым такую ошибку легко внести снова.
--
-- Гард при этом НЕ ослабляем: он продолжает отбивать реальных stale-клиентов,
-- потому что снаружи ревизию по-прежнему обязан прислать фронт.
--
-- Idempotent.

BEGIN;

CREATE OR REPLACE FUNCTION public.mock_exam_variant_create_with_tasks(
  _meta jsonb,
  _tasks jsonb
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
  v_p1 int;
  v_p2 int;
  v_revision int;
BEGIN
  IF _tasks IS NULL OR jsonb_typeof(_tasks) <> 'array' OR jsonb_array_length(_tasks) = 0 THEN
    RAISE EXCEPTION 'TASKS_REQUIRED';
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN (t->>'part')::int = 1 THEN (t->>'max_score')::int ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN (t->>'part')::int = 2 THEN (t->>'max_score')::int ELSE 0 END), 0)
  INTO v_p1, v_p2
  FROM jsonb_array_elements(_tasks) AS t;

  INSERT INTO public.mock_exam_variants (
    title, exam_type, source, source_attribution, duration_minutes,
    total_max_score, part1_max, part2_max, task_count,
    created_by, owner_id, subject, variant_pdf_url,
    listening_audio_url, listening_transcript,
    task_blocks_json, block_transcripts_json
  ) VALUES (
    _meta->>'title',
    _meta->>'exam_type',
    COALESCE(NULLIF(_meta->>'source', ''), 'tutor'),
    NULLIF(_meta->>'source_attribution', ''),
    (_meta->>'duration_minutes')::int,
    v_p1 + v_p2,
    v_p1,
    v_p2,
    jsonb_array_length(_tasks),
    (_meta->>'created_by')::uuid,
    (_meta->>'owner_id')::uuid,
    NULLIF(_meta->>'subject', ''),
    NULLIF(_meta->>'variant_pdf_url', ''),
    NULLIF(_meta->>'listening_audio_url', ''),
    NULLIF(_meta->>'listening_transcript', ''),
    CASE
      WHEN jsonb_typeof(_meta->'task_blocks_json') = 'array'
       AND jsonb_array_length(_meta->'task_blocks_json') > 0
      THEN _meta->'task_blocks_json'
    END,
    CASE
      WHEN jsonb_typeof(_meta->'block_transcripts_json') = 'object'
       AND _meta->'block_transcripts_json' <> '{}'::jsonb
      THEN _meta->'block_transcripts_json'
    END
  ) RETURNING id, content_revision INTO v_id, v_revision;

  -- Читаем ревизию у ТОЛЬКО ЧТО вставленной строки, а не полагаемся на
  -- «DEFAULT наверняка 1»: если дефолт когда-нибудь изменится, вызов не
  -- начнёт молча падать — он останется верным по построению.
  PERFORM public.mock_exam_variant_replace_tasks(
    _variant_id       := v_id,
    _tasks            := _tasks,
    _expected_revision := v_revision
  );
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mock_exam_variant_create_with_tasks(jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mock_exam_variant_create_with_tasks(jsonb, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mock_exam_variant_create_with_tasks(jsonb, jsonb) TO service_role;

COMMENT ON FUNCTION public.mock_exam_variant_create_with_tasks(jsonb, jsonb) IS
  'Создание/дублирование варианта одной транзакцией (мета + блоки + задачи + тоталы). Вызывает replace_tasks ИМЕНОВАННЫМИ аргументами и передаёт _expected_revision вставленной строки — иначе CAS-гард (20260801120000) принимал внутренний вызов за stale-клиента и ронял создание любого варианта с блоками (инцидент 01.08). service_role-only.';

COMMIT;

-- Validation (ожидаем создание варианта с блоками без ошибки):
-- SELECT public.mock_exam_variant_create_with_tasks(
--   '{"title":"__probe__","exam_type":"ege","duration_minutes":60,
--     "created_by":"<uuid>","owner_id":"<uuid>","subject":"french",
--     "task_blocks_json":[{"id":"b1","title":"","instruction":"","image_url":null,"audio_url":null}]}'::jsonb,
--   '[{"kim_number":1,"part":1,"order_num":1,"task_text":"x","check_mode":"strict",
--      "correct_answer":"1","max_score":1,"block_id":"b1"}]'::jsonb);
-- Затем удалить пробный вариант.
