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
  listening_audio_url
) ON public.mock_exam_variants TO authenticated;

COMMENT ON COLUMN public.mock_exam_variants.listening_transcript IS
  'Транскрипт трека аудирования (ручной ввод, v1). ANTI-LEAK (rule 45): = ответы аудирования. Column-GRANT REVOKED от authenticated (20260731190000) — прямой PostgREST не читает НИ ПРИ КАКОМ RLS-row-доступе. Ученик: только post-submit через service_role result-эндпоинт. Репетитор: GET /variants/:id/listening (mock-exam-tutor-api, owner-гейт).';