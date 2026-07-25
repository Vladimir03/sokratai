-- ============================================================================
-- Наблюдаемость AI-шлюза: лог отказов + агрегатор расхода токенов (T0, 2026-07-25)
--
-- ПРИЧИНА (инцидент 24–25.07.2026): в Lovable стоял лимит 18 AI-кредитов/мес.
-- Он исчерпался, шлюз начал отбивать ВСЕ вызовы мгновенным HTTP-отказом
-- (18 проверок ДЗ подряд `CHECK_FAILED` / `gateway_error`, latency 220–550 мс).
-- Инцидент шёл 20+ часов и обнаружен репетитором, а не нами: `token_usage_logs`
-- пишет ТОЛЬКО успешные вызовы, поэтому исчерпание лимита не видно нигде, кроме
-- `hw_ai_check_events` (а она покрывает лишь проверку ДЗ — ни chat, ни загрузчик).
--
-- Что добавляется:
--   1. `ai_gateway_errors` — append-only лог отказов шлюза (PII-free).
--   2. `ai_gateway_error_log(...)` — единственный writer + атомарное решение
--      «пора алертить» (advisory-lock, чтобы параллельные isolate не спамили).
--   3. `ai_credit_usage_summary(...)` — SQL-агрегация расхода для TG-дайджеста.
--      Считать выборкой строк НЕЛЬЗЯ: PostgREST молча режет на 1000 строк
--      (в июле было 1150 вызовов) → дайджест занижал бы расход (rule 101).
-- ============================================================================

-- ─── 1. Лог отказов шлюза ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_gateway_errors (
  id           bigserial PRIMARY KEY,
  -- telemetryTag вызывающего пути (guided_check / kb_extract / mock_grade / …).
  source       text        NOT NULL,
  http_status  integer,              -- NULL = сетевой сбой / таймаут (HTTP не было)
  error_code   text,                 -- timeout | network | empty_response | invalid_json | http
  alert_sent   boolean     NOT NULL DEFAULT false,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_gateway_errors IS
  'Append-only лог отказов Lovable AI Gateway. PII-free: только источник, HTTP-статус и код. Тело ответа шлюза НЕ пишем — оно может нести фрагменты промпта / текст задачи (rule 40).';

CREATE INDEX IF NOT EXISTS idx_ai_gateway_errors_occurred
  ON public.ai_gateway_errors (occurred_at DESC);

ALTER TABLE public.ai_gateway_errors ENABLE ROW LEVEL SECURITY;
-- Политик нет намеренно: таблица service_role-only (клиенты видят 0 строк).
REVOKE ALL ON TABLE public.ai_gateway_errors FROM PUBLIC;
REVOKE ALL ON TABLE public.ai_gateway_errors FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ai_gateway_errors TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ai_gateway_errors_id_seq TO service_role;

-- ─── 2. Writer + атомарное решение об алерте ─────────────────────────────────
-- Возвращает true РОВНО ОДНОМУ вызывающему, когда (а) за 15 мин накопилось
-- >= 3 отказа и (б) за последний час алерт ещё не отправляли. Решение принимается
-- под advisory-lock: при массовом отказе шлюза десятки isolate вызывают функцию
-- одновременно, и без сериализации владелец получил бы пачку одинаковых алертов.
CREATE OR REPLACE FUNCTION public.ai_gateway_error_log(
  p_source      text,
  p_http_status integer DEFAULT NULL,
  p_error_code  text    DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id      bigint;
  v_recent  integer;
  v_alerted integer;
BEGIN
  INSERT INTO ai_gateway_errors (source, http_status, error_code)
  VALUES (left(COALESCE(NULLIF(btrim(p_source), ''), 'unknown'), 64),
          p_http_status,
          left(NULLIF(btrim(p_error_code), ''), 64))
  RETURNING id INTO v_id;

  PERFORM pg_advisory_xact_lock(hashtext('ai_gateway_alert'));

  SELECT count(*) INTO v_recent
    FROM ai_gateway_errors
   WHERE occurred_at > now() - interval '15 minutes';
  IF v_recent < 3 THEN
    RETURN false;
  END IF;

  SELECT count(*) INTO v_alerted
    FROM ai_gateway_errors
   WHERE alert_sent
     AND occurred_at > now() - interval '60 minutes';
  IF v_alerted > 0 THEN
    RETURN false;
  END IF;

  -- Метка ставится ДО фактической отправки: дубль алерта хуже пропуска
  -- (владелец и так увидит расход в ежедневном дайджесте).
  UPDATE ai_gateway_errors SET alert_sent = true WHERE id = v_id;
  RETURN true;
END;
$$;

-- rule 99: `REVOKE FROM PUBLIC` НЕДОСТАТОЧНО — Supabase грантит EXECUTE ролям
-- anon/authenticated напрямую. Отзываем явно (инцидент yookassa_record_refund).
REVOKE ALL ON FUNCTION public.ai_gateway_error_log(text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_gateway_error_log(text, integer, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_gateway_error_log(text, integer, text) TO service_role;

-- ─── 3. Агрегатор расхода для дайджеста ─────────────────────────────────────
-- Одним round-trip: расход за сутки, за МСК-месяц, разбивка по источникам
-- (для строки «Топ») и число отказов шлюза в тех же окнах.
CREATE OR REPLACE FUNCTION public.ai_credit_usage_summary(
  _month_start timestamptz,
  _day_start   timestamptz
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH month_rows AS (
    SELECT source, COALESCE(total_tokens, 0)::bigint AS tokens, created_at
      FROM token_usage_logs
     WHERE created_at >= _month_start
  )
  SELECT jsonb_build_object(
    'month', jsonb_build_object(
      'tokens', COALESCE((SELECT sum(tokens) FROM month_rows), 0),
      'calls',  COALESCE((SELECT count(*)   FROM month_rows), 0),
      'by_source', COALESCE((
        SELECT jsonb_agg(row_to_json(s) ORDER BY s.tokens DESC)
          FROM (
            SELECT COALESCE(source, 'unknown') AS source,
                   sum(tokens)::bigint         AS tokens,
                   count(*)::bigint            AS calls
              FROM month_rows
             GROUP BY 1
          ) s
      ), '[]'::jsonb)
    ),
    'day', jsonb_build_object(
      'tokens', COALESCE((SELECT sum(tokens) FROM month_rows WHERE created_at >= _day_start), 0),
      'calls',  COALESCE((SELECT count(*)   FROM month_rows WHERE created_at >= _day_start), 0)
    ),
    'errors_day',   COALESCE((SELECT count(*) FROM ai_gateway_errors WHERE occurred_at >= _day_start), 0),
    'errors_month', COALESCE((SELECT count(*) FROM ai_gateway_errors WHERE occurred_at >= _month_start), 0)
  );
$$;

REVOKE ALL ON FUNCTION public.ai_credit_usage_summary(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_credit_usage_summary(timestamptz, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_credit_usage_summary(timestamptz, timestamptz) TO service_role;

-- ─── 4. Однократный алерт «90% лимита» через идемпотентность дайджеста ──────
-- Переиспользуем `ceo_digest_log` (UNIQUE(mode, period_key)): mode
-- 'credit_alert', period_key = МСК-месяц 'YYYY-MM' → одно сообщение за месяц.
-- Отдельным сообщением, а не только строкой в дайджесте: жирную строку внутри
-- сводки легко пролистать, а этот алерт должен звонить.
ALTER TABLE public.ceo_digest_log DROP CONSTRAINT IF EXISTS ceo_digest_log_mode_check;
ALTER TABLE public.ceo_digest_log
  ADD CONSTRAINT ceo_digest_log_mode_check
  CHECK (mode IN ('weekly', 'daily', 'credit_alert'));

-- ─── 5. `message_kind = 'check_failed'` — сбой проверки ≠ реплика Сократа ────
-- Репорт Ульяны (24.07): сбой автопроверки приходил обычным пузырём Сократа,
-- и ученица приняла его за оценку своего ответа. Отдельный kind позволяет
-- клиенту отрисовать нейтральную системную плашку и посчитать подряд-неудачи,
-- не угадывая по тексту. Deploy-skew безопасен: старый бандл отрисует такое
-- сообщение как обычную реплику (прежнее поведение).
ALTER TABLE public.homework_tutor_thread_messages
  DROP CONSTRAINT IF EXISTS homework_tutor_thread_messages_message_kind_check;
ALTER TABLE public.homework_tutor_thread_messages
  ADD CONSTRAINT homework_tutor_thread_messages_message_kind_check
    CHECK (
      message_kind IS NULL OR message_kind IN (
        'answer','hint_request','question','bootstrap','ai_reply','system',
        'check_result','hint_reply','tutor_message','tutor_note','submission',
        'check_failed'
      )
    );
