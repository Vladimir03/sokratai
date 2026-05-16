-- Mock Exams v1 — RLS hardening для mock_exam_attempt_part1_answers
-- (TASK-16-R3 fix #1, 2026-05-17). ChatGPT-5.5 P0 finding после R2 review.
--
-- Problem:
--   `20260508120000_mock_exams_v1_schema.sql` создал student INSERT/UPDATE
--   policies для in_progress attempts БЕЗ column-level guards. После R2
--   введения `score_source` enum, student через authenticated PostgREST
--   client может писать `earned_score=1, score_source='tutor'` напрямую,
--   bypass'ая edge function autosave.
--
-- Attack vector (blank-mode flow):
--   1. Student authenticated → создал in_progress attempt, answer_method='blank'
--   2. Через JS console: `supabase.from('mock_exam_attempt_part1_answers').insert({
--        attempt_id: '<own>', kim_number: 1, earned_score: 1, score_source: 'tutor'
--      })`. RLS USING/WITH CHECK проходит (own in_progress).
--   3. Student submit'ит → mock-exam-grade runs OCR. R2 fix #1
--      `tutorScoredKims` filter (`score_source='tutor'`) skip'ает этот row.
--      Faked `earned_score=1` остаётся.
--   4. Tutor открывает Part1BlankReviewPanel: видит pre-filled `1` для kim=1.
--      Если tutor не проверит каждую клетку → approve all → faked score
--      принят как валидный.
--
-- Fix: тightened WITH CHECK guards на student policies.
--   - INSERT: student может писать ТОЛЬКО `earned_score IS NULL AND score_source='student_form'`.
--     Это match'ит autosave path в `mock-exam-student-api::handleSavePart1Answer`.
--   - UPDATE: то же самое. Form mode auto-check upserts происходят через service_role
--     (mock-exam-student-api), не через user JWT, поэтому not blocked.
--
-- Server-side write paths (через service_role в edge functions) НЕ затронуты:
--   - `runPart1OCR` (mock-exam-grade) — service_role
--   - `handlePart1ManualScore` (mock-exam-tutor-api) — service_role
--   - `handlePart1Finalize` (mock-exam-tutor-api) — service_role
--   - `handleSubmitAttempt` form-mode auto-check (mock-exam-student-api) — service_role
--
-- P1 #3 mitigation note: `20260516130000_part1_answers_score_source.sql` уже
-- применилась в проде (Lovable Cloud auto-deploy). Тот файл — forward-only
-- safe (не reapply'ется Supabase migration tracker'ом). Эта миграция НЕ
-- трогает existing score_source values — только tightens RLS.

BEGIN;

-- Tighten student INSERT policy: column-level WITH CHECK guards.
DROP POLICY IF EXISTS "Mock part1 student insert own in progress"
  ON public.mock_exam_attempt_part1_answers;

CREATE POLICY "Mock part1 student insert own in progress"
  ON public.mock_exam_attempt_part1_answers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.mock_exam_attempts a
      WHERE a.id = mock_exam_attempt_part1_answers.attempt_id
        AND a.student_id = auth.uid()
        AND a.status = 'in_progress'
    )
    -- Student client может писать только autosave-shape rows.
    AND earned_score IS NULL
    AND score_source = 'student_form'
  );

-- Tighten student UPDATE policy: same column-level WITH CHECK.
-- USING остаётся проверкой ownership (без column guards — иначе невозможно
-- найти existing row для UPDATE). Column guards идут в WITH CHECK.
DROP POLICY IF EXISTS "Mock part1 student update own in progress"
  ON public.mock_exam_attempt_part1_answers;

CREATE POLICY "Mock part1 student update own in progress"
  ON public.mock_exam_attempt_part1_answers
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.mock_exam_attempts a
      WHERE a.id = mock_exam_attempt_part1_answers.attempt_id
        AND a.student_id = auth.uid()
        AND a.status = 'in_progress'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.mock_exam_attempts a
      WHERE a.id = mock_exam_attempt_part1_answers.attempt_id
        AND a.student_id = auth.uid()
        AND a.status = 'in_progress'
    )
    AND earned_score IS NULL
    AND score_source = 'student_form'
  );

COMMIT;

-- Validation:
--   1. Connect via PostgREST as student auth user. Try:
--        INSERT INTO mock_exam_attempt_part1_answers (attempt_id, kim_number, earned_score, score_source)
--        VALUES ('<own_attempt>', 1, 1, 'tutor');
--      Expected: 42501 / RLS rejection.
--   2. Same INSERT с (attempt_id, kim_number, student_answer='42', earned_score=NULL, score_source='student_form')
--      → OK (валидный autosave).
--   3. Service-role writes (через edge functions) — НЕ затронуты, продолжают работать.
