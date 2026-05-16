-- Atomic RPCs for tutor force-complete (2026-05-16)

CREATE OR REPLACE FUNCTION public.hw_tutor_force_complete_task(
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
  v_current_task_order INT;
  v_thread_id UUID;
  v_state_id UUID;
  v_state_earned NUMERIC;
  v_state_ai NUMERIC;
  v_state_override NUMERIC;
  v_next_task_id UUID;
  v_next_task_order INT;
  v_now TIMESTAMPTZ := now();
  v_final_score NUMERIC;
BEGIN
  PERFORM 1 FROM public.homework_tutor_assignments
    WHERE id = p_assignment_id AND tutor_id = p_tutor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASSIGNMENT_NOT_OWNED' USING ERRCODE = '42501';
  END IF;

  SELECT max_score, order_num INTO v_max_score, v_current_task_order
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

  SELECT id, earned_score, ai_score, tutor_score_override
    INTO v_state_id, v_state_earned, v_state_ai, v_state_override
  FROM public.homework_tutor_task_states
  WHERE thread_id = v_thread_id AND task_id = p_task_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_STATE_NOT_FOUND' USING ERRCODE = '42704';
  END IF;

  UPDATE public.homework_tutor_task_states
  SET
    tutor_score_override = CASE WHEN p_score IS NOT NULL THEN p_score ELSE tutor_score_override END,
    tutor_score_override_comment = CASE WHEN p_score IS NOT NULL THEN p_comment ELSE tutor_score_override_comment END,
    tutor_score_override_at = CASE WHEN p_score IS NOT NULL THEN v_now ELSE tutor_score_override_at END,
    tutor_score_override_by = CASE WHEN p_score IS NOT NULL THEN p_tutor_id ELSE tutor_score_override_by END,
    status = 'completed',
    tutor_force_completed_at = v_now,
    tutor_force_completed_by = p_tutor_id,
    best_score = CASE
      WHEN p_score IS NOT NULL THEN GREATEST(COALESCE(best_score, 0), p_score)
      ELSE best_score
    END,
    updated_at = v_now
  WHERE id = v_state_id;

  SELECT ts.task_id, t.order_num INTO v_next_task_id, v_next_task_order
  FROM public.homework_tutor_task_states ts
  JOIN public.homework_tutor_tasks t ON t.id = ts.task_id
  WHERE ts.thread_id = v_thread_id
    AND ts.status = 'active'
    AND ts.task_id <> p_task_id
  ORDER BY t.order_num ASC
  LIMIT 1;

  IF v_next_task_id IS NOT NULL THEN
    UPDATE public.homework_tutor_threads
    SET current_task_id = v_next_task_id,
        current_task_order = v_next_task_order,
        updated_at = v_now
    WHERE id = v_thread_id;

    INSERT INTO public.homework_tutor_thread_messages
      (thread_id, role, content, task_id, task_order, message_kind)
    VALUES
      (v_thread_id, 'system',
       'Задача ' || v_current_task_order::TEXT ||
         ' закрыта репетитором. Переходим к задаче ' || v_next_task_order::TEXT || '.',
       v_next_task_id, v_next_task_order, 'system');
  ELSE
    UPDATE public.homework_tutor_threads
    SET current_task_id = NULL,
        status = 'completed',
        updated_at = v_now
    WHERE id = v_thread_id;

    INSERT INTO public.homework_tutor_thread_messages
      (thread_id, role, content, message_kind)
    VALUES
      (v_thread_id, 'system',
       'Задача ' || v_current_task_order::TEXT ||
         ' закрыта репетитором. Все задачи выполнены!',
       'system');
  END IF;

  v_final_score := COALESCE(
    CASE WHEN p_score IS NOT NULL THEN p_score ELSE v_state_override END,
    v_state_earned,
    v_state_ai,
    v_max_score
  );

  RETURN jsonb_build_object(
    'task_state_id', v_state_id,
    'thread_id', v_thread_id,
    'task_id', p_task_id,
    'final_status', 'completed',
    'final_score', v_final_score,
    'max_score', v_max_score,
    'tutor_force_completed_at', v_now,
    'tutor_score_override', CASE WHEN p_score IS NOT NULL THEN p_score ELSE v_state_override END,
    'tutor_score_override_at', CASE WHEN p_score IS NOT NULL THEN v_now ELSE NULL END,
    'tutor_score_override_comment', CASE WHEN p_score IS NOT NULL THEN p_comment ELSE NULL END,
    'advanced_to_task_id', v_next_task_id,
    'thread_completed', v_next_task_id IS NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hw_tutor_force_complete_task(UUID, UUID, UUID, UUID, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hw_tutor_force_complete_task(UUID, UUID, UUID, UUID, NUMERIC, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.hw_tutor_force_complete_all_tasks(
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
  v_closed_count INT;
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
    SET status = 'completed',
        tutor_force_completed_at = v_now,
        tutor_force_completed_by = p_tutor_id,
        updated_at = v_now
    WHERE thread_id = v_thread_id AND status = 'active'
    RETURNING id
  )
  SELECT COUNT(*)::INT INTO v_closed_count FROM updated;

  UPDATE public.homework_tutor_threads
  SET current_task_id = NULL,
      status = 'completed',
      updated_at = v_now
  WHERE id = v_thread_id
    AND (current_task_id IS NOT NULL OR status <> 'completed');

  IF v_closed_count > 0 THEN
    INSERT INTO public.homework_tutor_thread_messages
      (thread_id, role, content, message_kind)
    VALUES
      (v_thread_id, 'system',
       'Репетитор закрыл ' || v_closed_count::TEXT || ' ' ||
       CASE WHEN v_closed_count = 1 THEN 'задачу' ELSE 'задач' END || ' вручную.',
       'system');
  END IF;

  RETURN jsonb_build_object(
    'closed_count', v_closed_count,
    'advanced_to_task_id', NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hw_tutor_force_complete_all_tasks(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hw_tutor_force_complete_all_tasks(UUID, UUID, UUID) TO service_role;