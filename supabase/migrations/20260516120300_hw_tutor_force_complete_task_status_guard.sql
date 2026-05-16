-- P2 fix from code review round 2 (2026-05-16):
-- `hw_tutor_force_complete_task` был атомарным, но не идемпотентным внутри
-- FOR UPDATE lock. Два одновременных клика «Сохранить и закрыть» оба проходили
-- edge pre-check `existing.status === "active"`, второй RPC дожидался lock
-- release и видел уже completed row, но **всё равно**:
--   - перезаписывал tutor_force_completed_at/_by на новый timestamp
--   - вставлял second system message
--   - искал next active task (которая уже была advanced в первом клике)
--
-- Fix: SELECT status в lock + явная проверка `status = 'active'` ВНУТРИ
-- транзакции. RAISE EXCEPTION `TASK_NOT_ACTIVE` (HTTP 409 в edge function).
--
-- CREATE OR REPLACE — не плодим function variants, просто заменяем body.

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
  v_state_status TEXT;
  v_next_task_id UUID;
  v_next_task_order INT;
  v_now TIMESTAMPTZ := now();
  v_final_score NUMERIC;
BEGIN
  -- Ownership.
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

  -- Lock + read status. Concurrency guard (P2 fix from code review round 2):
  -- если второй клик дождался lock release — он увидит status <> 'active' и
  -- AUF'нет с TASK_NOT_ACTIVE. Без этого guard'a второй вызов перезаписал бы
  -- marker timestamp + вставил duplicate system message + сделал бы пустой
  -- advance search.
  SELECT id, earned_score, ai_score, tutor_score_override, status
    INTO v_state_id, v_state_earned, v_state_ai, v_state_override, v_state_status
  FROM public.homework_tutor_task_states
  WHERE thread_id = v_thread_id AND task_id = p_task_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_STATE_NOT_FOUND' USING ERRCODE = '42704';
  END IF;
  IF v_state_status <> 'active' THEN
    RAISE EXCEPTION 'TASK_NOT_ACTIVE' USING ERRCODE = '22023';
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
    'tutor_score_override_at', CASE
      WHEN p_score IS NOT NULL THEN v_now
      ELSE NULL
    END,
    'tutor_score_override_comment', CASE WHEN p_score IS NOT NULL THEN p_comment ELSE NULL END,
    'advanced_to_task_id', v_next_task_id,
    'thread_completed', v_next_task_id IS NULL
  );
END;
$$;

-- GRANT/REVOKE остаются от миграции 20260516120200 (replaced, не recreated).
