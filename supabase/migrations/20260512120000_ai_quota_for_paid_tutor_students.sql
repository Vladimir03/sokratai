-- Расширяет get_subscription_status контекстом ('chat' | 'homework').
-- В homework-контексте free-ученик с хотя бы одним платящим (или trial) репетитором
-- получает daily_limit = 50 вместо 10. Premium/trial самого ученика остаётся unlimited.
--
-- Single source of truth для дневной квоты AI-сообщений — этот RPC.
-- Backend chat/index.ts и homework-api guard'ы вызывают его через shared helper
-- (supabase/functions/_shared/subscription-limits.ts).
--
-- Совместимость: 1-arg callers (старый useSubscription) продолжают работать через
-- default p_context := 'chat'.

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
  -- Prevent reading other users in non-service contexts
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

  -- Default values when profile is missing
  if not found then
    subscription_tier := 'free';
    subscription_expires_at := null;
    trial_ends_at := null;
  else
    subscription_tier := v_profile.subscription_tier;
    subscription_expires_at := v_profile.subscription_expires_at;
    trial_ends_at := v_profile.trial_ends_at;
  end if;

  -- Premium has top priority (own subscription)
  is_premium := subscription_tier = 'premium'
    and (subscription_expires_at is null or subscription_expires_at > now());

  -- Trial is second priority (own trial)
  is_trial_active := not is_premium and trial_ends_at is not null and trial_ends_at > now();
  if is_trial_active then
    trial_days_left := ceil(extract(epoch from (trial_ends_at - now())) / 86400);
  else
    trial_days_left := 0;
  end if;

  -- В homework-контексте проверяем, есть ли у студента платящий/trial-тутор.
  -- Это apply'ится ТОЛЬКО если сам студент не premium и не на собственном triale —
  -- иначе у него и так unlimited, паззл нерелевантен.
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

  -- Choose limit
  if v_context = 'homework' and v_has_paid_tutor then
    daily_limit := v_homework_paid_limit;
  else
    daily_limit := v_base_limit;
  end if;

  -- Marketing nudge: free-ученик с тутором, который мог бы upgrade'нуться, но не upgrade'нулся.
  -- Используется фронтом в 429 toast'е («Ваш репетитор может поднять лимит до 50/день»).
  tutor_can_upgrade := v_context = 'homework'
    and not is_premium
    and not is_trial_active
    and v_has_any_tutor
    and not v_has_paid_tutor;

  -- Fetch counter (same bucket for chat & homework — one daily_message_limits row per user)
  select dml.messages_today, dml.last_reset_date
  into v_limits
  from daily_message_limits dml
  where dml.user_id = p_user_id;

  if not found or v_limits.last_reset_date is null or v_limits.last_reset_date <> v_today then
    messages_used := 0;
  else
    messages_used := coalesce(v_limits.messages_today, 0);
  end if;

  -- Premium/trial учеников не ограничиваем
  limit_reached := not is_premium and not is_trial_active and messages_used >= daily_limit;

  return next;
end;
$$;

comment on function public.get_subscription_status(uuid, text) is
  'AI-quota / subscription state for user. p_context = ''chat'' | ''homework''. '
  'In homework context, free-students with at least one paying/trial tutor get daily_limit=50 (vs 10 otherwise). '
  'tutor_can_upgrade = true is a marketing-nudge signal: student has tutor(s) but none paying — frontend can show upgrade prompt on 429.';
