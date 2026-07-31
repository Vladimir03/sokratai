-- Mock Exams — Аудирование: аудиотрек варианта + транскрипт
BEGIN;

ALTER TABLE public.mock_exam_variants
  ADD COLUMN IF NOT EXISTS listening_audio_url TEXT NULL;

ALTER TABLE public.mock_exam_variants
  ADD COLUMN IF NOT EXISTS listening_transcript TEXT NULL;

COMMENT ON COLUMN public.mock_exam_variants.listening_audio_url IS
  'Аудиотрек секции аудирования (storage://mock-exam-listening-audio/{tutorUserId}/...). NULL = вариант без аудирования; UI скрывает плеер. Условие задачи — отдаётся ученику в in_progress (signed URL через service_role edge, rewriteToProxy).';

COMMENT ON COLUMN public.mock_exam_variants.listening_transcript IS
  'Транскрипт аудиотрека (ручной ввод репетитором, v1). ANTI-LEAK (rule 45): это фактически ответы аудирования — НИКОГДА не отдавать ученику до сдачи. Раскрывается ТОЛЬКО post-submit в result-эндпоинте (как solution_text). НЕ добавлять в taking-select mock-exam-student-api и в pre-submit selects mock-exam-public.';

DROP POLICY IF EXISTS "Mock listening audio tutor upload own" ON storage.objects;
CREATE POLICY "Mock listening audio tutor upload own"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'mock-exam-listening-audio'
    AND owner = auth.uid()
    AND public.is_tutor(auth.uid())
    AND COALESCE(array_length(storage.foldername(name), 1), 0) >= 1
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Mock listening audio tutor read own" ON storage.objects;
CREATE POLICY "Mock listening audio tutor read own"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'mock-exam-listening-audio'
    AND COALESCE(array_length(storage.foldername(name), 1), 0) >= 1
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Mock listening audio tutor delete own" ON storage.objects;
CREATE POLICY "Mock listening audio tutor delete own"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'mock-exam-listening-audio'
    AND COALESCE(array_length(storage.foldername(name), 1), 0) >= 1
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP FUNCTION IF EXISTS public.mock_exam_variant_replace_tasks(uuid, jsonb, text, text, text, int);

CREATE OR REPLACE FUNCTION public.mock_exam_variant_replace_tasks(
  _variant_id uuid,
  _tasks jsonb,
  _title text DEFAULT NULL,
  _subject text DEFAULT NULL,
  _exam_type text DEFAULT NULL,
  _duration_minutes int DEFAULT NULL,
  _listening_audio_url text DEFAULT NULL,
  _listening_transcript text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF _tasks IS NOT NULL
     AND (jsonb_typeof(_tasks) <> 'array' OR jsonb_array_length(_tasks) = 0) THEN
    RAISE EXCEPTION 'TASKS_REQUIRED';
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
    END
  WHERE id = _variant_id;

  IF _tasks IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.mock_exam_variant_tasks WHERE variant_id = _variant_id;

  INSERT INTO public.mock_exam_variant_tasks (
    variant_id, kim_number, part, order_num, task_text, task_image_url,
    correct_answer, check_mode, max_score, solution_text, solution_image_urls, topic
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
    NULLIF(t->>'topic', '')
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

REVOKE ALL ON FUNCTION public.mock_exam_variant_replace_tasks(uuid, jsonb, text, text, text, int, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mock_exam_variant_replace_tasks(uuid, jsonb, text, text, text, int, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mock_exam_variant_replace_tasks(uuid, jsonb, text, text, text, int, text, text) TO service_role;

COMMENT ON FUNCTION public.mock_exam_variant_replace_tasks(uuid, jsonb, text, text, text, int, text, text) IS
  'Атомарное сохранение контента варианта (2026-07-20) + listening-мета (2026-07-31): FOR UPDATE + in-use гард (VARIANT_IN_USE) + мета (NULL = не менять, '''' = очистить listening-поля) + замена задач + пересчёт тоталов одной транзакцией. _tasks NULL = только мета. service_role-only (edge mock-exam-tutor-api).';

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
    listening_audio_url, listening_transcript
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
    NULLIF(_meta->>'listening_transcript', '')
  ) RETURNING id INTO v_id;

  PERFORM public.mock_exam_variant_replace_tasks(v_id, _tasks);
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mock_exam_variant_create_with_tasks(jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mock_exam_variant_create_with_tasks(jsonb, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mock_exam_variant_create_with_tasks(jsonb, jsonb) TO service_role;

COMMENT ON FUNCTION public.mock_exam_variant_create_with_tasks(jsonb, jsonb) IS
  'Создание/дублирование варианта одной транзакцией (мета + задачи + тоталы). 2026-07-31: + listening_audio_url/listening_transcript в _meta. service_role-only (edge POST /variants и /variants/:id/duplicate).';

COMMIT;