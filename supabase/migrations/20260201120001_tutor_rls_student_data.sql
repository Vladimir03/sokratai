-- =============================================
-- MVP #1: Профиль ученика (C1)
-- RLS политики: репетитор получает read-доступ к данным своих учеников
-- =============================================

-- Вспомогательная функция: проверка, является ли student_id учеником текущего репетитора
CREATE OR REPLACE FUNCTION public.is_tutor_of_student(_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tutor_students ts
    JOIN public.tutors t ON t.id = ts.tutor_id
    WHERE ts.student_id = _student_id
    AND t.user_id = auth.uid()
  )
$$;

-- =============================================
-- 1. RLS для profiles: репетитор может видеть профили своих учеников
-- =============================================
CREATE POLICY "Tutors can view profiles of their students"
  ON public.profiles FOR SELECT
  USING (public.is_tutor_of_student(id));

-- =============================================
-- 2. RLS для chats: репетитор может видеть чаты своих учеников
-- =============================================
CREATE POLICY "Tutors can view chats of their students"
  ON public.chats FOR SELECT
  USING (public.is_tutor_of_student(user_id));

-- =============================================
-- 3. RLS для chat_messages: репетитор может видеть сообщения своих учеников
-- =============================================
CREATE POLICY "Tutors can view messages of their students"
  ON public.chat_messages FOR SELECT
  USING (public.is_tutor_of_student(user_id));
