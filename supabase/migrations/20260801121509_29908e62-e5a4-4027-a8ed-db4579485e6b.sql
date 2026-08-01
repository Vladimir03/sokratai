REVOKE SELECT ON public.mock_exam_variants FROM anon, authenticated;

GRANT SELECT (
  id,
  title,
  exam_type,
  source,
  source_attribution,
  duration_minutes,
  total_max_score,
  part1_max,
  part2_max,
  task_count,
  created_by,
  created_at,
  variant_pdf_url,
  owner_id,
  subject,
  listening_audio_url,
  task_blocks_json
) ON public.mock_exam_variants TO authenticated;