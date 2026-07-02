CREATE OR REPLACE FUNCTION public.tutor_add_student_to_group_future_lessons(
  _tutor_group_id uuid,
  _tutor_student_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tutor_user_id uuid := auth.uid();
  v_tutor_id uuid;
  v_inserted integer := 0;
BEGIN
  IF v_tutor_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_tutor_id FROM public.tutors WHERE user_id = v_tutor_user_id;
  IF v_tutor_id IS NULL THEN
    RAISE EXCEPTION 'tutor profile not found' USING ERRCODE = '42501';
  END IF;

  -- Ensure the group belongs to this tutor
  IF NOT EXISTS (
    SELECT 1 FROM public.tutor_groups
    WHERE id = _tutor_group_id AND tutor_id = v_tutor_id
  ) THEN
    RAISE EXCEPTION 'group not found or not owned by tutor' USING ERRCODE = '42501';
  END IF;

  -- Ensure the student belongs to this tutor
  IF NOT EXISTS (
    SELECT 1 FROM public.tutor_students
    WHERE id = _tutor_student_id AND tutor_id = v_tutor_id
  ) THEN
    RAISE EXCEPTION 'student not found or not owned by tutor' USING ERRCODE = '42501';
  END IF;

  -- Ensure membership exists (idempotent)
  INSERT INTO public.tutor_group_memberships (tutor_group_id, tutor_student_id)
  VALUES (_tutor_group_id, _tutor_student_id)
  ON CONFLICT DO NOTHING;

  -- Add participant to every future group lesson that doesn't already include them
  WITH inserted AS (
    INSERT INTO public.tutor_lesson_participants (lesson_id, tutor_student_id)
    SELECT l.id, _tutor_student_id
    FROM public.tutor_lessons l
    WHERE l.tutor_group_id = _tutor_group_id
      AND l.tutor_id = v_tutor_id
      AND l.start_at > now()
      AND NOT EXISTS (
        SELECT 1 FROM public.tutor_lesson_participants p
        WHERE p.lesson_id = l.id AND p.tutor_student_id = _tutor_student_id
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM inserted;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.tutor_add_student_to_group_future_lessons(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tutor_add_student_to_group_future_lessons(uuid, uuid) TO authenticated;