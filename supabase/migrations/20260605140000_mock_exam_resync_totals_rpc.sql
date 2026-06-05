-- 2026-06-05 (ChatGPT-5.5 review P1): atomic totals resync for mock-exam attempts.
--
-- ROOT CAUSE: post-approval score editing (item 4) resynced `total_score` via a
-- JS read-sum-update (read child scores in JS → sum → UPDATE). Two racing edits
-- (two Part 2 edits, or Part 1 racing Part 2) each compute from a stale snapshot;
-- the last writer can persist a stale stored total. `total_score` is stored and
-- shown to the student → visible drift (same class as the 2026-06-01 bug).
--
-- FIX: a single atomic UPDATE that recomputes BOTH parts from the child tables.
-- Under READ COMMITTED each statement sees committed child rows at execution, and
-- every score-write is immediately followed by a resync call → the last resync to
-- run reads all committed scores → last-writer-correct. No stale JS snapshot.
--
-- Semantics (preserve existing behaviour):
--   - total_part1_score: ALWAYS recomputed = SUM(earned_score) (для «сохранено»
--     дисплея + post-approval). Pre-approval это и так делалось.
--   - total_part2_score / total_score: recomputed ONLY when the attempt is already
--     finalized (total_score IS NOT NULL, т.е. approved). Pre-approval остаются
--     null до approve-all (как раньше).
--   - manually_entered attempts: per-task handlers 409'ят их → RPC не вызывается;
--     их tutor-entered totals не трогаются.
--
-- Called by handleApproveTask / handlePart1ManualScore / handlePart1Finalize /
-- handleRecheckPart1 (service_role) after each child-score write.

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

-- Only the edge functions (service_role) may call this — not authenticated users.
REVOKE ALL ON FUNCTION public.mock_exam_resync_attempt_totals(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mock_exam_resync_attempt_totals(uuid) TO service_role;

COMMENT ON FUNCTION public.mock_exam_resync_attempt_totals(uuid) IS
  '2026-06-05 (review P1): atomic recompute of total_part1_score (always) + total_part2_score/total_score (only when finalized) from child tables. Eliminates total_score drift under concurrent post-approval score edits. Call after every per-task score write (service_role only).';
