-- Provide a single source of truth for subscription/trial status
-- Returns premium/trial flags and current daily message usage without mutating data
create or replace function public.get_subscription_status(p_user_id uuid)
returns table (
  subscription_tier text,
  subscription_expires_at timestamptz,
  trial_ends_at timestamptz,
  is_premium boolean,
  is_trial_active boolean,
  trial_days_left integer,
  messages_used integer,
  daily_limit integer,
  limit_reached boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile record;
  v_limits record;
  v_today date := current_date;
  v_daily_limit integer := 10;
begin
  -- Prevent reading other users in non-service contexts
  if auth.role() = 'authenticated' and auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Permission denied for user %', auth.uid();
  end if;

  select
    subscription_tier,
    subscription_expires_at,
    trial_ends_at
  into v_profile
  from profiles
  where id = p_user_id;

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

  -- Premium has top priority
  is_premium := subscription_tier = 'premium'
    and (subscription_expires_at is null or subscription_expires_at > now());

  -- Trial is second priority
  is_trial_active := not is_premium and trial_ends_at is not null and trial_ends_at > now();
  if is_trial_active then
    trial_days_left := ceil(extract(epoch from (trial_ends_at - now())) / 86400);
  else
    trial_days_left := 0;
  end if;

  daily_limit := v_daily_limit;

  select messages_today, last_reset_date
  into v_limits
  from daily_message_limits
  where user_id = p_user_id;

  if not found or v_limits.last_reset_date is null or v_limits.last_reset_date <> v_today then
    messages_used := 0;
  else
    messages_used := coalesce(v_limits.messages_today, 0);
  end if;

  limit_reached := not is_premium and not is_trial_active and messages_used >= daily_limit;

  return next;
end;
$$;
