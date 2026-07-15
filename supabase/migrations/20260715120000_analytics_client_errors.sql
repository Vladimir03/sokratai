-- ============================================================================
-- Наблюдаемость клиентских крашей — event 'client_error' + админ-RPC
-- ============================================================================
-- Контекст (2026-07-15, инцидент Глеба): о белых экранах ErrorBoundary мы
-- узнавали по скриншотам в Telegram через дни. Теперь ErrorBoundary /
-- MarkdownErrorBoundary шлют PII-free репорт через edge `client-error-report`
-- → analytics_events (service_role writer, как вся воронка).
--
-- ОСОЗНАННОЕ ИСКЛЮЧЕНИЕ из «meta без свободного текста» (решение Vladimir
-- 2026-07-15): meta.message несёт ТЕХНИЧЕСКИЙ текст ошибки (усечён до 400
-- симв. на edge). Route санитизируется на edge (query отбрасывается, длинные
-- hex/uuid-сегменты → ':id' — чтобы claim-токены /c/{token} не утекали в
-- аналитику). Имена/email/пользовательские тексты сюда не попадают.
--
-- Смотреть: /admin → вкладка «Ошибки» (RPC ниже) или SQL:
--   select occurred_at, source, meta->>'route' as route, meta->>'message' as message
--   from analytics_events where event_name = 'client_error'
--   order by occurred_at desc limit 100;
-- ============================================================================

alter table public.analytics_events
  drop constraint if exists analytics_events_event_name_check;

alter table public.analytics_events
  add constraint analytics_events_event_name_check check (event_name in (
    -- репетитор (онбординг v2)
    'tutor_first_student_added',
    'invite_generated',
    'tutor_first_homework_created',
    'homework_sent_to_student',
    'student_received_and_opened',
    -- ученик (онбординг v2)
    'invite_claimed',
    'student_first_login',
    'student_registered',
    'student_first_homework_opened',
    'student_first_submission',
    -- воронка оплаты тарифа репетитора (round 3, 2026-07-02)
    'tutor_payment_created',
    'tutor_payment_succeeded',
    -- демо-разбор (v2.1 W1, 2026-07-08)
    'tutor_demo_check_viewed',
    'tutor_demo_check_ran',
    -- чат репетитор↔ученик (2026-07-12)
    'chat_first_message_sent',
    'tutor_chat_ai_ran',
    'student_chat_ai_ran',
    -- QR-онбординг лидов Егора (2026-07-13)
    'qr_lead_registered',
    'promo_captured',
    'community_cta_clicked',
    -- клиентские краши (2026-07-15): source = 'screen'|'markdown_bubble',
    -- meta = { message, route, ua }
    'client_error'
  ));

-- ── Админ-чтение последних крашей (mirror admin_list_tutor_plans, 20260615140000) ──

create or replace function public.admin_list_client_errors(p_limit integer default 300)
returns table (
  id            uuid,
  occurred_at   timestamptz,
  source        text,
  actor_user_id uuid,
  meta          jsonb
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
  select e.id, e.occurred_at, e.source, e.actor_user_id, e.meta
  from public.analytics_events e
  where e.event_name = 'client_error'
  order by e.occurred_at desc
  limit least(coalesce(p_limit, 300), 1000);
end;
$$;

revoke all on function public.admin_list_client_errors(integer) from public, anon;
grant execute on function public.admin_list_client_errors(integer) to authenticated, service_role;

comment on function public.admin_list_client_errors(integer) is
  'Admin-only: последние client_error из analytics_events для вкладки /admin «Ошибки». '
  'PII-free (message технический, route санитизирован на edge client-error-report).';
