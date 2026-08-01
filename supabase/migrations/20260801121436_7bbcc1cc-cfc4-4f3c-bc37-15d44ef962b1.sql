-- Mock Exams — «Блоки заданий» (общий материал + N вопросов)
BEGIN;

ALTER TABLE public.mock_exam_variants
  ADD COLUMN IF NOT EXISTS task_blocks_json jsonb,
  ADD COLUMN IF NOT EXISTS block_transcripts_json jsonb;

ALTER TABLE public.mock_exam_variant_tasks
  ADD COLUMN IF NOT EXISTS block_id text;

COMMENT ON COLUMN public.mock_exam_variants.task_blocks_json IS
  'Блоки заданий: [{id,title,instruction,image_url,audio_url}]. STUDENT-SAFE (условие). Аудио — storage:// ref в mock-exam-listening-audio, подписывается service_role edge. Единственный write-path — RPC mock_exam_variant_{create_with,replace}_tasks через mock-exam-tutor-api.';

COMMENT ON COLUMN public.mock_exam_variants.block_transcripts_json IS
  'Транскрипты треков по blockId: {"<id>":"<текст>"}. ANTI-LEAK (rule 45): = ответы аудирования, leak-класс solution_text. Column-GRANT НЕ выдан authenticated (20260801100100) — прямой PostgREST не читает ни при каком RLS-row-доступе. Ученик: только post-submit через service_role result-эндпоинт. Репетитор: GET /variants/:id/listening (owner-гейт).';

COMMENT ON COLUMN public.mock_exam_variant_tasks.block_id IS
  'Ссылка на элемент mock_exam_variants.task_blocks_json[].id. NULL = задача вне блока. Целостность обеспечивает RPC (RAISE BLOCK_NOT_FOUND) — FK на элемент JSONB невозможен.';

CREATE INDEX IF NOT EXISTS idx_mock_exam_variant_tasks_block
  ON public.mock_exam_variant_tasks (variant_id, block_id)
  WHERE block_id IS NOT NULL;

UPDATE public.mock_exam_variants
SET
  task_blocks_json = jsonb_build_array(
    jsonb_build_object(
      'id', 'legacy',
      'title', 'Аудирование',
      'instruction', '',
      'image_url', NULL,
      'audio_url', listening_audio_url
    )
  ),
  block_transcripts_json = CASE
    WHEN listening_transcript IS NOT NULL
      THEN jsonb_build_object('legacy', listening_transcript)
    ELSE NULL
  END
WHERE task_blocks_json IS NULL
  AND (listening_audio_url IS NOT NULL OR listening_transcript IS NOT NULL);

DROP FUNCTION IF EXISTS public.mock_exam_variant_replace_tasks(uuid, jsonb, text, text, text, int);
DROP FUNCTION IF EXISTS public.mock_exam_variant_replace_tasks(uuid, jsonb, text, text, text, int, text, text);

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
  _block_transcripts jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_blocks jsonb;
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

  PERFORM 1 FROM public.mock_exam_variants WHERE id = _variant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VARIANT_NOT_FOUND';
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
    listening_audio_url = CASE
      WHEN _listening_audio_url IS NULL THEN listening_audio_url
      ELSE NULLIF(_listening_audio_url, '')
    END,
    listening_transcript = CASE
      WHEN _listening_transcript IS NULL THEN listening_transcript
      ELSE NULLIF(_listening_transcript, '')
    END,
    task_blocks_json = CASE
      WHEN _task_blocks IS NULL THEN task_blocks_json
      WHEN jsonb_array_length(_task_blocks) = 0 THEN NULL
      ELSE _task_blocks
    END,
    block_transcripts_json = CASE
      WHEN _block_transcripts IS NULL THEN block_transcripts_json
      WHEN _block_transcripts = '{}'::jsonb THEN NULL
      ELSE _block_transcripts
    END
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

REVOKE ALL ON FUNCTION public.mock_exam_variant_replace_tasks(uuid, jsonb, text, text, text, int, text, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mock_exam_variant_replace_tasks(uuid, jsonb, text, text, text, int, text, text, jsonb, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mock_exam_variant_replace_tasks(uuid, jsonb, text, text, text, int, text, text, jsonb, jsonb) TO service_role;

COMMENT ON FUNCTION public.mock_exam_variant_replace_tasks(uuid, jsonb, text, text, text, int, text, text, jsonb, jsonb) IS
  'Атомарное сохранение контента варианта: FOR UPDATE + in-use гард (VARIANT_IN_USE) + мета + БЛОКИ (2026-08-01; NULL = не менять, []/{} = очистить) + замена задач с block_id + пересчёт тоталов одной транзакцией. Задача со ссылкой на несуществующий блок → BLOCK_NOT_FOUND (fail-closed). _tasks NULL = только мета (осиротевшие привязки гасятся). service_role-only (edge mock-exam-tutor-api).';

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
  ) RETURNING id INTO v_id;

  PERFORM public.mock_exam_variant_replace_tasks(v_id, _tasks);
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mock_exam_variant_create_with_tasks(jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mock_exam_variant_create_with_tasks(jsonb, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mock_exam_variant_create_with_tasks(jsonb, jsonb) TO service_role;

COMMENT ON FUNCTION public.mock_exam_variant_create_with_tasks(jsonb, jsonb) IS
  'Создание/дублирование варианта одной транзакцией (мета + блоки + задачи + тоталы). 2026-08-01: + task_blocks_json/block_transcripts_json в _meta. service_role-only (edge POST /variants и /variants/:id/duplicate).';

COMMIT;