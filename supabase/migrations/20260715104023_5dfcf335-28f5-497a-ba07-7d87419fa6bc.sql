alter table public.analytics_events
  drop constraint if exists analytics_events_event_name_check;

alter table public.analytics_events
  add constraint analytics_events_event_name_check check (event_name in (
    'tutor_first_student_added',
    'invite_generated',
    'tutor_first_homework_created',
    'homework_sent_to_student',
    'student_received_and_opened',
    'invite_claimed',
    'student_first_login',
    'student_registered',
    'student_first_homework_opened',
    'student_first_submission',
    'tutor_payment_created',
    'tutor_payment_succeeded',
    'tutor_demo_check_viewed',
    'tutor_demo_check_ran',
    'chat_first_message_sent',
    'tutor_chat_ai_ran',
    'student_chat_ai_ran',
    'qr_lead_registered',
    'promo_captured',
    'community_cta_clicked',
    'client_error'
  ));

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
  'Admin-only: последние client_error из analytics_events для вкладки /admin «Ошибки». PII-free (message технический, route санитизирован на edge client-error-report).';