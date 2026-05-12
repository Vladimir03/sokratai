-- Расширяет get_subscription_status контекстом ('chat' | 'homework').
-- В homework-контексте free-ученик с хотя бы одним платящим (или trial) репетитором
-- получает daily_limit = 50 вместо 10. Premium/trial самого ученика остаётся unlimited.

drop function if exists public.get_subscription_status(uuid);

create or replace function public.get_subscription_status(
  p_user_id uuid,
  p_context text default 'chat'
)
returns table (
  subscription_tier text,
  subscription_expires_at timestamptz,
  trial_ends_at timestamptz,
  is_premium boolean,
  is_trial_active boolean,
  trial_days_left integer,
  messages_used integer,
  daily_limit integer,
  limit_reached boolean,
  tutor_can_upgrade boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile record;
  v_limits record;
  v_today date := current_date;
  v_base_limit integer := 10;
  v_homework_paid_limit integer := 50;
  v_has_paid_tutor boolean := false;
  v_has_any_tutor boolean := false;
  v_context text := lower(coalesce(p_context, 'chat'));
begin
  if auth.role() = 'authenticated' and auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Permission denied for user %', auth.uid();
  end if;

  select
    p.subscription_tier,
    p.subscription_expires_at,
    p.trial_ends_at
  into v_profile
  from profiles p
  where p.id = p_user_id;

  if not found then
    subscription_tier := 'free';
    subscription_expires_at := null;
    trial_ends_at := null;
  else
    subscription_tier := v_profile.subscription_tier;
    subscription_expires_at := v_profile.subscription_expires_at;
    trial_ends_at := v_profile.trial_ends_at;
  end if;

  is_premium := subscription_tier = 'premium'
    and (subscription_expires_at is null or subscription_expires_at > now());

  is_trial_active := not is_premium and trial_ends_at is not null and trial_ends_at > now();
  if is_trial_active then
    trial_days_left := ceil(extract(epoch from (trial_ends_at - now())) / 86400);
  else
    trial_days_left := 0;
  end if;

  if v_context = 'homework' and not is_premium and not is_trial_active then
    select
      exists (
        select 1
        from public.tutor_students ts
        join public.tutors t on t.id = ts.tutor_id
        join public.profiles tp on tp.id = t.user_id
        where ts.student_id = p_user_id
          and ts.status = 'active'
          and (
            (tp.subscription_tier = 'premium'
              and (tp.subscription_expires_at is null or tp.subscription_expires_at > now()))
            or (tp.trial_ends_at is not null and tp.trial_ends_at > now())
          )
      ),
      exists (
        select 1
        from public.tutor_students ts
        where ts.student_id = p_user_id
          and ts.status = 'active'
      )
    into v_has_paid_tutor, v_has_any_tutor;
  end if;

  if is_premium or is_trial_active then
    daily_limit := -1;
  elsif v_context = 'homework' and v_has_paid_tutor then
    daily_limit := v_homework_paid_limit;
  else
    daily_limit := v_base_limit;
  end if;

  tutor_can_upgrade := v_context = 'homework'
    and not is_premium
    and not is_trial_active
    and v_has_any_tutor
    and not v_has_paid_tutor;

  if is_premium or is_trial_active then
    messages_used := 0;
  else
    select coalesce(dml.messages_today, 0)
    into messages_used
    from daily_message_limits dml
    where dml.user_id = p_user_id
      and dml.last_reset_date = v_today;

    if messages_used is null then
      messages_used := 0;
    end if;
  end if;

  limit_reached := daily_limit > 0 and messages_used >= daily_limit;

  return next;
end;
$$;

grant execute on function public.get_subscription_status(uuid, text) to anon, authenticated, service_role;