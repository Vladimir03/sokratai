-- =============================================
-- ТАБЛИЦА: tutors (профили репетиторов)
-- =============================================
CREATE TABLE public.tutors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  telegram_id TEXT,
  telegram_username TEXT,
  booking_link TEXT UNIQUE,
  avatar_url TEXT,
  subjects TEXT[] DEFAULT '{}',
  bio TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT tutors_user_id_unique UNIQUE (user_id)
);

-- Индексы
CREATE INDEX idx_tutors_user_id ON public.tutors(user_id);
CREATE INDEX idx_tutors_booking_link ON public.tutors(booking_link);

-- Триггер updated_at (используем существующую функцию)
CREATE TRIGGER update_tutors_updated_at
  BEFORE UPDATE ON public.tutors
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- =============================================
-- ТАБЛИЦА: tutor_students (связь репетитор-ученик)
-- =============================================
CREATE TABLE public.tutor_students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id UUID NOT NULL REFERENCES public.tutors(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_score INTEGER CHECK (target_score >= 0 AND target_score <= 100),
  start_score INTEGER CHECK (start_score >= 0 AND start_score <= 100),
  current_score INTEGER CHECK (current_score >= 0 AND current_score <= 100),
  exam_type TEXT CHECK (exam_type IN ('ege', 'oge')),
  subject TEXT,
  notes TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT tutor_students_unique UNIQUE (tutor_id, student_id)
);

-- Индексы
CREATE INDEX idx_tutor_students_tutor_id ON public.tutor_students(tutor_id);
CREATE INDEX idx_tutor_students_student_id ON public.tutor_students(student_id);

-- Триггер updated_at
CREATE TRIGGER update_tutor_students_updated_at
  BEFORE UPDATE ON public.tutor_students
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- =============================================
-- RLS ПОЛИТИКИ ДЛЯ tutors
-- =============================================
ALTER TABLE public.tutors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tutors can view own profile"
  ON public.tutors FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Tutors can insert own profile"
  ON public.tutors FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Tutors can update own profile"
  ON public.tutors FOR UPDATE
  USING (auth.uid() = user_id);

-- Публичный доступ по booking_link для страницы записи
CREATE POLICY "Anyone can view tutor by booking_link"
  ON public.tutors FOR SELECT
  USING (booking_link IS NOT NULL);

-- =============================================
-- RLS ПОЛИТИКИ ДЛЯ tutor_students
-- =============================================
ALTER TABLE public.tutor_students ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tutors can view own students"
  ON public.tutor_students FOR SELECT
  USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

CREATE POLICY "Tutors can add students"
  ON public.tutor_students FOR INSERT
  WITH CHECK (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

CREATE POLICY "Tutors can update own students"
  ON public.tutor_students FOR UPDATE
  USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

CREATE POLICY "Tutors can delete own students"
  ON public.tutor_students FOR DELETE
  USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

-- =============================================
-- ГРАНТЫ
-- =============================================
GRANT SELECT, INSERT, UPDATE ON public.tutors TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tutor_students TO authenticated;