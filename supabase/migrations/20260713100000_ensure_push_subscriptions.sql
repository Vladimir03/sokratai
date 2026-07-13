-- ============================================================================
-- Создание push_subscriptions (баг: таблицы НЕТ на живой БД, 2026-07-13)
-- ============================================================================
-- Диагностика (PostgREST): GET /rest/v1/push_subscriptions → PGRST205
-- «Could not find the table 'public.push_subscriptions'». Оригинальная миграция
-- 20260327120000_push_subscriptions.sql в репо есть, но на проекте НЕ применена
-- (предшествует baseline'у Lovable) → push НИКОГДА не работал end-to-end:
-- push-subscribe падал на upsert в несуществующую таблицу (500 «Failed to save
-- subscription») → подписки не сохранялись → сервер не находил их → каскад уходил
-- в telegram/email на ВСЕХ push-путях (чат + уведомления о ДЗ).
--
-- Идемпотентно (IF NOT EXISTS / DROP+CREATE) — безопасно и если таблица уже есть.
-- Схема и UNIQUE(user_id,endpoint) обязаны совпадать с upsert'ом push-subscribe
-- (onConflict "user_id,endpoint") и SELECT'ами push-sender.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);

-- UNIQUE(user_id, endpoint) — обязателен для upsert onConflict; отдельным
-- индексом с IF NOT EXISTS (constraint нельзя IF NOT EXISTS).
CREATE UNIQUE INDEX IF NOT EXISTS uq_push_subscriptions_user_endpoint
  ON public.push_subscriptions (user_id, endpoint);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id
  ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- RLS: пользователь читает/пишет/удаляет только свои строки. Запись из
-- push-subscribe идёт под service_role (bypass RLS) — политики для клиента.
DROP POLICY IF EXISTS push_sub_select ON public.push_subscriptions;
CREATE POLICY push_sub_select ON public.push_subscriptions
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS push_sub_insert ON public.push_subscriptions;
CREATE POLICY push_sub_insert ON public.push_subscriptions
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS push_sub_delete ON public.push_subscriptions;
CREATE POLICY push_sub_delete ON public.push_subscriptions
  FOR DELETE USING (user_id = auth.uid());
