
-- =============================================
-- 1. Create tutor_lesson_participants junction table
-- =============================================
CREATE TABLE public.tutor_lesson_participants (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lesson_id uuid NOT NULL REFERENCES public.tutor_lessons(id) ON DELETE CASCADE,
  tutor_student_id uuid NOT NULL REFERENCES public.tutor_students(id),
  student_id uuid NOT NULL,
  payment_status text NOT NULL DEFAULT 'unpaid',
  payment_amount integer,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(lesson_id, tutor_student_id)
);

-- Index for fast lookups by lesson
CREATE INDEX idx_tutor_lesson_participants_lesson ON public.tutor_lesson_participants(lesson_id);

-- =============================================
-- 2. Enable RLS
-- =============================================
ALTER TABLE public.tutor_lesson_participants ENABLE ROW LEVEL SECURITY;

-- Helper: check if user owns the lesson
CREATE OR REPLACE FUNCTION public.owns_lesson(_lesson_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tutor_lessons l
    JOIN public.tutors t ON t.id = l.tutor_id
    WHERE l.id = _lesson_id
    AND t.user_id = auth.uid()
  )
$$;

-- RLS policies
CREATE POLICY "Tutors can view participants of own lessons"
ON public.tutor_lesson_participants
FOR SELECT
USING (owns_lesson(lesson_id));

CREATE POLICY "Tutors can insert participants to own lessons"
ON public.tutor_lesson_participants
FOR INSERT
WITH CHECK (owns_lesson(lesson_id));

CREATE POLICY "Tutors can update participants of own lessons"
ON public.tutor_lesson_participants
FOR UPDATE
USING (owns_lesson(lesson_id));

CREATE POLICY "Tutors can delete participants of own lessons"
ON public.tutor_lesson_participants
FOR DELETE
USING (owns_lesson(lesson_id));

-- =============================================
-- 3. Update complete_lesson_and_create_payment RPC
--    to handle group lessons with participants
-- =============================================
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
  _tutor_id UUID;
  _tutor_student_id UUID;
  _resolved_amount INTEGER;
  _payment_row_status TEXT;
  _is_group BOOLEAN;
  _participant RECORD;
BEGIN
  -- Resolve tutor ownership
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

  -- Check if this is a group lesson (has participants in junction table)
  SELECT EXISTS (
    SELECT 1 FROM public.tutor_lesson_participants WHERE lesson_id = _lesson_id
  ) INTO _is_group;

  _payment_row_status := CASE
    WHEN _payment_status IN ('paid', 'paid_earlier') THEN 'paid'
    ELSE 'pending'
  END;

  -- Mark lesson as completed
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
    -- Create payments for each participant
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
        ON CONFLICT (lesson_id) WHERE lesson_id IS NOT NULL
        DO UPDATE SET
          tutor_student_id = EXCLUDED.tutor_student_id,
          amount = EXCLUDED.amount,
          status = EXCLUDED.status,
          due_date = EXCLUDED.due_date,
          paid_at = EXCLUDED.paid_at;
      END IF;

      -- Update participant payment status
      UPDATE public.tutor_lesson_participants
      SET payment_status = _payment_status,
          paid_at = CASE WHEN _payment_status IN ('paid', 'paid_earlier') THEN NOW() ELSE NULL END
      WHERE lesson_id = _lesson_id AND tutor_student_id = _participant.tutor_student_id;
    END LOOP;
  ELSE
    -- Original single-student logic
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
      ON CONFLICT (lesson_id) WHERE lesson_id IS NOT NULL
      DO UPDATE SET
        tutor_student_id = EXCLUDED.tutor_student_id,
        amount = EXCLUDED.amount,
        status = EXCLUDED.status,
        due_date = EXCLUDED.due_date,
        paid_at = EXCLUDED.paid_at;
    END IF;
  END IF;

  RETURN true;
END;
$$;
