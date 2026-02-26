-- =============================================
-- Mobile Payment Marking: bot-facing RPCs
-- Allows tutors to list and mark pending payments
-- via Telegram bot without needing the web cabinet.
-- =============================================

-- ─── RPC 1: get_tutor_pending_payments_by_telegram ──────────────────
CREATE OR REPLACE FUNCTION public.get_tutor_pending_payments_by_telegram(
  _telegram_id TEXT
)
RETURNS TABLE (
  payment_id        UUID,
  tutor_student_id  UUID,
  student_name      TEXT,
  amount            INTEGER,
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

COMMENT ON FUNCTION public.get_tutor_pending_payments_by_telegram IS
  'Returns pending/overdue payments for tutor identified by Telegram ID. Used by /pay command in bot.';

-- ─── RPC 2: mark_payment_as_paid_by_telegram ────────────────────────
CREATE OR REPLACE FUNCTION public.mark_payment_as_paid_by_telegram(
  _payment_id  UUID,
  _telegram_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tutor_id     UUID;
  _rows_updated INT;
BEGIN
  SELECT id INTO _tutor_id
  FROM public.tutors
  WHERE telegram_id = _telegram_id
  LIMIT 1;

  IF _tutor_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.tutor_payments tp
  SET
    status     = 'paid',
    paid_at    = CASE WHEN tp.status != 'paid' THEN NOW() ELSE tp.paid_at END,
    updated_at = NOW()
  FROM public.tutor_students ts
  WHERE tp.id               = _payment_id
    AND tp.tutor_student_id = ts.id
    AND ts.tutor_id         = _tutor_id
    AND tp.status           IN ('pending', 'overdue', 'paid');

  GET DIAGNOSTICS _rows_updated = ROW_COUNT;
  RETURN _rows_updated > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_payment_as_paid_by_telegram(UUID, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.mark_payment_as_paid_by_telegram IS
  'Marks a payment as paid, verifying tutor ownership via Telegram ID. Idempotent. Used by /pay bot flow.';