-- Tutor self-serve YooKassa payment (2026-07-02, решение Vladimir).
--
-- Колонка `plan` различает назначение платежа в общей таблице payments:
--   NULL              = legacy student Premium (699₽ / 30 дней) — все существующие строки;
--   'tutor_ai_start'  = тариф репетитора AI-старт (цена переменная: 200₽ первая
--                       оплата, дальше 1000₽/2000₽ по числу активных учеников —
--                       цену считает СЕРВЕР в yookassa-create-payment).
--
-- ⚠️ ДЕПЛОЙ-ПОРЯДОК (rule 95): эта миграция ОБЯЗАНА примениться ДО деплоя
-- обновлённых yookassa-create-payment / yookassa-webhook — webhook SELECTит
-- `plan`; без колонки валидация падала бы для ВСЕХ платежей (включая
-- ученические) и молча осиротила бы успешные оплаты.
--
-- RLS/GRANT не трогаем: обе edge-функции работают под service_role
-- ("Service role can manage all payments" FOR ALL, миграция 20251222120000).

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS plan text;

COMMENT ON COLUMN public.payments.plan IS
  'NULL = legacy student Premium (699/30d). tutor_ai_start = tutor plan (variable price, server-resolved).';

-- «Первая ли это оплата тарифа репетитора» — lookup в create-payment.
CREATE INDEX IF NOT EXISTS idx_payments_user_plan_status
  ON public.payments (user_id, plan, status)
  WHERE plan IS NOT NULL;
