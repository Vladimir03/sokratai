-- ============================================================================
-- Health-check прода — состояние и дисциплина алертов (Этап 2)
-- ============================================================================
-- ЗАЧЕМ: мониторинга не было ВООБЩЕ. Единственной проверкой был `curl` в конце
-- деплоя — то есть узнать о поломке можно было только если она случилась в
-- момент выкладки. Реальные инциденты приходили скриншотами в Telegram через
-- ДНИ (Safari-краш Глеба), а boot-crash `lesson-materials-api` держал прод
-- сломанным ~5 дней (rule 98).
--
-- ЧТО ПРОВЕРЯЕМ — ровно те отказы, которые у нас БЫЛИ, а не абстрактный uptime:
--   • shell — sokratai.ru отдаёт 200 И entry-чанк из его index.html тоже 200.
--     Второе — прямая канарейка на белые экраны: именно пропавший чанк был
--     корнем инцидента (rule 95). Обычный ping главной этого НЕ ловит.
--   • edge — OPTIONS на критичной функции не отдаёт 503. 503 на OPTIONS = Deno
--     link-fail при загрузке модуля, то есть функция мертва на ВСЕХ роутах
--     (rule 98; 401 = жива, 404 = не задеплоена).
--
-- ДИСЦИПЛИНА АЛЕРТОВ (главное; шумный алерт = выключённый алерт):
--   • алерт только на ПЕРЕХОДЕ здоров→сломан, не на каждом прогоне;
--   • нужно ДВА подряд провала — РФ-DPI роняет одиночные запросы, и одиночный
--     сбой не должен будить (тот же урок, что tiered-статус кабинета, rule 95);
--   • восстановление сообщается ОДИН раз — иначе непонятно, чинилось ли вообще.
-- ============================================================================

create table if not exists public.health_check_state (
  -- 'shell' | 'edge' — ключ проверки, не автоинкремент: строк ровно столько,
  -- сколько проверок, и upsert по ключу делает функцию идемпотентной.
  check_key text primary key,
  status text not null default 'unknown' check (status in ('ok', 'failing', 'unknown')),
  consecutive_failures integer not null default 0,
  last_ok_at timestamptz,
  last_failure_at timestamptz,
  -- Когда в последний раз ОТПРАВИЛИ алерт. NULL = пользователь не потревожен.
  last_alert_at timestamptz,
  last_detail text,
  updated_at timestamptz not null default now()
);

comment on table public.health_check_state is
  'Состояние health-check прода. Хранит счётчик подряд идущих провалов, чтобы '
  'алертить на ПЕРЕХОДЕ и только после двух провалов подряд (одиночный сбой = DPI). '
  'Этап 2 «работоспособный прод», 2026-07-26.';

alter table public.health_check_state enable row level security;
-- Policy НЕТ: пишет и читает только service_role (edge `health-check`).
revoke all on table public.health_check_state from anon, authenticated;

-- ============================================================================
-- Расписание: каждые 5 минут
-- ============================================================================
-- 5 минут + порог «два провала подряд» = поломку замечаем максимум за ~10 минут
-- против нынешних ДНЕЙ. Целевой MTTD из спеки — < 1 часа, запас есть.
--
-- URL — прямой `*.supabase.co`, а НЕ api.sokratai.ru, и это осознанно:
-- вызов идёт server-side из Postgres (не из браузера в РФ), а лишний хоп через
-- наш же VPS сделал бы health-check зависимым от того самого узла, за здоровьем
-- которого он следит. Тот же паттерн, что у существующего
-- `tutor-plan-expiry-reminder-daily` (миграция 20260702172106).
-- Аутентификация вызывающего — verbatim паттерн `tutor-plan-expiry-reminder`
-- (миграция 20260702172106): секрет лежит в vault, функция сверяет его с
-- `SCHEDULER_SECRET` и отдаёт 401 всем остальным. `verify_jwt = false`.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  perform cron.unschedule('health-check-5min');
exception when others then null;
end $$;

select cron.schedule(
  'health-check-5min',
  '*/5 * * * *',
  $cmd$
  select net.http_post(
    url := 'https://vrsseotrfmsxpbciyqzc.supabase.co/functions/v1/health-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SCHEDULER_SECRET' limit 1)
    ),
    body := '{}'::jsonb
  );
  $cmd$
);
