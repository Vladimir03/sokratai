-- =============================================
-- WOW Payment hardening:
-- - idempotent lesson completion payments
-- - tutor payment requisites
-- - debt aggregation RPC
-- =============================================

-- 1) Schema additions
ALTER TABLE public.tutor_payments
ADD COLUMN IF NOT EXISTS lesson_id UUID REFERENCES public.tutor_lessons(id) ON DELETE SET NULL;

ALTER TABLE public.tutor_calendar_settings
ADD COLUMN IF NOT EXISTS payment_details_text TEXT;

-- If migration is re-run and duplicates exist, keep the oldest row linked to lesson.
WITH duplicates AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY lesson_id
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM public.tutor_payments
  WHERE lesson_id IS NOT NULL
)
UPDATE public.tutor_payments tp
SET lesson_id = NULL
FROM duplicates d
WHERE tp.id = d.id
  AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tutor_payments_unique_lesson_id
  ON public.tutor_payments(lesson_id)
  WHERE lesson_id IS NOT NULL;

COMMENT ON COLUMN public.tutor_payments.lesson_id IS
  'Связь с занятием для идемпотентного создания оплаты';
COMMENT ON COLUMN public.tutor_calendar_settings.payment_details_text IS
  'Реквизиты репетитора для напоминаний об оплате';

-- 2) Idempotent completion RPC
CREATE OR REPLACE FUNCTION public.complete_lesson_and_create_payment(
  _lesson_id UUID,
  _amount INTEGER,
  _payment_status TEXT DEFAULT 'pending',
  _tutor_telegram_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tutor_id UUID;
  _tutor_student_id UUID;
  _resolved_amount INTEGER;
  _payment_row_status TEXT;
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

  _resolved_amount := CASE
    WHEN _amount IS NOT NULL AND _amount > 0 THEN _amount
    ELSE NULL
  END;

  _payment_row_status := CASE
    WHEN _payment_status IN ('paid', 'paid_earlier') THEN 'paid'
    ELSE 'pending'
  END;

  UPDATE public.tutor_lessons
  SET
    status = 'completed',
    payment_status = _payment_status,
    payment_amount = _resolved_amount,
    paid_at = CASE
      WHEN _payment_status IN ('paid', 'paid_earlier') THEN NOW()
      ELSE NULL
    END,
    payment_reminder_sent = true
  WHERE id = _lesson_id;

  IF _resolved_amount IS NOT NULL AND _tutor_student_id IS NOT NULL THEN
    INSERT INTO public.tutor_payments (
      lesson_id,
      tutor_student_id,
      amount,
      status,
      due_date,
      paid_at
    ) VALUES (
      _lesson_id,
      _tutor_student_id,
      _resolved_amount,
      _payment_row_status,
      CURRENT_DATE,
      CASE
        WHEN _payment_status IN ('paid', 'paid_earlier') THEN NOW()
        ELSE NULL
      END
    )
    ON CONFLICT (lesson_id) WHERE lesson_id IS NOT NULL
    DO UPDATE SET
      tutor_student_id = EXCLUDED.tutor_student_id,
      amount = EXCLUDED.amount,
      status = EXCLUDED.status,
      due_date = EXCLUDED.due_date,
      paid_at = EXCLUDED.paid_at;
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_lesson_and_create_payment(UUID, INTEGER, TEXT, TEXT)
  TO authenticated, service_role;

-- 3) Debt aggregation RPC
CREATE OR REPLACE FUNCTION public.get_tutor_students_debt()
RETURNS TABLE (
  tutor_student_id UUID,
  pending_amount INTEGER,
  overdue_amount INTEGER,
  debt_amount INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tutor_id UUID;
BEGIN
  SELECT id INTO _tutor_id
  FROM public.tutors
  WHERE user_id = auth.uid();

  IF _tutor_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    ts.id AS tutor_student_id,
    COALESCE(SUM(
      CASE
        WHEN tp.status = 'pending'
         AND (tp.due_date IS NULL OR tp.due_date >= CURRENT_DATE)
        THEN tp.amount
        ELSE 0
      END
    ), 0)::INTEGER AS pending_amount,
    COALESCE(SUM(
      CASE
        WHEN tp.status = 'overdue'
          OR (tp.status = 'pending' AND tp.due_date < CURRENT_DATE)
        THEN tp.amount
        ELSE 0
      END
    ), 0)::INTEGER AS overdue_amount,
    COALESCE(SUM(
      CASE
        WHEN tp.status = 'overdue'
          OR (tp.status = 'pending' AND tp.due_date < CURRENT_DATE)
        THEN tp.amount
        WHEN tp.status = 'pending'
         AND (tp.due_date IS NULL OR tp.due_date >= CURRENT_DATE)
        THEN tp.amount
        ELSE 0
      END
    ), 0)::INTEGER AS debt_amount
  FROM public.tutor_students ts
  LEFT JOIN public.tutor_payments tp
    ON tp.tutor_student_id = ts.id
  WHERE ts.tutor_id = _tutor_id
  GROUP BY ts.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_tutor_students_debt()
  TO authenticated, service_role;