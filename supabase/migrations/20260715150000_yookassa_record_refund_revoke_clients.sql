-- ============================================================================
-- Hardening: явный REVOKE EXECUTE у anon/authenticated на yookassa_record_refund.
--
-- Миграция 20260715130000 сделала только `REVOKE ... FROM PUBLIC` — этого
-- НЕДОСТАТОЧНО на Supabase: default privileges схемы public грантят EXECUTE
-- ролям anon/authenticated НАПРЯМУЮ (не через PUBLIC), и прямой грант REVOKE
-- FROM PUBLIC не снимает. Подтверждено PostgREST-пробой 2026-07-15: RPC
-- исполнилась под anon-ключом ({"recorded": false, "reason":
-- "PAYMENT_NOT_FOUND"}). Дыра: клиент, знающий id платежа (свои видны через
-- RLS payments), мог фабриковать строки payment_refunds и завышать
-- refunded_amount → занижение MRR (аналитика; денег не двигает).
--
-- Правильный паттерн — как у yookassa_activate_subscription
-- (20260702150000:118-120): PUBLIC + anon + authenticated явно.
-- Для сравнения: та RPC под anon-пробой корректно даёт 42501.
-- ============================================================================

REVOKE ALL ON FUNCTION public.yookassa_record_refund(TEXT, TEXT, NUMERIC, TEXT, JSONB)
  FROM anon, authenticated;

-- service_role сохраняет EXECUTE (грант из 20260715130000 не тронут).
