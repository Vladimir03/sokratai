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