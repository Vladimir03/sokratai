-- Atomic RPCs for tutor review «проверено» (2026-06-02, student-progress R1)
--
-- Mirror of force-complete RPCs (20260516120200 / 20260516120300):
-- SECURITY DEFINER, SET search_path = public, REVOKE ALL FROM PUBLIC +
-- GRANT EXECUTE TO service_role. Ownership дублируется внутри (defense in depth).
-- Клиентский JWT (anon/authenticated) звать не может — только edge через service_role.
--
-- Три функции:
--   1. hw_tutor_review_task(...)     — single-task подтверждение (+опц. override).
--                                      Для active-задачи делегирует закрытие/advance
--                                      существующему hw_tutor_force_complete_task
--                                      (re-entrant FOR UPDATE в одной транзакции
--                                      безопасен) — НЕ дублируем advance-логику.
--   2. hw_tutor_review_all_ai(...)   — bulk: флаг всем ai_score IS NOT NULL без
--                                      смены баллов/статуса.
--   3. hw_tutor_reopen_review(...)   — снять флаг (status НЕ трогаем).
--
-- Семантика «проверено» ОРТОГОНАЛЬНА status (spec §2.1): reopen-review чистит только
-- tutor_reviewed_at; completed-задача может быть un-reviewed; bulk не меняет баллы.
-- Закрытие active-задачи на review — UX-удобство (ученик не остаётся с открытой
-- оценённой задачей), флаг остаётся независимой колонкой.
--
-- Race-guard (mirror TASK_NOT_ACTIVE force-complete): двойной параллельный confirm —
-- второй ждёт FOR UPDATE lock, видит tutor_reviewed_at != NULL → ALREADY_REVIEWED (409).

-- ─── 1. hw_tutor_review_task ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hw_tutor_review_task(
  p_assignment_id UUID,
  p_student_id UUID,
  p_task_id UUID,
  p_tutor_id UUID,
  p_score NUMERIC,   -- nullable: null = подтвердить без правки балла (AI-балл не перезаписывается)
  p_comment TEXT     -- nullable; учитывается только когда p_score IS NOT NULL
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
  -- Ownership: assignment belongs to tutor.
  PERFORM 1 FROM public.homework_tutor_assignments
    WHERE id = p_assignment_id AND tutor_id = p_tutor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASSIGNMENT_NOT_OWNED' USING ERRCODE = '42501';
  END IF;

  -- Task validation + max_score.
  SELECT max_score INTO v_max_score
  FROM public.homework_tutor_tasks
  WHERE id = p_task_id AND assignment_id = p_assignment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_NOT_FOUND' USING ERRCODE = '42704';
  END IF;

  -- Score range + step 0.1 check (mirror edge / force-complete validation).
  IF p_score IS NOT NULL THEN
    IF p_score < 0 OR p_score > v_max_score THEN
      RAISE EXCEPTION 'SCORE_OUT_OF_RANGE' USING ERRCODE = '22023';
    END IF;
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

  -- Lock task_state row; read status + reviewed flag for race-guard.
  SELECT id, status, tutor_reviewed_at, earned_score, ai_score, tutor_score_override
    INTO v_state_id, v_state_status, v_state_reviewed_at, v_state_earned, v_state_ai, v_state_override
  FROM public.homework_tutor_task_states
  WHERE thread_id = v_thread_id AND task_id = p_task_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_STATE_NOT_FOUND' USING ERRCODE = '42704';
  END IF;

  -- Race-guard: already reviewed → 409.
  IF v_state_reviewed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_REVIEWED' USING ERRCODE = '22023';
  END IF;

  IF v_state_status = 'active' THEN
    -- Active task: reuse force-complete (close + override + advance + reconcile +
    -- system msg + TASK_NOT_ACTIVE guard). Re-entrant FOR UPDATE on same row in same
    -- transaction is safe. Then set the review marker (force-complete не трогает review).
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
    -- Already completed (AI-CORRECT or previously force-completed): set review flag
    -- + optional override. status НЕ трогаем (orthogonal), advance не нужен.
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

    -- Final score priority chain (mirror computeFinalScore):
    --   override (just set OR pre-existing) → earned → ai → max_score fallback.
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

COMMENT ON FUNCTION public.hw_tutor_review_task IS
  'Atomic tutor review «проверено» for single task. Sets tutor_reviewed_at (+optional override). Active task → delegates close/advance to hw_tutor_force_complete_task. SECURITY DEFINER, service_role only. Race-guard ALREADY_REVIEWED (22023).';

-- ─── 2. hw_tutor_review_all_ai ───────────────────────────────────────────────

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

  -- Bulk: подтвердить всё, что AI проверил. Баллы/status НЕ трогаем (acceptance:
  -- «баллы не изменены»). WHERE строго совпадает с frontend reviewableCount.
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

  -- Race-guard (spec §10): atomic conditional UPDATE уже не допускает double-write
  -- (повторный вызов матчит 0 строк), но spec требует ЯВНЫЙ 409-сигнал. Если
  -- подтверждать нечего (всё уже reviewed конкурентным вызовом ИЛИ нет AI-задач) —
  -- 409 NOTHING_TO_REVIEW, чтобы клиент refetch'нул stale-состояние. Frontend
  -- показывает bulk-кнопку только при reviewableCount>0, поэтому в норме 0 не бывает.
  IF v_reviewed_count = 0 THEN
    RAISE EXCEPTION 'NOTHING_TO_REVIEW' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object('reviewed_count', v_reviewed_count);
END;
$$;

REVOKE ALL ON FUNCTION public.hw_tutor_review_all_ai(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hw_tutor_review_all_ai(UUID, UUID, UUID) TO service_role;

COMMENT ON FUNCTION public.hw_tutor_review_all_ai IS
  'Bulk tutor review: tutor_reviewed_at для всех task_states где ai_score IS NOT NULL AND tutor_reviewed_at IS NULL. Баллы/status НЕ трогает. SECURITY DEFINER, service_role only. Returns {reviewed_count}.';

-- ─── 3. hw_tutor_reopen_review ───────────────────────────────────────────────

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

  -- Lock + read review flag.
  SELECT id, tutor_reviewed_at INTO v_state_id, v_state_reviewed_at
  FROM public.homework_tutor_task_states
  WHERE thread_id = v_thread_id AND task_id = p_task_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_STATE_NOT_FOUND' USING ERRCODE = '42704';
  END IF;

  -- Race-guard: not reviewed → 409 (mirror reopen force-complete guard).
  IF v_state_reviewed_at IS NULL THEN
    RAISE EXCEPTION 'NOT_REVIEWED' USING ERRCODE = '22023';
  END IF;

  -- Clear review flag only. status НЕ трогаем (reopen review ≠ reopen задачи).
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

COMMENT ON FUNCTION public.hw_tutor_reopen_review IS
  'Clear tutor_reviewed_at («снять подтверждение»). status НЕ трогает (orthogonal). SECURITY DEFINER, service_role only. Race-guard NOT_REVIEWED (22023).';
