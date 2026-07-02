-- ============================================================================
-- Атомарная активация подписки из yookassa-webhook (ревью ChatGPT-5.5, P0-2):
-- раньше вебхук делал read-sum-update по profiles ДО claim'а платежа →
-- конкурентная двойная доставка payment.succeeded могла продлить подписку
-- дважды. Теперь claim платежа + расчёт expiry + UPDATE profiles + audit —
-- ОДНА транзакция под FOR UPDATE (mirror конвенции rule 40/60: transactional
-- action → SECURITY DEFINER RPC, multi-query не воспроизводить).
--
-- Используется ОБОИМИ путями (студенческий Premium 699₽ и тариф репетитора
-- 'tutor_ai_start') — вебхук вызывает после верификации платежа в YooKassa API.
-- Порядок: claim выигрывает ровно один вызов; проигравший получает
-- {claimed:false, reason:'ALREADY_ACTIVATED'} и НЕ трогает profiles.
-- ============================================================================

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
  -- Лочим платёж: конкурентный дубль вебхука встанет здесь и после коммита
  -- первого увидит subscription_activated_at IS NOT NULL.
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

  -- Срок — ТОЛЬКО из нашей строки payments (записан при создании платежа).
  -- Body вебхука подделываем — metadata.subscription_days больше не источник
  -- (ревью, спутник P0-1: 36500 дней из фейкового body). Sanity-кап на всякий.
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

  -- Extend-from-future-expiry (прежняя семантика вебхука): активная подписка
  -- продлевается от даты окончания, истёкшая/отсутствующая — от now().
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

  -- Claim: updated_at проставит существующий BEFORE UPDATE триггер.
  update public.payments
     set subscription_activated_at = v_now,
         subscription_expires_at = v_new_expires
   where id = p_payment_id;

  -- Аудит тарифа репетитора (rule 99): сбой аудита НЕ откатывает выдачу
  -- premium — глотаем в под-блоке (rollback только этого блока) + WARNING.
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

-- Только service_role: клиент не должен уметь активировать подписки.
revoke all on function public.yookassa_activate_subscription(text) from public;
revoke all on function public.yookassa_activate_subscription(text) from anon, authenticated;
grant execute on function public.yookassa_activate_subscription(text) to service_role;
