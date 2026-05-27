-- AC-P11 / AC-P9 auto-migration (2026-05-26): backfill partial credit для existing
-- pilot attempts которые были submitted ДО AC-P9 commit `2f76adf` (2026-05-25).
--
-- ROOT CAUSE: ChatGPT-5.5 code review корректно идентифицировал что
-- `handleRecheckPart1` skip'ит `score_source='tutor'` rows. Но Володя UX choice
-- ранее (Q2) был «preserve existing pilot data + tutor манально нажимает кнопку».
-- ПОСЛЕ feedback от Егора 2026-05-26 (binary 0/2 для очевидно partial answers)
-- — Володя сменил позицию: «зачем кнопка, можно сразу применить критерии».
--
-- Этот migration script пересчитывает все existing attempts с partial credit
-- логикой ФИПИ 2026 для multi_choice (KIM 5/9/14/18) и ordered (KIM 6/10/15/17).
-- Mirror TS `gradeMultiChoice` / `gradeOrdered` из `src/lib/mockExamPart1Checker.ts`.
--
-- Hard invariants:
-- 1. Idempotent — re-apply на already-recomputed rows даст identical result.
-- 2. `score_source='tutor'` preservation — НЕ перезаписываем manual tutor edits.
-- 3. Только Часть 1 KIM с check_mode IN ('multi_choice', 'ordered').
-- 4. attempts со status='manually_entered' — НЕ трогаем (нет per-task data).
--
-- Implementation: temporary functions в public schema + DROP в конце (pg_temp
-- не reliable в Supabase migration runner). Functions имеют `_ac_p11_` prefix
-- для clear identity.

-- ─── Temp helper functions (will be dropped at end) ─────────────────────────

CREATE OR REPLACE FUNCTION public._ac_p11_grade_multi_choice(
  p_correct TEXT,
  p_student TEXT,
  p_max_score INT
) RETURNS INT AS $$
DECLARE
  v_correct_clean TEXT;
  v_student_clean TEXT;
  v_correct_chars TEXT[];
  v_student_chars TEXT[];
  v_correct_set TEXT[];
  v_student_set TEXT[];
  v_matches INT := 0;
  v_errors INT;
  ch TEXT;
BEGIN
  IF p_correct IS NULL OR p_student IS NULL THEN RETURN 0; END IF;
  IF p_max_score < 2 THEN
    v_correct_clean := lower(regexp_replace(p_correct, '\s+', '', 'g'));
    v_student_clean := lower(regexp_replace(p_student, '\s+', '', 'g'));
    IF v_correct_clean = v_student_clean THEN RETURN p_max_score; END IF;
    RETURN 0;
  END IF;

  v_correct_clean := lower(regexp_replace(p_correct, '[\s,;]+', '', 'g'));
  v_student_clean := lower(regexp_replace(p_student, '[\s,;]+', '', 'g'));

  IF length(v_correct_clean) = 0 OR length(v_student_clean) = 0 THEN
    RETURN 0;
  END IF;

  v_correct_chars := regexp_split_to_array(v_correct_clean, '');
  v_student_chars := regexp_split_to_array(v_student_clean, '');

  SELECT array_agg(DISTINCT c) INTO v_correct_set FROM unnest(v_correct_chars) AS c;
  SELECT array_agg(DISTINCT c) INTO v_student_set FROM unnest(v_student_chars) AS c;

  IF array_length(v_correct_set, 1) IS NULL OR array_length(v_student_set, 1) IS NULL THEN
    RETURN 0;
  END IF;

  FOREACH ch IN ARRAY v_student_set LOOP
    IF ch = ANY(v_correct_set) THEN v_matches := v_matches + 1; END IF;
  END LOOP;

  v_errors := GREATEST(array_length(v_correct_set, 1), array_length(v_student_set, 1)) - v_matches;

  IF v_errors = 0 THEN RETURN p_max_score; END IF;
  IF v_errors = 1 THEN RETURN 1; END IF;
  RETURN 0;
END $$ LANGUAGE plpgsql IMMUTABLE;


CREATE OR REPLACE FUNCTION public._ac_p11_grade_ordered(
  p_correct TEXT,
  p_student TEXT,
  p_max_score INT
) RETURNS INT AS $$
DECLARE
  v_correct_clean TEXT;
  v_student_clean TEXT;
  v_errors INT := 0;
  i INT;
BEGIN
  IF p_correct IS NULL OR p_student IS NULL THEN RETURN 0; END IF;

  v_correct_clean := lower(regexp_replace(p_correct, '[\s,;]+', '', 'g'));
  v_student_clean := lower(regexp_replace(p_student, '[\s,;]+', '', 'g'));

  IF length(v_correct_clean) = 0 OR length(v_student_clean) = 0 THEN
    RETURN 0;
  END IF;

  IF length(v_correct_clean) <> length(v_student_clean) THEN
    RETURN 0;
  END IF;

  FOR i IN 1..length(v_correct_clean) LOOP
    IF substring(v_correct_clean FROM i FOR 1) <> substring(v_student_clean FROM i FOR 1) THEN
      v_errors := v_errors + 1;
    END IF;
  END LOOP;

  IF v_errors = 0 THEN RETURN p_max_score; END IF;
  IF v_errors = 1 AND p_max_score >= 2 THEN RETURN 1; END IF;
  RETURN 0;
END $$ LANGUAGE plpgsql IMMUTABLE;


-- ─── Backfill UPDATE + recompute totals ─────────────────────────────────────

DO $$
DECLARE
  v_updated_count INT;
  v_recomputed_attempts INT;
BEGIN
  -- Step 1: re-grade eligible rows только если new_score != old_score
  WITH eligible AS (
    SELECT
      ans.attempt_id,
      ans.kim_number,
      ans.earned_score AS old_score,
      CASE
        WHEN tasks.check_mode = 'multi_choice'
          THEN public._ac_p11_grade_multi_choice(tasks.correct_answer, ans.student_answer, tasks.max_score)
        WHEN tasks.check_mode = 'ordered'
          THEN public._ac_p11_grade_ordered(tasks.correct_answer, ans.student_answer, tasks.max_score)
        ELSE ans.earned_score
      END AS new_score
    FROM public.mock_exam_attempt_part1_answers ans
    JOIN public.mock_exam_attempts att ON att.id = ans.attempt_id
    JOIN public.mock_exam_assignments assn ON assn.id = att.assignment_id
    JOIN public.mock_exam_variant_tasks tasks
      ON tasks.variant_id = assn.variant_id
      AND tasks.kim_number = ans.kim_number
      AND tasks.part = 1
    WHERE
      ans.score_source IN ('student_form', 'ocr', 'finalize_default')
      AND tasks.check_mode IN ('multi_choice', 'ordered')
      AND ans.student_answer IS NOT NULL
      AND att.status <> 'manually_entered'
  )
  UPDATE public.mock_exam_attempt_part1_answers ans
  SET earned_score = eligible.new_score,
      updated_at = now()
  FROM eligible
  WHERE ans.attempt_id = eligible.attempt_id
    AND ans.kim_number = eligible.kim_number
    AND eligible.new_score IS DISTINCT FROM eligible.old_score;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  -- Step 2: recompute total_part1_score для всех затронутых attempts
  WITH affected_attempts AS (
    SELECT DISTINCT ans.attempt_id
    FROM public.mock_exam_attempt_part1_answers ans
    JOIN public.mock_exam_attempts att ON att.id = ans.attempt_id
    JOIN public.mock_exam_assignments assn ON assn.id = att.assignment_id
    JOIN public.mock_exam_variant_tasks tasks
      ON tasks.variant_id = assn.variant_id
      AND tasks.kim_number = ans.kim_number
      AND tasks.part = 1
    WHERE
      tasks.check_mode IN ('multi_choice', 'ordered')
      AND ans.score_source IN ('student_form', 'ocr', 'finalize_default')
      AND att.status <> 'manually_entered'
  ),
  totals AS (
    SELECT
      ans.attempt_id,
      COALESCE(SUM(ans.earned_score), 0)::INT AS total
    FROM public.mock_exam_attempt_part1_answers ans
    WHERE ans.attempt_id IN (SELECT attempt_id FROM affected_attempts)
    GROUP BY ans.attempt_id
  )
  UPDATE public.mock_exam_attempts att
  SET total_part1_score = totals.total
  FROM totals
  WHERE att.id = totals.attempt_id
    AND att.total_part1_score IS DISTINCT FROM totals.total;

  GET DIAGNOSTICS v_recomputed_attempts = ROW_COUNT;

  RAISE NOTICE 'AC-P11 backfill complete: % rows re-graded, % attempts total_part1_score recomputed',
    v_updated_count, v_recomputed_attempts;
END $$;


-- ─── Cleanup: drop helper functions ─────────────────────────────────────────

DROP FUNCTION IF EXISTS public._ac_p11_grade_multi_choice(TEXT, TEXT, INT);
DROP FUNCTION IF EXISTS public._ac_p11_grade_ordered(TEXT, TEXT, INT);
