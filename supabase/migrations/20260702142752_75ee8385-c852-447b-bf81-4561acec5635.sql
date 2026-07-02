-- 20260702120000_payments_plan_column.sql
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS plan text;
COMMENT ON COLUMN public.payments.plan IS
  'NULL = legacy student Premium (699/30d). tutor_ai_start = tutor plan (variable price, server-resolved).';
CREATE INDEX IF NOT EXISTS idx_payments_user_plan_status
  ON public.payments (user_id, plan, status)
  WHERE plan IS NOT NULL;

-- 20260702130000_tutor_plan_expiry_reminders.sql
create table if not exists public.tutor_plan_expiry_reminder_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  expires_at timestamptz not null,
  channel text,
  created_at timestamptz not null default now(),
  unique (user_id, expires_at)
);
comment on table public.tutor_plan_expiry_reminder_log is
  'Идемпотентность нуджа «тариф AI-старт истекает» (edge tutor-plan-expiry-reminder). Service-role only.';
alter table public.tutor_plan_expiry_reminder_log enable row level security;
revoke all on public.tutor_plan_expiry_reminder_log from anon, authenticated;
grant all on public.tutor_plan_expiry_reminder_log to service_role;

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
    'tutor_payment_succeeded'
  ));

-- 20260702140000_tutor_intro_price_available.sql
create or replace function public.tutor_intro_price_available()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    not exists (
      select 1 from public.payments p
      where p.user_id = auth.uid()
        and p.plan = 'tutor_ai_start'
        and p.status = 'succeeded'
    )
    and not exists (
      select 1 from public.admin_tutor_plan_grants g
      where g.target_user_id = auth.uid()
        and g.action = 'grant'
    )
    and not exists (
      select 1 from public.profiles pr
      where pr.id = auth.uid()
        and pr.subscription_tier = 'premium'
        and (pr.subscription_expires_at is null or pr.subscription_expires_at > now())
    );
$$;
comment on function public.tutor_intro_price_available() is
  'Доступна ли интро-цена 200₽ тарифа AI-старт текущему пользователю (нет оплат + нет грантов + нет действующего premium). Зеркало серверной логики yookassa-create-payment.';
revoke all on function public.tutor_intro_price_available() from public;
grant execute on function public.tutor_intro_price_available() to authenticated;

-- 20260702150000_yookassa_activate_subscription.sql
create or replace function public.yookassa_activate_subscription(p_payment_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment record;
  v_profile record;
  v_now timestamptz := now();
  v_days int;
  v_new_expires timestamptz;
  v_email text;
begin
  select id, user_id, subscription_days, subscription_activated_at, plan
    into v_payment
    from public.payments
   where id = p_payment_id
   for update;

  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'PAYMENT_NOT_FOUND');
  end if;

  if v_payment.subscription_activated_at is not null then
    return jsonb_build_object('claimed', false, 'reason', 'ALREADY_ACTIVATED');
  end if;

  v_days := coalesce(v_payment.subscription_days, 30);
  if v_days < 1 or v_days > 366 then
    v_days := 30;
  end if;

  select subscription_tier, subscription_expires_at
    into v_profile
    from public.profiles
   where id = v_payment.user_id
   for update;

  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'PROFILE_NOT_FOUND');
  end if;

  if v_profile.subscription_expires_at is not null
     and v_profile.subscription_expires_at > v_now then
    v_new_expires := v_profile.subscription_expires_at + make_interval(days => v_days);
  else
    v_new_expires := v_now + make_interval(days => v_days);
  end if;

  update public.profiles
     set subscription_tier = 'premium',
         subscription_expires_at = v_new_expires
   where id = v_payment.user_id;

  update public.payments
     set subscription_activated_at = v_now,
         subscription_expires_at = v_new_expires
   where id = p_payment_id;

  if v_payment.plan = 'tutor_ai_start' then
    begin
      select email into v_email from auth.users where id = v_payment.user_id;
    exception when others then
      v_email := null;
    end;
    begin
      insert into public.admin_tutor_plan_grants
        (target_user_id, target_email, action, tier, expires_at,
         previous_tier, previous_expires_at, note, granted_by)
      values
        (v_payment.user_id, v_email, 'grant', 'premium', v_new_expires,
         v_profile.subscription_tier, v_profile.subscription_expires_at,
         'yookassa payment ' || p_payment_id, v_payment.user_id);
    exception when others then
      raise warning 'yookassa_activate_subscription: audit insert failed for payment % (%)',
        p_payment_id, sqlerrm;
    end;
  end if;

  return jsonb_build_object(
    'claimed', true,
    'plan', v_payment.plan,
    'new_expires_at', v_new_expires,
    'previous_tier', v_profile.subscription_tier
  );
end;
$$;

comment on function public.yookassa_activate_subscription(text) is
  'Атомарная активация подписки по оплаченному YooKassa-платежу: claim + profiles + audit одной транзакцией. Вызывает ТОЛЬКО yookassa-webhook (service_role) после верификации платежа в YooKassa API.';

revoke all on function public.yookassa_activate_subscription(text) from public;
revoke all on function public.yookassa_activate_subscription(text) from anon, authenticated;
grant execute on function public.yookassa_activate_subscription(text) to service_role;