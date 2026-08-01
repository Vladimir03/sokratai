-- Mock Exams — ревизия контента варианта (CAS против stale-клиента)
-- ---------------------------------------------------------------------------
-- Закрывает ТРИ находки ревью 5.6 по блокам заданий (20260801100000) ОДНИМ
-- механизмом — потому что это одна болезнь: сохранение из клиента, который
-- видел ДРУГУЮ версию варианта.
--
-- P0-5 «lost update между вкладками». `FOR UPDATE` сериализует транзакции, но
--   НЕ обнаруживает устаревший снимок: вкладка A удалила блок и сохранила,
--   вкладка B (открыта раньше) сохраняет свой старый массив — удалённый блок
--   воскресает, правки A затираются. `BLOCK_NOT_FOUND` тут не срабатывает:
--   в payload B блок присутствует. Класс пред-существующий (редактор всегда
--   писал полный снимок), но блоки подняли цену: теряется не строка, а весь
--   материал с привязками.
--
-- P0-4 «block_id отсутствует vs явный null». После штатного деплоя edge у
--   репетитора может остаться СТАРАЯ вкладка/кэш-бандл. Она шлёт задачи вообще
--   без поля `block_id`, edge нормализует его в NULL, RPC заменяет задачи — все
--   привязки исчезают с success-ответом. Ревизия ловит и это: старый бандл не
--   знает про поле `expected_revision` и получает 409 вместо тихой потери.
--
-- P0-3 «listening_fields_applied не доказывает поддержку блоков» решается не
--   здесь, а отдельным маркером `block_fields_applied` в edge (старый edge
--   от 31.07 возвращает listening-маркер захардкоженным true, поэтому он
--   бесполезен как признак поддержки блоков).
--
-- Контракт: клиент присылает ревизию, которую загрузил. Не совпала — 409
-- VARIANT_STALE, «обновите страницу». NULL = клиент не поддерживает ревизии;
-- тогда отказ только если варианту есть что терять (у него есть блоки).
--
-- Idempotent.

BEGIN;

ALTER TABLE public.mock_exam_variants
  ADD COLUMN IF NOT EXISTS content_revision integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.mock_exam_variants.content_revision IS
  'Версия контента (задачи + блоки + мета). Инкрементится КАЖДЫМ успешным сохранением через mock_exam_variant_replace_tasks. Клиент шлёт загруженное значение как _expected_revision; расхождение → VARIANT_STALE (409). Защита от lost update между вкладками и от stale-бандла, потерявшего block_id.';

DROP FUNCTION IF EXISTS public.mock_exam_variant_replace_tasks(uuid, jsonb, text, text, text, int, text, text, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.mock_exam_variant_replace_tasks(
  _variant_id uuid,
  _tasks jsonb,
  _title text DEFAULT NULL,
  _subject text DEFAULT NULL,
  _exam_type text DEFAULT NULL,
  _duration_minutes int DEFAULT NULL,
  _listening_audio_url text DEFAULT NULL,
  _listening_transcript text DEFAULT NULL,
  _task_blocks jsonb DEFAULT NULL,
  _block_transcripts jsonb DEFAULT NULL,
  _expected_revision int DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_blocks jsonb;
  v_revision int;
  v_has_blocks boolean;
BEGIN
  IF _tasks IS NOT NULL
     AND (jsonb_typeof(_tasks) <> 'array' OR jsonb_array_length(_tasks) = 0) THEN
    RAISE EXCEPTION 'TASKS_REQUIRED';
  END IF;

  IF _task_blocks IS NOT NULL AND jsonb_typeof(_task_blocks) <> 'array' THEN
    RAISE EXCEPTION 'BLOCKS_MALFORMED';
  END IF;
  IF _block_transcripts IS NOT NULL AND jsonb_typeof(_block_transcripts) <> 'object' THEN
    RAISE EXCEPTION 'BLOCKS_MALFORMED';
  END IF;

  -- TOCTOU-гард: лочим строку варианта до проверок.
  SELECT content_revision,
         COALESCE(jsonb_array_length(task_blocks_json), 0) > 0
    INTO v_revision, v_has_blocks
    FROM public.mock_exam_variants
   WHERE id = _variant_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VARIANT_NOT_FOUND';
  END IF;

  -- CAS. Проверяем ДО in-use гарда: «твоя страница устарела» — более точный
  -- диагноз, чем «вариант назначен», если за это время произошло и то, и то.
  IF _expected_revision IS NOT NULL THEN
    IF _expected_revision <> v_revision THEN
      RAISE EXCEPTION 'VARIANT_STALE';
    END IF;
  ELSIF v_has_blocks AND _tasks IS NOT NULL THEN
    -- Клиент без поддержки ревизий переписывает задачи варианта, У КОТОРОГО
    -- ЕСТЬ БЛОКИ ⇒ он не умеет и block_id, и стёр бы все привязки молча.
    -- Вариантам без блоков терять нечего — их не трогаем (обратная совместимость).
    RAISE EXCEPTION 'VARIANT_STALE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.mock_exam_assignments WHERE variant_id = _variant_id
  ) THEN
    RAISE EXCEPTION 'VARIANT_IN_USE';
  END IF;

  UPDATE public.mock_exam_variants
  SET
    title = COALESCE(_title, title),
    subject = COALESCE(_subject, subject),
    exam_type = COALESCE(_exam_type, exam_type),
    duration_minutes = COALESCE(_duration_minutes, duration_minutes),
    -- '' = явная очистка (NULLIF → NULL в колонке), NULL = не менять.
    listening_audio_url = CASE
      WHEN _listening_audio_url IS NULL THEN listening_audio_url
      ELSE NULLIF(_listening_audio_url, '')
    END,
    listening_transcript = CASE
      WHEN _listening_transcript IS NULL THEN listening_transcript
      ELSE NULLIF(_listening_transcript, '')
    END,
    -- '[]' / '{}' = явная очистка, NULL = не менять.
    task_blocks_json = CASE
      WHEN _task_blocks IS NULL THEN task_blocks_json
      WHEN jsonb_array_length(_task_blocks) = 0 THEN NULL
      ELSE _task_blocks
    END,
    block_transcripts_json = CASE
      WHEN _block_transcripts IS NULL THEN block_transcripts_json
      WHEN _block_transcripts = '{}'::jsonb THEN NULL
      ELSE _block_transcripts
    END,
    content_revision = content_revision + 1
  WHERE id = _variant_id;

  SELECT COALESCE(task_blocks_json, '[]'::jsonb)
    INTO v_blocks
    FROM public.mock_exam_variants
   WHERE id = _variant_id;

  IF _tasks IS NULL THEN
    IF _task_blocks IS NOT NULL THEN
      UPDATE public.mock_exam_variant_tasks t
         SET block_id = NULL
       WHERE t.variant_id = _variant_id
         AND t.block_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_blocks) AS b
            WHERE b->>'id' = t.block_id
         );
    END IF;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(_tasks) AS t
     WHERE NULLIF(t->>'block_id', '') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_blocks) AS b
          WHERE b->>'id' = t->>'block_id'
       )
  ) THEN
    RAISE EXCEPTION 'BLOCK_NOT_FOUND';
  END IF;

  DELETE FROM public.mock_exam_variant_tasks WHERE variant_id = _variant_id;

  INSERT INTO public.mock_exam_variant_tasks (
    variant_id, kim_number, part, order_num, task_text, task_image_url,
    correct_answer, check_mode, max_score, solution_text, solution_image_urls,
    topic, block_id
  )
  SELECT
    _variant_id,
    (t->>'kim_number')::int,
    (t->>'part')::int,
    (t->>'order_num')::int,
    t->>'task_text',
    NULLIF(t->>'task_image_url', ''),
    NULLIF(t->>'correct_answer', ''),
    NULLIF(t->>'check_mode', ''),
    (t->>'max_score')::int,
    NULLIF(t->>'solution_text', ''),
    NULLIF(t->>'solution_image_urls', ''),
    NULLIF(t->>'topic', ''),
    NULLIF(t->>'block_id', '')
  FROM jsonb_array_elements(_tasks) AS t;

  UPDATE public.mock_exam_variants v
  SET
    part1_max = COALESCE((
      SELECT SUM(max_score) FROM public.mock_exam_variant_tasks
      WHERE variant_id = _variant_id AND part = 1
    ), 0)::int,
    part2_max = COALESCE((
      SELECT SUM(max_score) FROM public.mock_exam_variant_tasks
      WHERE variant_id = _variant_id AND part = 2
    ), 0)::int,
    total_max_score = (
      SELECT SUM(max_score) FROM public.mock_exam_variant_tasks
      WHERE variant_id = _variant_id
    )::int,
    task_count = (
      SELECT COUNT(*) FROM public.mock_exam_variant_tasks
      WHERE variant_id = _variant_id
    )::int
  WHERE v.id = _variant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mock_exam_variant_replace_tasks(uuid, jsonb, text, text, text, int, text, text, jsonb, jsonb, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mock_exam_variant_replace_tasks(uuid, jsonb, text, text, text, int, text, text, jsonb, jsonb, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mock_exam_variant_replace_tasks(uuid, jsonb, text, text, text, int, text, text, jsonb, jsonb, int) TO service_role;

COMMENT ON FUNCTION public.mock_exam_variant_replace_tasks(uuid, jsonb, text, text, text, int, text, text, jsonb, jsonb, int) IS
  'Атомарное сохранение варианта: CAS по content_revision (VARIANT_STALE) → in-use гард (VARIANT_IN_USE) → мета + блоки → замена задач с block_id (BLOCK_NOT_FOUND fail-closed) → пересчёт тоталов, одной транзакцией. _tasks NULL = только мета. service_role-only.';

-- content_revision — student-safe (нужен редактору репетитора; ученику
-- безвреден). Полный список = контракт того, что видит authenticated.
REVOKE SELECT ON public.mock_exam_variants FROM anon, authenticated;

GRANT SELECT (
  id, title, exam_type, source, source_attribution, duration_minutes,
  total_max_score, part1_max, part2_max, task_count, created_by, created_at,
  variant_pdf_url, owner_id, subject, listening_audio_url, task_blocks_json,
  content_revision
) ON public.mock_exam_variants TO authenticated;

COMMIT;

-- Validation:
-- SELECT count(*) FROM pg_proc WHERE proname = 'mock_exam_variant_replace_tasks';
-- Expected: 1.
--
-- SELECT column_name FROM information_schema.column_privileges
--   WHERE table_name='mock_exam_variants' AND grantee='authenticated' ORDER BY 1;
-- Expected: 18 строк; block_transcripts_json и listening_transcript ОТСУТСТВУЮТ.
