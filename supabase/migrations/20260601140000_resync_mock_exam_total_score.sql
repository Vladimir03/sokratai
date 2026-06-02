-- Bug fix (2026-06-01): resync drifted mock_exam_attempts.total_score.
--
-- ROOT CAUSE: `total_score` is a STORED column (heatmap MockExamHeatmap.tsx +
-- student result API read it directly, no recompute). Three handlers in
-- mock-exam-tutor-api updated `total_part1_score` WITHOUT resyncing
-- `total_score` — the critical one is `handleRecheckPart1`, which explicitly
-- allows `approved` attempts so a tutor can re-grade old binary-scored pilots
-- with the new ФИПИ-2026 partial-credit button «Применить критерии ФИПИ».
--
-- Symptom (Вадим/Елена pilot screenshot): student row showed
--   ЧАСТЬ 1 = 19/28, ЧАСТЬ 2 = 2/17, but ИТОГО = 19/45 (should be 21).
-- Timeline: approve-all wrote a consistent (17, 2, 19); recheck raised part1
-- 17→19 via partial credit but left total_score=19 → (19, 2, 19).
--
-- The forward path is fixed in mock-exam-tutor-api (resync total_score at all
-- three part1 write-sites). This migration backfills already-drifted rows.
--
-- Invariant restored: total_score (when non-null) = part1 + part2.
--
-- Scope: ONLY status='approved'. Excludes:
--   - 'manually_entered' (total_score is a tutor-entered value, parts are NULL —
--      must NOT be overwritten).
--   - pre-approval statuses (total_score is legitimately NULL there).
-- Idempotent: re-running matches 0 rows (IS DISTINCT FROM guard).

UPDATE public.mock_exam_attempts
SET total_score = COALESCE(total_part1_score, 0) + COALESCE(total_part2_score, 0)
WHERE status = 'approved'
  AND total_score IS DISTINCT FROM
      (COALESCE(total_part1_score, 0) + COALESCE(total_part2_score, 0));
