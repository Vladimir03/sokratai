-- 1. Тип учащегося. NULL = не указан (легаси; для дисплея = школьник по grade).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS learner_type text
  CHECK (learner_type IS NULL OR learner_type IN ('school', 'adult'));

COMMENT ON COLUMN public.profiles.learner_type IS
  'Тип учащегося: school (школьник, grade заполнен) | adult (взрослый, grade NULL) | NULL (легаси/не указан). Запрос Егора 2026-07-20 — онбординг для взрослых Эмилии.';

CREATE OR REPLACE FUNCTION public.get_student_onboarding_context()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_grade        integer;
  v_learner_type text;
  v_goal         text;
  v_subject      text;
  v_completed    boolean;
  v_has_tutor    boolean;
  v_tutor_exam   text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT grade, learner_type, learning_goal, difficult_subject, COALESCE(onboarding_completed, false)
    INTO v_grade, v_learner_type, v_goal, v_subject, v_completed
  FROM public.profiles
  WHERE id = v_uid;

  SELECT EXISTS(
    SELECT 1 FROM public.tutor_students
    WHERE student_id = v_uid AND status = 'active'
  ) INTO v_has_tutor;

  SELECT exam_type INTO v_tutor_exam
  FROM public.tutor_students
  WHERE student_id = v_uid AND status = 'active' AND exam_type IS NOT NULL
  LIMIT 1;

  RETURN jsonb_build_object(
    'grade', v_grade,
    'learner_type', v_learner_type,
    'learning_goal', v_goal,
    'difficult_subject', v_subject,
    'onboarding_completed', v_completed,
    'has_tutor', COALESCE(v_has_tutor, false),
    'tutor_exam_type', v_tutor_exam
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_onboarding_context() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_student_onboarding_context() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_student_onboarding_context() TO authenticated;