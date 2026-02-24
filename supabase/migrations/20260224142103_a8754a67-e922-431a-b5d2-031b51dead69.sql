-- =============================================
-- Group participant payment status RPC
-- Allows tutors to update payment status per participant
-- =============================================

CREATE OR REPLACE FUNCTION public.update_group_participant_payment_status(
  _lesson_id UUID,
  _tutor_student_id UUID,
  _payment_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tutor_id UUID;
  _participant RECORD;
  _new_status TEXT;
  _paid_at TIMESTAMPTZ;
  _result JSONB;
BEGIN
  -- Verify tutor owns this lesson
  SELECT t.id INTO _tutor_id
  FROM public.tutors t
  JOIN public.tutor_lessons l ON l.tutor_id = t.id
  WHERE l.id = _lesson_id
    AND t.user_id = auth.uid();

  IF _tutor_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'NOT_OWNER');
  END IF;

  -- Normalize status
  _new_status := CASE
    WHEN _payment_status IN ('paid', 'paid_earlier') THEN 'paid'
    WHEN _payment_status = 'pending' THEN 'pending'
    ELSE _payment_status
  END;

  _paid_at := CASE
    WHEN _new_status = 'paid' THEN NOW()
    ELSE NULL
  END;

  -- Update participant
  UPDATE public.tutor_lesson_participants
  SET payment_status = _new_status,
      paid_at = _paid_at
  WHERE lesson_id = _lesson_id
    AND tutor_student_id = _tutor_student_id
  RETURNING * INTO _participant;

  IF _participant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'PARTICIPANT_NOT_FOUND');
  END IF;

  -- Also update/create tutor_payments record
  IF _participant.payment_amount IS NOT NULL AND _participant.payment_amount > 0 THEN
    INSERT INTO public.tutor_payments (
      lesson_id, tutor_student_id, amount, status, due_date, paid_at
    ) VALUES (
      _lesson_id,
      _tutor_student_id,
      _participant.payment_amount,
      _new_status,
      CURRENT_DATE,
      _paid_at
    )
    ON CONFLICT (lesson_id) WHERE lesson_id IS NOT NULL
    DO UPDATE SET
      tutor_student_id = EXCLUDED.tutor_student_id,
      amount = EXCLUDED.amount,
      status = EXCLUDED.status,
      paid_at = EXCLUDED.paid_at;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', _new_status,
    'amount', _participant.payment_amount,
    'paid_at', _paid_at
  );
END;
$$;