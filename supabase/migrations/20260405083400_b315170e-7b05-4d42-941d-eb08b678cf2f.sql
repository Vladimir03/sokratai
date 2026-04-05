
-- Formula rounds tables for formula drill feature
CREATE TABLE public.formula_rounds (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  assignment_id UUID NOT NULL REFERENCES public.homework_tutor_assignments(id) ON DELETE CASCADE,
  section TEXT NOT NULL DEFAULT 'kinematics',
  formula_count INTEGER NOT NULL DEFAULT 12,
  questions_per_round INTEGER NOT NULL DEFAULT 10,
  lives INTEGER NOT NULL DEFAULT 3,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE public.formula_round_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  round_id UUID NOT NULL REFERENCES public.formula_rounds(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  lives_remaining INTEGER NOT NULL DEFAULT 0,
  completed BOOLEAN NOT NULL DEFAULT false,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  answers JSONB NOT NULL DEFAULT '[]'::jsonb,
  weak_formulas JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.formula_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.formula_round_results ENABLE ROW LEVEL SECURITY;

-- formula_rounds: students assigned to the homework can read
CREATE POLICY "Students can read rounds for their assignments"
  ON public.formula_rounds FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.homework_tutor_student_assignments htsa
      WHERE htsa.assignment_id = formula_rounds.assignment_id
        AND htsa.student_id = auth.uid()
    )
  );

-- formula_rounds: tutors who own the assignment can manage
CREATE POLICY "Tutors can manage their rounds"
  ON public.formula_rounds FOR ALL TO authenticated
  USING (is_assignment_tutor(assignment_id))
  WITH CHECK (is_assignment_tutor(assignment_id));

-- formula_round_results: students can insert/read their own results
CREATE POLICY "Students can insert own results"
  ON public.formula_round_results FOR INSERT TO authenticated
  WITH CHECK (student_id = auth.uid());

CREATE POLICY "Students can read own results"
  ON public.formula_round_results FOR SELECT TO authenticated
  USING (student_id = auth.uid());

-- formula_round_results: tutors can read results for their assignments
CREATE POLICY "Tutors can read results for their assignments"
  ON public.formula_round_results FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.formula_rounds fr
      WHERE fr.id = formula_round_results.round_id
        AND is_assignment_tutor(fr.assignment_id)
    )
  );
