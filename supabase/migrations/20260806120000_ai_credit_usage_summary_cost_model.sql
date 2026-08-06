-- ============================================================================
-- `ai_credit_usage_summary`: отдаём РАЗДЕЛЬНО prompt/completion токены (2026-08-06)
--
-- ПРИЧИНА. Дайджест считал кредиты плоским коэффициентом «293к токенов = 1
-- кредит», откалиброванным в июле. Коэффициент неверен по устройству: выход
-- стоит в 6 раз дороже входа ($3.00 против $0.50 за 1М у gemini-3-flash), и как
-- только доля выхода поехала (загрузчик задач: 11% токенов в июле → 18% в
-- августе), оценка поплыла вниз. Сверка с дашбордом Lovable 06.08:
--   плоская модель  → 9,4 кредита   (занижение на 20%)
--   по себестоимости → 11,7 кредита
--   ФАКТ у Lovable   → 11,8 кредита
--
-- Точная формула (сошлась на четырёх независимых точках дашборда — 5 авг, 6 авг,
-- август-к-дате, последние 30 дней; расхождение ≤0,7%):
--   кредиты = (prompt_М × $0.50 + completion_М × $3.00) / $0.25
-- То есть шлюз Lovable перепродаёт Gemini РОВНО по прайсу Google, наценка ≈1,00×
-- (в комментариях кода раньше стояло 2,2× — это была ошибка: за прайс приняли
-- batch-тариф со скидкой 50%).
--
-- Чтобы считать так, дайджесту нужен раздельный prompt/completion — его и
-- добавляем. Совместимость: старые ключи (`tokens`, `calls`) остаются на месте,
-- поэтому edge, уехавший РАНЬШЕ этой миграции, продолжает работать по-старому
-- (AGENTS.md: порядок деплоя миграция↔функция не гарантирован).
-- ============================================================================

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
    SELECT source,
           COALESCE(total_tokens, 0)::bigint      AS tokens,
           COALESCE(prompt_tokens, 0)::bigint     AS prompt_tokens,
           COALESCE(completion_tokens, 0)::bigint AS completion_tokens,
           created_at
      FROM token_usage_logs
     WHERE created_at >= _month_start
  )
  SELECT jsonb_build_object(
    'month', jsonb_build_object(
      'tokens',            COALESCE((SELECT sum(tokens)            FROM month_rows), 0),
      'prompt_tokens',     COALESCE((SELECT sum(prompt_tokens)     FROM month_rows), 0),
      'completion_tokens', COALESCE((SELECT sum(completion_tokens) FROM month_rows), 0),
      'calls',             COALESCE((SELECT count(*)               FROM month_rows), 0),
      'by_source', COALESCE((
        SELECT jsonb_agg(row_to_json(s) ORDER BY s.tokens DESC)
          FROM (
            SELECT COALESCE(source, 'unknown')  AS source,
                   sum(tokens)::bigint          AS tokens,
                   sum(prompt_tokens)::bigint   AS prompt_tokens,
                   sum(completion_tokens)::bigint AS completion_tokens,
                   count(*)::bigint             AS calls
              FROM month_rows
             GROUP BY 1
          ) s
      ), '[]'::jsonb)
    ),
    'day', jsonb_build_object(
      'tokens',            COALESCE((SELECT sum(tokens)            FROM month_rows WHERE created_at >= _day_start), 0),
      'prompt_tokens',     COALESCE((SELECT sum(prompt_tokens)     FROM month_rows WHERE created_at >= _day_start), 0),
      'completion_tokens', COALESCE((SELECT sum(completion_tokens) FROM month_rows WHERE created_at >= _day_start), 0),
      'calls',             COALESCE((SELECT count(*)               FROM month_rows WHERE created_at >= _day_start), 0)
    ),
    'errors_day',   COALESCE((SELECT count(*) FROM ai_gateway_errors WHERE occurred_at >= _day_start), 0),
    'errors_month', COALESCE((SELECT count(*) FROM ai_gateway_errors WHERE occurred_at >= _month_start), 0)
  );
$$;

REVOKE ALL ON FUNCTION public.ai_credit_usage_summary(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_credit_usage_summary(timestamptz, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_credit_usage_summary(timestamptz, timestamptz) TO service_role;
