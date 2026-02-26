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
  due_date          DATE
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
    tp.id                                           AS payment_id,
    tp.tutor_student_id,
    COALESCE(pr.username, 'Ученик')::TEXT           AS student_name,
    tp.amount,
    tp.period,
    tp.due_date::DATE
  FROM public.tutor_payments tp
  JOIN public.tutor_students ts
    ON ts.id = tp.tutor_student_id
   AND ts.tutor_id = _tutor_id
  LEFT JOIN public.profiles pr
    ON pr.id = ts.student_id
  WHERE tp.status IN ('pending', 'overdue')
  ORDER BY tp.due_date ASC NULLS LAST, pr.username ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_tutor_pending_payments_by_telegram(TEXT)
  TO service_role;