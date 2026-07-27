create table if not exists public.web_vitals_samples (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  metric text not null check (metric in ('LCP', 'INP', 'CLS', 'TTFB', 'FCP')),
  value numeric(12, 4) not null check (value >= 0 and value < 3600000),
  rating text check (rating in ('good', 'needs-improvement', 'poor')),
  route text not null,
  device text not null check (device in ('mobile', 'desktop')),
  role text not null check (role in ('tutor', 'student', 'anon')),
  nav_type text,
  app_version text
);

comment on table public.web_vitals_samples is
  'Полевые Core Web Vitals (LCP/INP/CLS/TTFB/FCP). Service-role only, PII-free. '
  'Операционная телеметрия с retention — в отличие от append-only analytics_events. '
  'Этап 2 «работоспособный прод», 2026-07-26.';

create index if not exists idx_web_vitals_metric_time
  on public.web_vitals_samples (metric, occurred_at desc);
create index if not exists idx_web_vitals_route_time
  on public.web_vitals_samples (route, occurred_at desc);
create index if not exists idx_web_vitals_time
  on public.web_vitals_samples (occurred_at desc);

alter table public.web_vitals_samples enable row level security;
-- Policy НЕТ намеренно: RLS без policy = 0 строк для authenticated/anon.
-- Запись — только service_role (обходит RLS), чтение — только RPC ниже.

create or replace function public.admin_web_vitals_p75(
  p_days integer default 7,
  p_route text default null
)
returns table (
  metric   text,
  device   text,
  role     text,
  route    text,
  p75      numeric,
  p50      numeric,
  samples  bigint,
  good_share numeric
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null or not public.is_admin(auth.uid()) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;

  return query
  select
    s.metric,
    s.device,
    s.role,
    s.route,
    round(percentile_cont(0.75) within group (order by s.value::double precision)::numeric, 3) as p75,
    round(percentile_cont(0.50) within group (order by s.value::double precision)::numeric, 3) as p50,
    count(*)::bigint as samples,
    round(
      count(*) filter (where s.rating = 'good')::numeric
        / nullif(count(*), 0) * 100,
      1
    ) as good_share
  from public.web_vitals_samples s
  where s.occurred_at >= now() - make_interval(days => greatest(coalesce(p_days, 7), 1))
    and (p_route is null or s.route = p_route)
  group by s.metric, s.device, s.role, s.route
  order by s.metric, s.device, s.role, s.route;
end;
$$;

create or replace function public.admin_web_vitals_summary(p_days integer default 7)
returns table (
  metric   text,
  device   text,
  p75      numeric,
  p50      numeric,
  samples  bigint,
  good_share numeric
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null or not public.is_admin(auth.uid()) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;

  return query
  select
    s.metric,
    s.device,
    round(percentile_cont(0.75) within group (order by s.value::double precision)::numeric, 3) as p75,
    round(percentile_cont(0.50) within group (order by s.value::double precision)::numeric, 3) as p50,
    count(*)::bigint as samples,
    round(
      count(*) filter (where s.rating = 'good')::numeric
        / nullif(count(*), 0) * 100,
      1
    ) as good_share
  from public.web_vitals_samples s
  where s.occurred_at >= now() - make_interval(days => greatest(coalesce(p_days, 7), 1))
  group by s.metric, s.device
  order by s.metric, s.device;
end;
$$;

create or replace function public.admin_web_vitals_trend(
  p_metric text,
  p_days integer default 14
)
returns table (
  day      date,
  device   text,
  p75      numeric,
  samples  bigint
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null or not public.is_admin(auth.uid()) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;

  if p_metric is null or p_metric not in ('LCP', 'INP', 'CLS', 'TTFB', 'FCP') then
    raise exception 'BAD_METRIC' using errcode = '22023';
  end if;

  return query
  select
    ((s.occurred_at at time zone 'UTC') + interval '3 hours')::date as day,
    s.device,
    round(percentile_cont(0.75) within group (order by s.value::double precision)::numeric, 3) as p75,
    count(*)::bigint as samples
  from public.web_vitals_samples s
  where s.metric = p_metric
    and s.occurred_at >= now() - make_interval(days => greatest(coalesce(p_days, 14), 1))
  group by 1, 2
  order by 1, 2;
end;
$$;

grant execute on function public.admin_web_vitals_p75(integer, text) to authenticated, service_role;
revoke all on function public.admin_web_vitals_p75(integer, text) from public;
revoke all on function public.admin_web_vitals_p75(integer, text) from anon;

grant execute on function public.admin_web_vitals_summary(integer) to authenticated, service_role;
revoke all on function public.admin_web_vitals_summary(integer) from public;
revoke all on function public.admin_web_vitals_summary(integer) from anon;

grant execute on function public.admin_web_vitals_trend(text, integer) to authenticated, service_role;
revoke all on function public.admin_web_vitals_trend(text, integer) from public;
revoke all on function public.admin_web_vitals_trend(text, integer) from anon;

comment on function public.admin_web_vitals_p75(integer, text) is
  'Admin-only: p75/p50/доля good по Core Web Vitals, разрез metric×device×role×route. Вкладка /admin «Скорость».';
comment on function public.admin_web_vitals_summary(integer) is
  'Admin-only: общий p75 по метрике×устройству. Отдельно от _p75, потому что перцентили нельзя усреднять по маршрутам — общий считается из сырых значений.';
comment on function public.admin_web_vitals_trend(text, integer) is
  'Admin-only: тренд p75 одной метрики по МОСКОВСКИМ суткам (rule 101). Вкладка /admin «Скорость».';