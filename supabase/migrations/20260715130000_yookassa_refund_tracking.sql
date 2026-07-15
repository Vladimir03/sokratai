-- ============================================================================
-- Учёт возвратов YooKassa (ревью ChatGPT-5.6, находка P1 #4, 2026-07-15).
--
-- ПРОБЛЕМА: yookassa-webhook резолвил платёж по `body.object.id`, но у события
-- `refund.succeeded` там ID ВОЗВРАТА, а платёж — в `object.payment_id`. Возврат
-- падал в ветку «Payment not found — possible forged webhook», и исходная
-- оплата НАВСЕГДА оставалась status='succeeded' → возвращённые деньги
-- считались выручкой (MRR Пульса `_shared/ceo-pulse.ts::mrrAt`, admin-статистика).
--
-- МОДЕЛЬ (append-only, зеркало конвенции ledger rule 60):
--   * возврат = отдельная строка `payment_refunds`, PK = YooKassa refund id →
--     повторная доставка вебхука идемпотентна BY CONSTRUCTION (ON CONFLICT
--     DO NOTHING), частичных возвратов на один платёж может быть несколько;
--   * `payments.refunded_amount` — денормализованная сумма УСПЕШНЫХ возвратов,
--     ПЕРЕСЧИТЫВАЕТСЯ из `payment_refunds` (НЕ инкремент: дубль не задвоит);
--   * запись — только через SECURITY DEFINER RPC под service_role (multi-query
--     из edge не воспроизводить — конвенция rule 40/60).
--
-- РЕШЕНИЕ ПО STATUS: `payments.status` НЕ переписывается на 'refunded'.
-- Частичный возврат ≠ отмена, платёж состоялся. Потребители считают
-- net = amount − refunded_amount (см. `mrrAt`). Это сохраняет семантику
-- `yookassa-create-payment` (интро-цена 200₽ определяется наличием
-- succeeded-оплат) — менять её = отдельное продуктовое решение владельца.
--
-- Аддитивно: новая колонка с DEFAULT 0 + новая таблица. Существующие строки
-- получают refunded_amount = 0 → поведение до этой миграции сохраняется.
-- ============================================================================

-- ── 1. Денормализованная сумма возвратов на платеже ─────────────────────────
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS refunded_amount DECIMAL(10, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.payments.refunded_amount IS
  'Сумма УСПЕШНЫХ возвратов (пересчитывается из payment_refunds через yookassa_record_refund). Выручка = amount - refunded_amount. status при возврате НЕ меняется.';

-- ── 2. Append-only журнал возвратов ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_refunds (
  id            TEXT PRIMARY KEY,                 -- YooKassa refund id (идемпотентность)
  payment_id    TEXT NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  amount        DECIMAL(10, 2) NOT NULL CHECK (amount > 0),
  currency      TEXT NOT NULL DEFAULT 'RUB',
  status        TEXT NOT NULL,                    -- статус из YooKassa API (не из body)
  webhook_data  JSONB,                            -- сырой body для диагностики
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_refunds_payment_id
  ON public.payment_refunds (payment_id);

COMMENT ON TABLE public.payment_refunds IS
  'Возвраты YooKassa, append-only. PK = refund id → повторный вебхук идемпотентен. Пишет только yookassa_record_refund (service_role).';

-- RLS: клиентам не нужен (Пульс/админка читают через service_role edge).
-- Политик нет → anon/authenticated видят 0 строк (зеркало analytics_events).
ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_refunds FROM anon, authenticated;
-- service_role сохраняет полный доступ неявно.

-- ── 3. Атомарная запись возврата ────────────────────────────────────────────
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
  -- Лочим платёж: несколько частичных возвратов (или дубли вебхука)
  -- сериализуются, пересчёт суммы видит консистентный набор строк.
  SELECT id, amount
    INTO v_payment
    FROM public.payments
   WHERE id = p_payment_id
   FOR UPDATE;

  IF NOT FOUND THEN
    -- Платежа нет в нашей базе (чужой магазин / строка не создавалась).
    -- Не ретраить — вызывающий вернёт 200.
    RETURN jsonb_build_object('recorded', false, 'reason', 'PAYMENT_NOT_FOUND');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'INVALID_AMOUNT');
  END IF;

  INSERT INTO public.payment_refunds (id, payment_id, amount, status, webhook_data)
  VALUES (p_refund_id, p_payment_id, p_amount, p_status, p_webhook)
  ON CONFLICT (id) DO NOTHING;

  -- Пересчёт ИЗ ИСТОЧНИКА (не инкремент): повторная доставка того же возврата
  -- даёт ту же сумму. Считаем только успешные возвраты.
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
  'Идемпотентно записывает возврат YooKassa и пересчитывает payments.refunded_amount. Вызывается только из edge yookassa-webhook после верификации возврата в YooKassa API.';
