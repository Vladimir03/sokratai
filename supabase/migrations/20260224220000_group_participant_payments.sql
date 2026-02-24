-- =============================================
-- PR-G4A: Per-participant payment correctness for mini-group lessons
-- - move idempotency from lesson_id to (lesson_id, tutor_student_id)
-- - keep single-lesson behavior backward compatible
-- - add RPC for participant-level payment status updates
-- =============================================

DROP INDEX IF EXISTS public.idx_tutor_payments_unique_lesson_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tutor_payments_unique_lesson_student
  ON public.tutor_payments (lesson_id, tutor_student_id)
  WHERE lesson_id IS NOT NULL AND tutor_student_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.complete_lesson_and_create_payment(
  _lesson_id uuid,
  _amount integer,
  _payment_status text DEFAULT 'pending',
  _tutor_telegram_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  _tutor_id uuid;
  _tutor_student_id uuid;
  _resolved_amount integer;
  _payment_row_status text;
  _is_group boolean;
  _participant record;
BEGIN
  IF _tutor_telegram_id IS NOT NULL THEN
    SELECT t.id, l.tutor_student_id
      INTO _tutor_id, _tutor_student_id
    FROM public.tutors t
    JOIN public.tutor_lessons l ON l.tutor_id = t.id
    WHERE l.id = _lesson_id
      AND t.telegram_id = _tutor_telegram_id;
  ELSE
    SELECT t.id, l.tutor_student_id
      INTO _tutor_id, _tutor_student_id
    FROM public.tutors t
    JOIN public.tutor_lessons l ON l.tutor_id = t.id
    WHERE l.id = _lesson_id
      AND t.user_id = auth.uid();
  END IF;

  IF _tutor_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.tutor_lesson_participants WHERE lesson_id = _lesson_id
  ) INTO _is_group;

  _payment_row_status := CASE
    WHEN _payment_status IN ('paid', 'paid_earlier') THEN 'paid'
    ELSE 'pending'
  END;

  UPDATE public.tutor_lessons
  SET
    status = 'completed',
    payment_status = _payment_status,
    payment_amount = CASE WHEN NOT _is_group THEN
      CASE WHEN _amount IS NOT NULL AND _amount > 0 THEN _amount ELSE NULL END
    ELSE NULL END,
    paid_at = CASE
      WHEN _payment_status IN ('paid', 'paid_earlier') THEN NOW()
      ELSE NULL
    END,
    payment_reminder_sent = true
  WHERE id = _lesson_id;

  IF _is_group THEN
    FOR _participant IN
      SELECT p.tutor_student_id, p.payment_amount
      FROM public.tutor_lesson_participants p
      WHERE p.lesson_id = _lesson_id
    LOOP
      IF _participant.payment_amount IS NOT NULL AND _participant.payment_amount > 0 THEN
        INSERT INTO public.tutor_payments (
          lesson_id, tutor_student_id, amount, status, due_date, paid_at
        ) VALUES (
          _lesson_id,
          _participant.tutor_student_id,
          _participant.payment_amount,
          _payment_row_status,
          CURRENT_DATE,
          CASE WHEN _payment_status IN ('paid', 'paid_earlier') THEN NOW() ELSE NULL END
        )
        ON CONFLICT (lesson_id, tutor_student_id)
          WHERE lesson_id IS NOT NULL AND tutor_student_id IS NOT NULL
        DO UPDATE SET
          amount = EXCLUDED.amount,
          status = EXCLUDED.status,
          due_date = EXCLUDED.due_date,
          paid_at = EXCLUDED.paid_at;
      END IF;

      UPDATE public.tutor_lesson_participants
      SET
        payment_status = _payment_status,
        paid_at = CASE WHEN _payment_status IN ('paid', 'paid_earlier') THEN NOW() ELSE NULL END
      WHERE lesson_id = _lesson_id
        AND tutor_student_id = _participant.tutor_student_id;
    END LOOP;
  ELSE
    _resolved_amount := CASE
      WHEN _amount IS NOT NULL AND _amount > 0 THEN _amount
      ELSE NULL
    END;

    IF _resolved_amount IS NOT NULL AND _tutor_student_id IS NOT NULL THEN
      INSERT INTO public.tutor_payments (
        lesson_id, tutor_student_id, amount, status, due_date, paid_at
      ) VALUES (
        _lesson_id,
        _tutor_student_id,
        _resolved_amount,
        _payment_row_status,
        CURRENT_DATE,
        CASE WHEN _payment_status IN ('paid', 'paid_earlier') THEN NOW() ELSE NULL END
      )
      ON CONFLICT (lesson_id, tutor_student_id)
        WHERE lesson_id IS NOT NULL AND tutor_student_id IS NOT NULL
      DO UPDATE SET
        amount = EXCLUDED.amount,
        status = EXCLUDED.status,
        due_date = EXCLUDED.due_date,
        paid_at = EXCLUDED.paid_at;
    END IF;
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_lesson_and_create_payment(uuid, integer, text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_group_participant_payment_status(
  _lesson_id uuid,
  _tutor_student_id uuid,
  _payment_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  _tutor_id uuid;
  _lesson_status text;
  _payment_row_status text;
  _participant_amount integer;
  _paid_at timestamptz;
BEGIN
  IF _payment_status NOT IN ('pending', 'paid') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', NULL,
      'amount', NULL,
      'paid_at', NULL,
      'error_code', 'INVALID_PAYMENT_STATUS'
    );
  END IF;

  SELECT t.id, l.status
    INTO _tutor_id, _lesson_status
  FROM public.tutor_lessons l
  JOIN public.tutors t ON t.id = l.tutor_id
  WHERE l.id = _lesson_id
    AND t.user_id = auth.uid();

  IF _tutor_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', NULL,
      'amount', NULL,
      'paid_at', NULL,
      'error_code', 'LESSON_NOT_FOUND_OR_FORBIDDEN'
    );
  END IF;

  IF _lesson_status <> 'completed' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', NULL,
      'amount', NULL,
      'paid_at', NULL,
      'error_code', 'LESSON_NOT_COMPLETED'
    );
  END IF;

  SELECT p.payment_amount
    INTO _participant_amount
  FROM public.tutor_lesson_participants p
  WHERE p.lesson_id = _lesson_id
    AND p.tutor_student_id = _tutor_student_id;

  IF _participant_amount IS NULL AND NOT EXISTS (
    SELECT 1
    FROM public.tutor_lesson_participants p
    WHERE p.lesson_id = _lesson_id
      AND p.tutor_student_id = _tutor_student_id
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', NULL,
      'amount', NULL,
      'paid_at', NULL,
      'error_code', 'PARTICIPANT_NOT_FOUND'
    );
  END IF;

  _payment_row_status := CASE
    WHEN _payment_status = 'paid' THEN 'paid'
    ELSE 'pending'
  END;
  _paid_at := CASE
    WHEN _payment_status = 'paid' THEN NOW()
    ELSE NULL
  END;

  UPDATE public.tutor_lesson_participants
  SET
    payment_status = _payment_status,
    paid_at = _paid_at
  WHERE lesson_id = _lesson_id
    AND tutor_student_id = _tutor_student_id;

  IF _participant_amount IS NOT NULL AND _participant_amount > 0 THEN
    INSERT INTO public.tutor_payments (
      lesson_id, tutor_student_id, amount, status, due_date, paid_at
    ) VALUES (
      _lesson_id,
      _tutor_student_id,
      _participant_amount,
      _payment_row_status,
      CURRENT_DATE,
      _paid_at
    )
    ON CONFLICT (lesson_id, tutor_student_id)
      WHERE lesson_id IS NOT NULL AND tutor_student_id IS NOT NULL
    DO UPDATE SET
      amount = EXCLUDED.amount,
      status = EXCLUDED.status,
      due_date = EXCLUDED.due_date,
      paid_at = EXCLUDED.paid_at;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', _payment_status,
    'amount', _participant_amount,
    'paid_at', _paid_at,
    'error_code', NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_group_participant_payment_status(uuid, uuid, text)
  TO authenticated, service_role;
