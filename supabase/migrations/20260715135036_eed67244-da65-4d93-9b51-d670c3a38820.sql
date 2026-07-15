-- ============================================================================
-- Учёт возвратов YooKassa (ревью ChatGPT-5.6, находка P1 #4, 2026-07-15).
-- ============================================================================

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS refunded_amount DECIMAL(10, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.payments.refunded_amount IS
  'Сумма УСПЕШНЫХ возвратов (пересчитывается из payment_refunds через yookassa_record_refund). Выручка = amount - refunded_amount. status при возврате НЕ меняется.';

CREATE TABLE IF NOT EXISTS public.payment_refunds (
  id            TEXT PRIMARY KEY,
  payment_id    TEXT NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  amount        DECIMAL(10, 2) NOT NULL CHECK (amount > 0),
  currency      TEXT NOT NULL DEFAULT 'RUB',
  status        TEXT NOT NULL,
  webhook_data  JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_refunds_payment_id
  ON public.payment_refunds (payment_id);

COMMENT ON TABLE public.payment_refunds IS
  'Возвраты YooKassa, append-only. PK = refund id → повторный вебхук идемпотентен. Пишет только yookassa_record_refund (service_role).';

ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_refunds FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.yookassa_record_refund(
  p_refund_id  TEXT,
  p_payment_id TEXT,
  p_amount     NUMERIC,
  p_status     TEXT,
  p_webhook    JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment RECORD;
  v_total   NUMERIC;
BEGIN
  SELECT id, amount
    INTO v_payment
    FROM public.payments
   WHERE id = p_payment_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'PAYMENT_NOT_FOUND');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'INVALID_AMOUNT');
  END IF;

  INSERT INTO public.payment_refunds (id, payment_id, amount, status, webhook_data)
  VALUES (p_refund_id, p_payment_id, p_amount, p_status, p_webhook)
  ON CONFLICT (id) DO NOTHING;

  SELECT COALESCE(SUM(amount), 0)
    INTO v_total
    FROM public.payment_refunds
   WHERE payment_id = p_payment_id
     AND status = 'succeeded';

  UPDATE public.payments
     SET refunded_amount = v_total,
         updated_at = now()
   WHERE id = p_payment_id;

  RETURN jsonb_build_object(
    'recorded', true,
    'refunded_amount', v_total,
    'payment_amount', v_payment.amount,
    'fully_refunded', v_total >= v_payment.amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.yookassa_record_refund(TEXT, TEXT, NUMERIC, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.yookassa_record_refund(TEXT, TEXT, NUMERIC, TEXT, JSONB) TO service_role;

COMMENT ON FUNCTION public.yookassa_record_refund(TEXT, TEXT, NUMERIC, TEXT, JSONB) IS
  'Идемпотентно записывает возврат YooKassa и пересчитывает payments.refunded_amount.';