-- Migration 1: add tutor_reviewed columns
ALTER TABLE public.homework_tutor_task_states
  ADD COLUMN IF NOT EXISTS tutor_reviewed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS tutor_reviewed_by UUID NULL;

GRANT SELECT (tutor_reviewed_at) ON public.homework_tutor_task_states TO authenticated;

COMMENT ON COLUMN public.homework_tutor_task_states.tutor_reviewed_at IS
  'Tutor confirmed (approved) the score — R1-5 «проверено». Student-visible badge.';
COMMENT ON COLUMN public.homework_tutor_task_states.tutor_reviewed_by IS
  'Audit: tutor user_id who reviewed. Tutor-only — NOT granted to authenticated.';

-- Migration 2: review RPCs
CREATE OR REPLACE FUNCTION public.hw_tutor_review_task(
  p_assignment_id UUID,
  p_student_id UUID,
  p_task_id UUID,
  p_tutor_id UUID,
  p_score NUMERIC,
  p_comment TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_score NUMERIC;
  v_thread_id UUID;
  v_state_id UUID;
  v_state_status TEXT;
  v_state_reviewed_at TIMESTAMPTZ;
  v_state_earned NUMERIC;
  v_state_ai NUMERIC;
  v_state_override NUMERIC;
  v_now TIMESTAMPTZ := now();
  v_final_score NUMERIC;
  v_advanced_to UUID := NULL;
  v_thread_completed BOOLEAN := FALSE;
  v_fc JSONB;
BEGIN
  PERFORM 1 FROM public.homework_tutor_assignments
    WHERE id = p_assignment_id AND tutor_id = p_tutor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASSIGNMENT_NOT_OWNED' USING ERRCODE = '42501';
  END IF;

  SELECT max_score INTO v_max_score
  FROM public.homework_tutor_tasks
  WHERE id = p_task_id AND assignment_id = p_assignment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_NOT_FOUND' USING ERRCODE = '42704';
  END IF;

  IF p_score IS NOT NULL THEN
    IF p_score < 0 OR p_score > v_max_score THEN
      RAISE EXCEPTION 'SCORE_OUT_OF_RANGE' USING ERRCODE = '22023';
    END IF;
    IF abs((p_score * 10) - round(p_score * 10)) > 1e-9 THEN
      RAISE EXCEPTION 'SCORE_STEP_INVALID' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT t.id INTO v_thread_id
  FROM public.homework_tutor_threads t
  JOIN public.homework_tutor_student_assignments sa
    ON sa.id = t.student_assignment_id
  WHERE sa.assignment_id = p_assignment_id
    AND sa.student_id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'THREAD_NOT_FOUND' USING ERRCODE = '42704';
  END IF;

  SELECT id, status, tutor_reviewed_at, earned_score, ai_score, tutor_score_override
    INTO v_state_id, v_state_status, v_state_reviewed_at, v_state_earned, v_state_ai, v_state_override
  FROM public.homework_tutor_task_states
  WHERE thread_id = v_thread_id AND task_id = p_task_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_STATE_NOT_FOUND' USING ERRCODE = '42704';
  END IF;

  IF v_state_reviewed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_REVIEWED' USING ERRCODE = '22023';
  END IF;

  IF v_state_status = 'active' THEN
    v_fc := public.hw_tutor_force_complete_task(
      p_assignment_id, p_student_id, p_task_id, p_tutor_id, p_score, p_comment
    );
    v_advanced_to := NULLIF(v_fc->>'advanced_to_task_id', '')::UUID;
    v_thread_completed := COALESCE((v_fc->>'thread_completed')::BOOLEAN, FALSE);
    v_final_score := (v_fc->>'final_score')::NUMERIC;

    UPDATE public.homework_tutor_task_states
    SET tutor_reviewed_at = v_now,
        tutor_reviewed_by = p_tutor_id,
        updated_at = v_now
    WHERE id = v_state_id;
  ELSE
    UPDATE public.homework_tutor_task_states
    SET
      tutor_reviewed_at = v_now,
      tutor_reviewed_by = p_tutor_id,
      tutor_score_override = CASE WHEN p_score IS NOT NULL THEN p_score ELSE tutor_score_override END,
      tutor_score_override_comment = CASE WHEN p_score IS NOT NULL THEN p_comment ELSE tutor_score_override_comment END,
      tutor_score_override_at = CASE WHEN p_score IS NOT NULL THEN v_now ELSE tutor_score_override_at END,
      tutor_score_override_by = CASE WHEN p_score IS NOT NULL THEN p_tutor_id ELSE tutor_score_override_by END,
      best_score = CASE
        WHEN p_score IS NOT NULL THEN GREATEST(COALESCE(best_score, 0), p_score)
        ELSE best_score
      END,
      updated_at = v_now
    WHERE id = v_state_id;

    v_final_score := COALESCE(
      CASE WHEN p_score IS NOT NULL THEN p_score ELSE v_state_override END,
      v_state_earned,
      v_state_ai,
      v_max_score
    );
  END IF;

  RETURN jsonb_build_object(
    'task_state_id', v_state_id,
    'thread_id', v_thread_id,
    'task_id', p_task_id,
    'tutor_reviewed_at', v_now,
    'final_score', v_final_score,
    'max_score', v_max_score,
    'advanced_to_task_id', v_advanced_to,
    'thread_completed', v_thread_completed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hw_tutor_review_task(UUID, UUID, UUID, UUID, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hw_tutor_review_task(UUID, UUID, UUID, UUID, NUMERIC, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.hw_tutor_review_all_ai(
  p_assignment_id UUID,
  p_student_id UUID,
  p_tutor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thread_id UUID;
  v_reviewed_count INT;
  v_now TIMESTAMPTZ := now();
BEGIN
  PERFORM 1 FROM public.homework_tutor_assignments
    WHERE id = p_assignment_id AND tutor_id = p_tutor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASSIGNMENT_NOT_OWNED' USING ERRCODE = '42501';
  END IF;

  SELECT t.id INTO v_thread_id
  FROM public.homework_tutor_threads t
  JOIN public.homework_tutor_student_assignments sa
    ON sa.id = t.student_assignment_id
  WHERE sa.assignment_id = p_assignment_id
    AND sa.student_id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'THREAD_NOT_FOUND' USING ERRCODE = '42704';
  END IF;

  WITH updated AS (
    UPDATE public.homework_tutor_task_states
    SET tutor_reviewed_at = v_now,
        tutor_reviewed_by = p_tutor_id,
        updated_at = v_now
    WHERE thread_id = v_thread_id
      AND ai_score IS NOT NULL
      AND tutor_reviewed_at IS NULL
    RETURNING id
  )
  SELECT COUNT(*)::INT INTO v_reviewed_count FROM updated;

  IF v_reviewed_count = 0 THEN
    RAISE EXCEPTION 'NOTHING_TO_REVIEW' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object('reviewed_count', v_reviewed_count);
END;
$$;

REVOKE ALL ON FUNCTION public.hw_tutor_review_all_ai(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hw_tutor_review_all_ai(UUID, UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.hw_tutor_reopen_review(
  p_assignment_id UUID,
  p_student_id UUID,
  p_task_id UUID,
  p_tutor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thread_id UUID;
  v_state_id UUID;
  v_state_reviewed_at TIMESTAMPTZ;
  v_now TIMESTAMPTZ := now();
BEGIN
  PERFORM 1 FROM public.homework_tutor_assignments
    WHERE id = p_assignment_id AND tutor_id = p_tutor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASSIGNMENT_NOT_OWNED' USING ERRCODE = '42501';
  END IF;

  SELECT t.id INTO v_thread_id
  FROM public.homework_tutor_threads t
  JOIN public.homework_tutor_student_assignments sa
    ON sa.id = t.student_assignment_id
  WHERE sa.assignment_id = p_assignment_id
    AND sa.student_id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'THREAD_NOT_FOUND' USING ERRCODE = '42704';
  END IF;

  SELECT id, tutor_reviewed_at INTO v_state_id, v_state_reviewed_at
  FROM public.homework_tutor_task_states
  WHERE thread_id = v_thread_id AND task_id = p_task_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_STATE_NOT_FOUND' USING ERRCODE = '42704';
  END IF;

  IF v_state_reviewed_at IS NULL THEN
    RAISE EXCEPTION 'NOT_REVIEWED' USING ERRCODE = '22023';
  END IF;

  UPDATE public.homework_tutor_task_states
  SET tutor_reviewed_at = NULL,
      tutor_reviewed_by = NULL,
      updated_at = v_now
  WHERE id = v_state_id;

  RETURN jsonb_build_object('ok', true, 'task_state_id', v_state_id);
END;
$$;

REVOKE ALL ON FUNCTION public.hw_tutor_reopen_review(UUID, UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hw_tutor_reopen_review(UUID, UUID, UUID, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';