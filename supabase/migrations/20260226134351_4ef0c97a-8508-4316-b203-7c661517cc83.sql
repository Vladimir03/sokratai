-- Fix: add lesson_start_at to bot payment RPC
DROP FUNCTION IF EXISTS public.get_tutor_pending_payments_by_telegram(text);

CREATE OR REPLACE FUNCTION public.get_tutor_pending_payments_by_telegram(
  _telegram_id TEXT
)
RETURNS TABLE (
  payment_id        UUID,
  tutor_student_id  UUID,
  student_name      TEXT,
  amount            NUMERIC,
  period            TEXT,
  due_date          DATE,
  lesson_start_at   TIMESTAMPTZ
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
  WHERE telegram_id = _telegram_id
  LIMIT 1;

  IF _tutor_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    tp.id                                 AS payment_id,
    tp.tutor_student_id,
    COALESCE(pr.username, 'Ученик')::TEXT AS student_name,
    tp.amount::NUMERIC,
    tp.period,
    tp.due_date::DATE,
    tl.start_at                           AS lesson_start_at
  FROM public.tutor_payments tp
  JOIN public.tutor_students ts
    ON ts.id = tp.tutor_student_id
   AND ts.tutor_id = _tutor_id
  LEFT JOIN public.profiles pr
    ON pr.id = ts.student_id
  LEFT JOIN public.tutor_lessons tl
    ON tl.id = tp.lesson_id
  WHERE tp.status IN ('pending', 'overdue')
  ORDER BY
    COALESCE(tl.start_at, tp.due_date::TIMESTAMPTZ) DESC,
    pr.username ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_tutor_pending_payments_by_telegram(TEXT)
  TO service_role;

COMMENT ON FUNCTION public.get_tutor_pending_payments_by_telegram IS
  'Returns pending/overdue payments for tutor by Telegram ID. lesson_start_at = actual lesson date from tutor_lessons.';