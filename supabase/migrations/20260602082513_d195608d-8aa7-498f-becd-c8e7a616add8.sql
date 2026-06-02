UPDATE public.mock_exam_attempts
SET total_score = COALESCE(total_part1_score, 0) + COALESCE(total_part2_score, 0)
WHERE status = 'approved'
  AND total_score IS DISTINCT FROM
      (COALESCE(total_part1_score, 0) + COALESCE(total_part2_score, 0));