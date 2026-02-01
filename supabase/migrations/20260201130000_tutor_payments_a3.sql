-- =============================================
-- MVP #2: Учёт оплат (A3)
-- Таблица оплат учеников репетитору
-- =============================================

-- 1. Создание таблицы tutor_payments
CREATE TABLE IF NOT EXISTS public.tutor_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_student_id UUID NOT NULL REFERENCES public.tutor_students(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  period TEXT, -- "Январь 2026" или "8 уроков"
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue')),
  due_date DATE,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Комментарии
COMMENT ON TABLE public.tutor_payments IS 'Оплаты учеников репетитору (ручной учёт)';
COMMENT ON COLUMN public.tutor_payments.tutor_student_id IS 'Связь с записью tutor_students';
COMMENT ON COLUMN public.tutor_payments.amount IS 'Сумма оплаты в рублях';
COMMENT ON COLUMN public.tutor_payments.period IS 'Период оплаты (месяц или количество уроков)';
COMMENT ON COLUMN public.tutor_payments.status IS 'Статус: pending/paid/overdue';
COMMENT ON COLUMN public.tutor_payments.due_date IS 'Срок оплаты';
COMMENT ON COLUMN public.tutor_payments.paid_at IS 'Дата фактической оплаты';

-- 2. Индексы
CREATE INDEX IF NOT EXISTS idx_tutor_payments_tutor_student_id 
  ON public.tutor_payments(tutor_student_id);
CREATE INDEX IF NOT EXISTS idx_tutor_payments_status_due_date 
  ON public.tutor_payments(status, due_date);
CREATE INDEX IF NOT EXISTS idx_tutor_payments_paid_at 
  ON public.tutor_payments(paid_at);

-- 3. Триггер updated_at
DROP TRIGGER IF EXISTS update_tutor_payments_updated_at ON public.tutor_payments;
CREATE TRIGGER update_tutor_payments_updated_at
  BEFORE UPDATE ON public.tutor_payments
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- 4. RLS
ALTER TABLE public.tutor_payments ENABLE ROW LEVEL SECURITY;

-- Используем функцию owns_tutor_student (добавлена в C1)
CREATE POLICY "Tutors can view own student payments"
  ON public.tutor_payments FOR SELECT
  USING (public.owns_tutor_student(tutor_student_id));

CREATE POLICY "Tutors can insert payments for own students"
  ON public.tutor_payments FOR INSERT
  WITH CHECK (public.owns_tutor_student(tutor_student_id));

CREATE POLICY "Tutors can update own student payments"
  ON public.tutor_payments FOR UPDATE
  USING (public.owns_tutor_student(tutor_student_id));

CREATE POLICY "Tutors can delete own student payments"
  ON public.tutor_payments FOR DELETE
  USING (public.owns_tutor_student(tutor_student_id));

-- 5. Гранты
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tutor_payments TO authenticated;
