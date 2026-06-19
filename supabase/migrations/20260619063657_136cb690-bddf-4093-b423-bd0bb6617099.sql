ALTER TABLE public.tutor_lesson_participants
  DROP CONSTRAINT IF EXISTS tutor_lesson_participants_tutor_student_id_fkey;

ALTER TABLE public.tutor_lesson_participants
  ADD CONSTRAINT tutor_lesson_participants_tutor_student_id_fkey
  FOREIGN KEY (tutor_student_id)
  REFERENCES public.tutor_students(id)
  ON DELETE CASCADE;

NOTIFY pgrst, 'reload schema';