-- Phase 1a: formula rounds schema
-- Adds student-facing round config + persisted round results inside homework flow.

CREATE TABLE IF NOT EXISTS public.formula_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.homework_tutor_assignments(id) ON DELETE CASCADE,
  section text NOT NULL DEFAULT 'kinematics',
  formula_count int NOT NULL DEFAULT 12,
  questions_per_round int NOT NULL DEFAULT 10,
  lives int NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT formula_rounds_assignment_unique UNIQUE (assignment_id)
);

CREATE TABLE IF NOT EXISTS public.formula_round_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES public.formula_rounds(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES auth.users(id),
  score int NOT NULL,
  total int NOT NULL DEFAULT 10,
  lives_remaining int NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  duration_seconds int,
  answers jsonb NOT NULL,
  weak_formulas jsonb,
  played_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT formula_round_results_round_student_played_unique UNIQUE (round_id, student_id, played_at)
);

CREATE INDEX IF NOT EXISTS idx_formula_round_results_round_student
  ON public.formula_round_results(round_id, student_id);

ALTER TABLE public.formula_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.formula_round_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "student_read_rounds" ON public.formula_rounds
  FOR SELECT
  USING (
    assignment_id IN (
      SELECT sa.assignment_id
      FROM public.homework_tutor_student_assignments sa
      WHERE sa.student_id = auth.uid()
    )
  );

CREATE POLICY "student_insert_results" ON public.formula_round_results
  FOR INSERT
  WITH CHECK (
    student_id = auth.uid()
    AND round_id IN (
      SELECT fr.id
      FROM public.formula_rounds fr
      JOIN public.homework_tutor_student_assignments sa ON sa.assignment_id = fr.assignment_id
      WHERE sa.student_id = auth.uid()
    )
  );

CREATE POLICY "student_read_results" ON public.formula_round_results
  FOR SELECT
  USING (
    student_id = auth.uid()
    AND round_id IN (
      SELECT fr.id
      FROM public.formula_rounds fr
      JOIN public.homework_tutor_student_assignments sa ON sa.assignment_id = fr.assignment_id
      WHERE sa.student_id = auth.uid()
    )
  );

CREATE POLICY "tutor_read_results" ON public.formula_round_results
  FOR SELECT
  USING (
    round_id IN (
      SELECT fr.id
      FROM public.formula_rounds fr
      JOIN public.homework_tutor_assignments hta ON hta.id = fr.assignment_id
      WHERE hta.tutor_id = auth.uid()
    )
  );
