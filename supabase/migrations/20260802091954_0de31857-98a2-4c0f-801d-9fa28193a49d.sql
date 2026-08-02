DO $$
DECLARE v uuid;
BEGIN
  v := public.mock_exam_variant_create_with_tasks(
    '{"title":"__probe_blocks__","exam_type":"ege","duration_minutes":60,
      "created_by":"e8dede6a-727a-4254-bdb8-ce0195042a5b",
      "owner_id":"e8dede6a-727a-4254-bdb8-ce0195042a5b","subject":"french",
      "task_blocks_json":[{"id":"b1","title":"проба","instruction":"","image_url":null,"audio_url":null}]}'::jsonb,
    '[{"kim_number":1,"part":1,"order_num":1,"task_text":"проба","check_mode":"strict",
       "correct_answer":"1","max_score":1,"block_id":"b1"}]'::jsonb);
  RAISE NOTICE 'PROBE_OK variant_id=%', v;
  DELETE FROM public.mock_exam_variants WHERE id = v;
END $$;