-- =============================================
-- MVP #1: Профиль ученика (C1)
-- Расширение таблицы tutor_students + таблица пробников
-- =============================================

-- 1. Добавить поля C1 в tutor_students
ALTER TABLE public.tutor_students
ADD COLUMN IF NOT EXISTS parent_contact TEXT,
ADD COLUMN IF NOT EXISTS last_lesson_at DATE;

-- Комментарии к колонкам
COMMENT ON COLUMN public.tutor_students.parent_contact IS 'Контакт родителя (телефон или Telegram)';
COMMENT ON COLUMN public.tutor_students.last_lesson_at IS 'Дата последнего занятия';

-- =============================================
-- 2. Таблица пробников (mock exams)
-- =============================================
CREATE TABLE IF NOT EXISTS public.tutor_student_mock_exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_student_id UUID NOT NULL REFERENCES public.tutor_students(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 0),
  max_score INTEGER CHECK (max_score >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы для пробников
CREATE INDEX IF NOT EXISTS idx_mock_exams_tutor_student_id 
  ON public.tutor_student_mock_exams(tutor_student_id);
CREATE INDEX IF NOT EXISTS idx_mock_exams_date 
  ON public.tutor_student_mock_exams(date DESC);

-- Триггер updated_at
DROP TRIGGER IF EXISTS update_mock_exams_updated_at ON public.tutor_student_mock_exams;
CREATE TRIGGER update_mock_exams_updated_at
  BEFORE UPDATE ON public.tutor_student_mock_exams
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- =============================================
-- 3. RLS для tutor_student_mock_exams
-- =============================================
ALTER TABLE public.tutor_student_mock_exams ENABLE ROW LEVEL SECURITY;

-- Вспомогательная функция для проверки владения tutor_student записью
CREATE OR REPLACE FUNCTION public.owns_tutor_student(_tutor_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tutor_students ts
    JOIN public.tutors t ON t.id = ts.tutor_id
    WHERE ts.id = _tutor_student_id
    AND t.user_id = auth.uid()
  )
$$;

-- Политики для пробников
CREATE POLICY "Tutors can view own student mock exams"
  ON public.tutor_student_mock_exams FOR SELECT
  USING (public.owns_tutor_student(tutor_student_id));

CREATE POLICY "Tutors can insert mock exams for own students"
  ON public.tutor_student_mock_exams FOR INSERT
  WITH CHECK (public.owns_tutor_student(tutor_student_id));

CREATE POLICY "Tutors can update own student mock exams"
  ON public.tutor_student_mock_exams FOR UPDATE
  USING (public.owns_tutor_student(tutor_student_id));

CREATE POLICY "Tutors can delete own student mock exams"
  ON public.tutor_student_mock_exams FOR DELETE
  USING (public.owns_tutor_student(tutor_student_id));

-- Гранты
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tutor_student_mock_exams TO authenticated;
