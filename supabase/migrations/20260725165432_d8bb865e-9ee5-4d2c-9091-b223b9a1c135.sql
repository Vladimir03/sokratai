CREATE TABLE IF NOT EXISTS public.ai_gateway_errors (
  id           bigserial PRIMARY KEY,
  source       text        NOT NULL,
  http_status  integer,
  error_code   text,
  alert_sent   boolean     NOT NULL DEFAULT false,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_gateway_errors IS
  'Append-only лог отказов Lovable AI Gateway. PII-free: только источник, HTTP-статус и код. Тело ответа шлюза НЕ пишем — оно может нести фрагменты промпта / текст задачи (rule 40).';

CREATE INDEX IF NOT EXISTS idx_ai_gateway_errors_occurred
  ON public.ai_gateway_errors (occurred_at DESC);

ALTER TABLE public.ai_gateway_errors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_gateway_errors FROM PUBLIC;
REVOKE ALL ON TABLE public.ai_gateway_errors FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ai_gateway_errors TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ai_gateway_errors_id_seq TO service_role;

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

  UPDATE ai_gateway_errors SET alert_sent = true WHERE id = v_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_gateway_error_log(text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_gateway_error_log(text, integer, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_gateway_error_log(text, integer, text) TO service_role;

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

ALTER TABLE public.ceo_digest_log DROP CONSTRAINT IF EXISTS ceo_digest_log_mode_check;
ALTER TABLE public.ceo_digest_log
  ADD CONSTRAINT ceo_digest_log_mode_check
  CHECK (mode IN ('weekly', 'daily', 'credit_alert'));

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