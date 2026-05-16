-- Atomic RPCs for tutor force-complete (2026-05-16, P1 fix from code review)
--
-- Replaces multi-query edge-function flow (UPDATE override → UPDATE marker →
-- loadAdvanceContext → performTaskAdvance) with single transactional RPC.
-- Без этого middle-failure оставлял БД в неконсистентном состоянии (marker
-- set, status active, thread cursor stale). Retry не лечил — `existing.status
-- !== 'active'` после partial success.
--
-- Two functions:
--   1. hw_tutor_force_complete_task(...)       — single-task: override + marker
--                                                + status + advance + system msg
--   2. hw_tutor_force_complete_all_tasks(...)  — bulk: mass status + thread
--                                                cursor reconcile + single system msg
--
-- Reopen path остаётся в edge function (single UPDATE, atomicity не критична).
--
-- SECURITY DEFINER + REVOKE FROM PUBLIC + GRANT TO service_role: edge
-- functions через service_role могут звать; клиентский JWT (anon/authenticated)
-- — не может. Ownership проверка дублируется внутри функции (defense in depth).
--
-- См.:
--   - `~/.claude/plans/lexical-brewing-gadget.md`
--   - code-review feedback round 1 (P1 atomicity)

-- ─── 1. hw_tutor_force_complete_task ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hw_tutor_force_complete_task(
  p_assignment_id UUID,
  p_student_id UUID,
  p_task_id UUID,
  p_tutor_id UUID,
  p_score NUMERIC,   -- nullable: null = не трогаем override, value = ставим override
  p_comment TEXT     -- nullable; ignored when p_score IS NULL
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
  -- Ownership: assignment belongs to tutor.
  PERFORM 1 FROM public.homework_tutor_assignments
    WHERE id = p_assignment_id AND tutor_id = p_tutor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASSIGNMENT_NOT_OWNED' USING ERRCODE = '42501';
  END IF;

  -- Task validation + max_score + order_num.
  SELECT max_score, order_num INTO v_max_score, v_current_task_order
  FROM public.homework_tutor_tasks
  WHERE id = p_task_id AND assignment_id = p_assignment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_NOT_FOUND' USING ERRCODE = '42704';
  END IF;

  -- Score range + step 0.1 check (mirror edge-function validation).
  IF p_score IS NOT NULL THEN
    IF p_score < 0 OR p_score > v_max_score THEN
      RAISE EXCEPTION 'SCORE_OUT_OF_RANGE' USING ERRCODE = '22023';
    END IF;
    -- Step 0.1 tolerance 1e-9.
    IF abs((p_score * 10) - round(p_score * 10)) > 1e-9 THEN
      RAISE EXCEPTION 'SCORE_STEP_INVALID' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Resolve thread for (assignment, student).
  SELECT t.id INTO v_thread_id
  FROM public.homework_tutor_threads t
  JOIN public.homework_tutor_student_assignments sa
    ON sa.id = t.student_assignment_id
  WHERE sa.assignment_id = p_assignment_id
    AND sa.student_id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'THREAD_NOT_FOUND' USING ERRCODE = '42704';
  END IF;

  -- Lock task_state row for the duration of this transaction.
  SELECT id, earned_score, ai_score, tutor_score_override
    INTO v_state_id, v_state_earned, v_state_ai, v_state_override
  FROM public.homework_tutor_task_states
  WHERE thread_id = v_thread_id AND task_id = p_task_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_STATE_NOT_FOUND' USING ERRCODE = '42704';
  END IF;

  -- Single atomic UPDATE: override (if not null), status, force-complete marker,
  -- best_score, updated_at — все в одной строке БД.
  -- p_score IS NULL → preserve existing override; comment NOT touched.
  -- p_score IS NOT NULL → set override + comment + metadata.
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

  -- Find next active task (excluding the one we just closed). ORDER BY order_num
  -- ASC mirrors performTaskAdvance: first remaining active by display order.
  SELECT ts.task_id, t.order_num INTO v_next_task_id, v_next_task_order
  FROM public.homework_tutor_task_states ts
  JOIN public.homework_tutor_tasks t ON t.id = ts.task_id
  WHERE ts.thread_id = v_thread_id
    AND ts.status = 'active'
    AND ts.task_id <> p_task_id
  ORDER BY t.order_num ASC
  LIMIT 1;

  -- Update thread cursor + status; insert transition system message.
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

  -- Final score priority chain (mirror computeFinalScore):
  --   override (just set OR pre-existing) → earned → ai → max_score fallback
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

REVOKE ALL ON FUNCTION public.hw_tutor_force_complete_task(UUID, UUID, UUID, UUID, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hw_tutor_force_complete_task(UUID, UUID, UUID, UUID, NUMERIC, TEXT) TO service_role;

COMMENT ON FUNCTION public.hw_tutor_force_complete_task IS
  'Atomic tutor force-complete + advance for single task. SECURITY DEFINER, service_role only. Returns JSONB with task_state_id, final_score, advanced_to_task_id, thread_completed.';

-- ─── 2. hw_tutor_force_complete_all_tasks ────────────────────────────────────

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
  -- Ownership.
  PERFORM 1 FROM public.homework_tutor_assignments
    WHERE id = p_assignment_id AND tutor_id = p_tutor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASSIGNMENT_NOT_OWNED' USING ERRCODE = '42501';
  END IF;

  -- Resolve thread.
  SELECT t.id INTO v_thread_id
  FROM public.homework_tutor_threads t
  JOIN public.homework_tutor_student_assignments sa
    ON sa.id = t.student_assignment_id
  WHERE sa.assignment_id = p_assignment_id
    AND sa.student_id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'THREAD_NOT_FOUND' USING ERRCODE = '42704';
  END IF;

  -- Bulk update active task_states.
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

  -- Reconcile thread cursor: must be NULL + status='completed' after bulk
  -- close (idempotent even when v_closed_count = 0 — recovers from prior
  -- partial-failure where some task_states были closed но thread остался active).
  UPDATE public.homework_tutor_threads
  SET current_task_id = NULL,
      status = 'completed',
      updated_at = v_now
  WHERE id = v_thread_id
    AND (current_task_id IS NOT NULL OR status <> 'completed');

  -- Single system message только если действительно что-то закрыли в этот вызов.
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

COMMENT ON FUNCTION public.hw_tutor_force_complete_all_tasks IS
  'Atomic bulk tutor force-complete for ALL active tasks of student. SECURITY DEFINER, service_role only. Also reconciles thread cursor (idempotent recovery for partial-failure state). Returns JSONB with closed_count.';
