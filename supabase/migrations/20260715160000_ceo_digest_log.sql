-- ============================================================================
-- Журнал отправок CEO-дайджеста (Stage 2 CEO-аналитики, spec
-- docs/delivery/features/ceo-analytics/spec.md).
--
-- Идемпотентность: UNIQUE(mode, period_key) — ручной повторный запуск /
-- дубль cron-тика не шлёт дайджест второй раз (edge делает insert-first:
-- ON CONFLICT DO NOTHING → 0 строк = уже отправлен, выходим молча).
-- period_key: daily = МСК-дата 'YYYY-MM-DD', weekly = МСК-дата понедельника.
--
-- Клиентам таблица не нужна: RLS без политик + REVOKE (зеркало
-- analytics_events) — пишет/читает только edge под service_role.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ceo_digest_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mode        TEXT NOT NULL CHECK (mode IN ('weekly', 'daily')),
  period_key  TEXT NOT NULL,
  -- 'sent' | 'empty' (daily без событий — не слали, но период обработан)
  outcome     TEXT NOT NULL DEFAULT 'sent',
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mode, period_key)
);

ALTER TABLE public.ceo_digest_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ceo_digest_log FROM anon, authenticated;
-- service_role сохраняет полный доступ неявно.

COMMENT ON TABLE public.ceo_digest_log IS
  'Идемпотентность CEO-дайджеста (edge ceo-telegram-digest): одна отправка на (mode, period_key).';
