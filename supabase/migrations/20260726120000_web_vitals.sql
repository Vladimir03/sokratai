-- ============================================================================
-- Core Web Vitals — полевые замеры скорости (Этап 2 «работоспособный прод»)
-- ============================================================================
-- ЗАЧЕМ: в репозитории не было НИ ОДНОЙ точки измерения скорости
-- (`web-vitals`/`PerformanceObserver` — ноль вхождений). Любая оптимизация до
-- этого была угадыванием, а Lighthouse тем более не показал бы реальность:
-- узкое место — РФ-DPI и кросс-граничный хоп до api.sokratai.ru, чего
-- лаборатория не воспроизводит. Нужны ПОЛЕВЫЕ метрики с реальных устройств.
--
-- ПОЧЕМУ ОТДЕЛЬНАЯ ТАБЛИЦА, а не analytics_events (спека предполагала её):
--   1. analytics_events документирована APPEND-ONLY («строки не UPDATE/DELETE»)
--      — там лежат вехи воронки, которые нельзя переписывать. Виталы же
--      операционные и естественно устаревают: им нужен retention. Положить их
--      туда = либо неограниченный рост, либо нарушение инварианта соседа.
--   2. Объём несопоставим: ~5 строк на КАЖДЫЙ pageview против «одна веха на
--      репетитора за всю жизнь». Виталы задавили бы таблицу на порядки.
--   3. Форма запросов другая: перцентили по числовому полю, а не перечисление
--      событий — нужны свои индексы (route/device/occurred_at).
-- Проверено, что дело НЕ в поломке существующих запросов: все читатели
-- analytics_events фильтруют по event_name на индексе (event_name, occurred_at).
--
-- Инварианты:
--   • PII-free by design: ни свободного текста, ни идентификаторов пользователя.
--     Маршрут санитизирован на edge (_shared/sanitize-route.ts), роль и
--     устройство — категориальные. По строке НЕЛЬЗЯ узнать, кто это был.
--   • Пишет только service_role через edge `web-vitals-report`; RLS включён
--     без policy → authenticated/anon получают 0 строк.
--   • Читается только админом через SECURITY DEFINER RPC (агрегаты, не строки).
-- ============================================================================

create table if not exists public.web_vitals_samples (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),

  -- метрика и значение
  metric text not null check (metric in ('LCP', 'INP', 'CLS', 'TTFB', 'FCP')),
  -- CLS безразмерен (доли), остальные — миллисекунды. Единицу задаёт metric,
  -- поэтому храним одним числовым полем и НЕ смешиваем метрики в агрегатах.
  value numeric(12, 4) not null check (value >= 0 and value < 3600000),
  -- порог web.dev на момент замера: good | needs-improvement | poor.
  -- Храним ответ библиотеки, а не пересчитываем — пороги могут измениться,
  -- и тогда исторические строки останутся честными для своего времени.
  rating text check (rating in ('good', 'needs-improvement', 'poor')),

  -- стратификация (всё категориальное, PII-free)
  route text not null,                 -- санитизирован на edge
  device text not null check (device in ('mobile', 'desktop')),
  role text not null check (role in ('tutor', 'student', 'anon')),
  -- navigate | reload | back-forward | back-forward-cache | prerender | restore |
  -- soft-navigation (полный набор web-vitals v6). bfcache-восстановления важно
  -- уметь отделить: у них метрики искусственно прекрасные.
  nav_type text,
  app_version text                     -- хэш entry-чанка: связать просадку с релизом
);

comment on table public.web_vitals_samples is
  'Полевые Core Web Vitals (LCP/INP/CLS/TTFB/FCP). Service-role only, PII-free. '
  'Операционная телеметрия с retention — в отличие от append-only analytics_events. '
  'Этап 2 «работоспособный прод», 2026-07-26.';

-- Основной паттерн чтения: «метрика за период, сгруппировать по route/device/role».
create index if not exists idx_web_vitals_metric_time
  on public.web_vitals_samples (metric, occurred_at desc);
-- Тренд по дням внутри одного маршрута.
create index if not exists idx_web_vitals_route_time
  on public.web_vitals_samples (route, occurred_at desc);
-- Отдельно по времени: durable анти-abuse кап в edge считает COUNT за минуту
-- БЕЗ фильтра по metric/route, и без этого индекса он деградировал бы в
-- seq scan по всей таблице на КАЖДОМ запросе — то есть защита от нагрузки
-- сама стала бы нагрузкой.
create index if not exists idx_web_vitals_time
  on public.web_vitals_samples (occurred_at desc);

alter table public.web_vitals_samples enable row level security;
-- Policy НЕТ намеренно: RLS без policy = 0 строк для authenticated/anon.
-- Запись — только service_role (обходит RLS), чтение — только RPC ниже.

-- ============================================================================
-- Чтение: только агрегаты, только админу
-- ============================================================================
-- Отдаём перцентили, а не строки: /admin нужен p75, а не выгрузка замеров.
-- p75 — канонический порог Core Web Vitals (web.dev), считаем ИМЕННО его.

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
    -- Доля «good» — второй, независимый взгляд: p75 может быть в пороге, но
    -- с длинным хвостом, который и есть жалобы пользователей.
    round(
      count(*) filter (where s.rating = 'good')::numeric
        / nullif(count(*), 0) * 100,
      1
    ) as good_share
  from public.web_vitals_samples s
  where s.occurred_at >= now() - make_interval(days => greatest(coalesce(p_days, 7), 1))
    and (p_route is null or s.route = p_route)
  group by s.metric, s.device, s.role, s.route
  -- Порядок детерминированный: без него страницы «плавают» между запросами.
  order by s.metric, s.device, s.role, s.route;
end;
$$;

-- Сводка по метрике×устройству — ОТДЕЛЬНАЯ функция, а не свёртка на клиенте.
--
-- ⚠️ ПЕРЦЕНТИЛИ НЕЛЬЗЯ УСРЕДНЯТЬ. Взять p75 по каждому маршруту и усреднить
-- (хоть с весами по числу замеров) — арифметически неверно: получится число,
-- которое не является ничьим перцентилем. Разница не косметическая: редкий
-- тяжёлый маршрут либо исчезает из общей картины, либо, наоборот, задирает её.
-- Поэтому общий p75 считается ИЗ СЫРЫХ значений, здесь, в БД.
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

-- Тренд по дням в МОСКОВСКИХ сутках (rule 101: все календарные бакеты — МСК,
-- UTC+3 без DST). Иначе полночь 15-го в МСК попадает в 14-е UTC и весь
-- диапазон уезжает на день.
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

-- Гранты: читают только залогиненные (внутри — гард is_admin), пишет service_role.
-- ТРОЙНОЙ порядок обязателен (rule 99): сначала GRANT, потом REVOKE FROM PUBLIC,
-- потом явный REVOKE FROM anon — Supabase грантит anon НАПРЯМУЮ, и одного
-- `REVOKE FROM PUBLIC` недостаточно (инцидент yookassa_record_refund).
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
