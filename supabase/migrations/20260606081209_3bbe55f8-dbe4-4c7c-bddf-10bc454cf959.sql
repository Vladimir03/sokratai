-- 20260605120000: solution_image_urls column
ALTER TABLE public.mock_exam_variant_tasks
  ADD COLUMN IF NOT EXISTS solution_image_urls TEXT NULL;

COMMENT ON COLUMN public.mock_exam_variant_tasks.solution_image_urls IS
  '2026-06-05 (item 5): фото эталонного решения Часть 2. Dual-format TEXT: single "storage://..." ref ИЛИ JSON-array. Видно тутору + ученику (post-submit, mock-exam — НЕ как homework). Read via parseAttachmentUrls.';

-- 20260605130000: bind KIM 25/26 to reference photos
UPDATE public.mock_exam_variant_tasks
SET solution_image_urls =
  '["storage://mock-exam-variant-tasks/variant1/solution-25-1.png","storage://mock-exam-variant-tasks/variant1/solution-25-2.png"]'
WHERE id = 'e9fd88a9-0969-5419-a9c5-012e506682e2'::uuid;

UPDATE public.mock_exam_variant_tasks
SET solution_image_urls =
  'storage://mock-exam-variant-tasks/variant1/solution-26-1.png'
WHERE id = '6f2508b7-6902-567c-9b0f-2afe0b0ea796'::uuid;

-- 20260605140000: atomic totals resync RPC
CREATE OR REPLACE FUNCTION public.mock_exam_resync_attempt_totals(_attempt_id uuid)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.mock_exam_attempts a
  SET
    total_part1_score = COALESCE((
      SELECT SUM(earned_score)
      FROM public.mock_exam_attempt_part1_answers
      WHERE attempt_id = _attempt_id
    ), 0)::int,
    total_part2_score = CASE
      WHEN a.total_score IS NULL THEN a.total_part2_score
      ELSE COALESCE((
        SELECT SUM(tutor_score)
        FROM public.mock_exam_attempt_part2_solutions
        WHERE attempt_id = _attempt_id
      ), 0)::int
    END,
    total_score = CASE
      WHEN a.total_score IS NULL THEN NULL
      ELSE (
        COALESCE((
          SELECT SUM(earned_score)
          FROM public.mock_exam_attempt_part1_answers
          WHERE attempt_id = _attempt_id
        ), 0)
        + COALESCE((
          SELECT SUM(tutor_score)
          FROM public.mock_exam_attempt_part2_solutions
          WHERE attempt_id = _attempt_id
        ), 0)
      )::int
    END
  WHERE a.id = _attempt_id;
$$;

REVOKE ALL ON FUNCTION public.mock_exam_resync_attempt_totals(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mock_exam_resync_attempt_totals(uuid) TO service_role;

COMMENT ON FUNCTION public.mock_exam_resync_attempt_totals(uuid) IS
  '2026-06-05 (review P1): atomic recompute of total_part1_score (always) + total_part2_score/total_score (only when finalized) from child tables.';

NOTIFY pgrst, 'reload schema';