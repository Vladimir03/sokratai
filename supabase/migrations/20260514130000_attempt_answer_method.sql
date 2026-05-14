-- Mock Exams v1 — Per-attempt answer method choice
-- ----------------------------------------------------------------------
-- Pilot polish Phase 2 (Vladimir feedback 2026-05-14):
-- Choice of "blank vs digital form" moves from tutor (assignment.mode)
-- to student (attempts.answer_method). Tutor.mode остаётся для tutor info
-- + 'manual_entry' flow, но больше НЕ определяет UI ученика.
--
-- Также добавлены 2 photo fields для fallback / bulk uploads (см. spec).
--
-- Idempotent. Backfill from assignment.mode для existing pilot attempts.

BEGIN;

-- ============================================================
-- 1. Per-attempt answer method
-- ============================================================
ALTER TABLE public.mock_exam_attempts
  ADD COLUMN IF NOT EXISTS answer_method TEXT NULL
    CHECK (answer_method IS NULL OR answer_method IN ('blank', 'form'));

COMMENT ON COLUMN public.mock_exam_attempts.answer_method IS
  'Выбор способа ответа для Части 1 (per-attempt, выбирает сам ученик в UI). NULL = ещё не выбрал (modal появится). blank = ФИПИ бланк от руки + фото; form = цифровой ввод inputs. Не путать с assignment.mode (tutor info + manual_entry flow).';

-- ============================================================
-- 2. Fallback Part 1 photo (когда ученик решал не на ФИПИ бланке)
-- ============================================================
ALTER TABLE public.mock_exam_attempts
  ADD COLUMN IF NOT EXISTS part1_blank_photo_url TEXT NULL;

COMMENT ON COLUMN public.mock_exam_attempts.part1_blank_photo_url IS
  'Optional fallback: ученик загрузил фото своих ответов Часть 1 в свободной форме (не на ФИПИ бланке). Single ref storage://mock-exam-blanks/{userId}/{attemptId}/part1-{uuid}.ext. Отдельно от blank_photo_url (=ФИПИ бланк) чтобы tutor мог различить.';

-- ============================================================
-- 3. Bulk Part 2 photos (1 общий пакет вместо per-task)
-- ============================================================
ALTER TABLE public.mock_exam_attempts
  ADD COLUMN IF NOT EXISTS part2_bulk_photo_urls TEXT NULL;

COMMENT ON COLUMN public.mock_exam_attempts.part2_bulk_photo_urls IS
  'Optional bulk upload фото решений Части 2 — single ref OR JSON-array string (dual-format invariant как task_image_url). До 7 фото. Не заменяет per-task `mock_exam_attempt_part2_solutions.photo_url` — tutor видит оба пути в review.';

-- ============================================================
-- 4. Backfill answer_method для existing pilot attempts
-- ============================================================
-- Маппинг: assignment.mode='blank' → 'blank', 'form' → 'form'.
-- manual_entry attempts остаются с answer_method=NULL (tutor-only flow,
-- ученик никогда не видит taking page для manual_entry assignments).
UPDATE public.mock_exam_attempts a
SET answer_method = CASE
  WHEN asg.mode = 'blank' THEN 'blank'
  WHEN asg.mode = 'form' THEN 'form'
  ELSE NULL
END
FROM public.mock_exam_assignments asg
WHERE a.assignment_id = asg.id
  AND a.answer_method IS NULL
  AND asg.mode IN ('blank', 'form');

COMMIT;

-- Validation:
-- SELECT
--   answer_method,
--   COUNT(*) AS attempt_count
-- FROM public.mock_exam_attempts
-- GROUP BY answer_method
-- ORDER BY answer_method;
-- Expected: blank/form rows for backfilled; NULL for new attempts after deploy
-- (until student picks via modal) or for manual_entry assignments.
