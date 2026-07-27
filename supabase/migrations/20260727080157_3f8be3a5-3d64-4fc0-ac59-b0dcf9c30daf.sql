create table if not exists public.health_check_state (
  check_key text primary key,
  status text not null default 'unknown' check (status in ('ok', 'failing', 'unknown')),
  consecutive_failures integer not null default 0,
  last_ok_at timestamptz,
  last_failure_at timestamptz,
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