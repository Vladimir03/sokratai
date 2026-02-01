-- Создать таблицу для учёта оплат репетитору
CREATE TABLE public.tutor_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_student_id UUID NOT NULL REFERENCES public.tutor_students(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  period TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue')),
  due_date DATE,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Включить RLS
ALTER TABLE public.tutor_payments ENABLE ROW LEVEL SECURITY;

-- RLS-политики (только репетитор-владелец может управлять оплатами своих учеников)
CREATE POLICY "Tutors can view own student payments"
  ON public.tutor_payments FOR SELECT
  USING (owns_tutor_student(tutor_student_id));

CREATE POLICY "Tutors can insert payments for own students"
  ON public.tutor_payments FOR INSERT
  WITH CHECK (owns_tutor_student(tutor_student_id));

CREATE POLICY "Tutors can update own student payments"
  ON public.tutor_payments FOR UPDATE
  USING (owns_tutor_student(tutor_student_id));

CREATE POLICY "Tutors can delete own student payments"
  ON public.tutor_payments FOR DELETE
  USING (owns_tutor_student(tutor_student_id));

-- Триггер для обновления updated_at
CREATE TRIGGER update_tutor_payments_updated_at
  BEFORE UPDATE ON public.tutor_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();