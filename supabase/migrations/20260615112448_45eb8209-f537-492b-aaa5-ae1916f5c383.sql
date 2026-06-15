-- Durable, auditable admin mechanism to grant / revoke a tutor's paid plan.
create table if not exists public.admin_tutor_plan_grants (
  id                  uuid primary key default gen_random_uuid(),
  target_user_id      uuid not null,
  target_email        text,
  action              text not null check (action in ('grant', 'revoke')),
  tier                text not null,
  expires_at          timestamptz,
  previous_tier       text,
  previous_expires_at timestamptz,
  note                text,
  granted_by          uuid not null,
  created_at          timestamptz not null default now()
);

alter table public.admin_tutor_plan_grants enable row level security;

drop policy if exists "Admins read tutor plan grants" on public.admin_tutor_plan_grants;
create policy "Admins read tutor plan grants"
  on public.admin_tutor_plan_grants
  for select to authenticated
  using (public.is_admin(auth.uid()));

revoke all on table public.admin_tutor_plan_grants from anon, authenticated;
grant select on table public.admin_tutor_plan_grants to authenticated;

create index if not exists idx_admin_tutor_plan_grants_created_desc
  on public.admin_tutor_plan_grants (created_at desc);

create or replace function public.admin_list_tutor_plans()
returns table (
  user_id                 uuid,
  email                   text,
  name                    text,
  subscription_tier       text,
  subscription_expires_at timestamptz,
  trial_ends_at           timestamptz,
  is_paid                 boolean,
  active_students         integer
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
    t.user_id,
    u.email::text,
    t.name,
    p.subscription_tier,
    p.subscription_expires_at,
    p.trial_ends_at,
    (
      (p.subscription_tier = 'premium'
        and (p.subscription_expires_at is null or p.subscription_expires_at > now()))
      or (p.trial_ends_at is not null and p.trial_ends_at > now())
    ) as is_paid,
    (
      select count(*)::int
      from public.tutor_students ts
      where ts.tutor_id = t.id and ts.status = 'active'
    ) as active_students
  from public.tutors t
  join public.profiles p on p.id = t.user_id
  join auth.users u      on u.id = t.user_id
  order by 7 asc, 2 asc;
end;
$$;

create or replace function public.admin_grant_tutor_plan(
  p_email      text,
  p_expires_at timestamptz,
  p_note       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller       uuid := auth.uid();
  v_uid          uuid;
  v_email        text;
  v_name         text;
  v_is_tutor     boolean := false;
  v_prev_tier    text;
  v_prev_expires timestamptz;
begin
  if v_caller is null or not public.is_admin(v_caller) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  if p_email is null or btrim(p_email) = '' then
    raise exception 'EMAIL_REQUIRED' using errcode = '22023';
  end if;
  if p_expires_at is null then
    raise exception 'EXPIRES_REQUIRED' using errcode = '22023';
  end if;
  if p_expires_at <= now() then
    raise exception 'EXPIRES_IN_PAST' using errcode = '22023';
  end if;

  select u.id, u.email::text into v_uid, v_email
  from auth.users u
  where lower(u.email) = lower(btrim(p_email))
  limit 1;

  if v_uid is null then
    raise exception 'USER_NOT_FOUND' using errcode = '22023';
  end if;

  select p.subscription_tier, p.subscription_expires_at
  into v_prev_tier, v_prev_expires
  from public.profiles p
  where p.id = v_uid;

  select t.name, true into v_name, v_is_tutor
  from public.tutors t
  where t.user_id = v_uid
  limit 1;

  update public.profiles
  set subscription_tier = 'premium',
      subscription_expires_at = p_expires_at
  where id = v_uid;

  insert into public.admin_tutor_plan_grants
    (target_user_id, target_email, action, tier, expires_at,
     previous_tier, previous_expires_at, note, granted_by)
  values
    (v_uid, v_email, 'grant', 'premium', p_expires_at,
     v_prev_tier, v_prev_expires, nullif(btrim(coalesce(p_note, '')), ''), v_caller);

  return jsonb_build_object(
    'user_id', v_uid,
    'email', v_email,
    'name', v_name,
    'is_tutor', coalesce(v_is_tutor, false),
    'tier', 'premium',
    'expires_at', p_expires_at,
    'previous_tier', v_prev_tier,
    'previous_expires_at', v_prev_expires
  );
end;
$$;

create or replace function public.admin_revoke_tutor_plan(
  p_email text,
  p_note  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller       uuid := auth.uid();
  v_uid          uuid;
  v_email        text;
  v_prev_tier    text;
  v_prev_expires timestamptz;
begin
  if v_caller is null or not public.is_admin(v_caller) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  if p_email is null or btrim(p_email) = '' then
    raise exception 'EMAIL_REQUIRED' using errcode = '22023';
  end if;

  select u.id, u.email::text into v_uid, v_email
  from auth.users u
  where lower(u.email) = lower(btrim(p_email))
  limit 1;

  if v_uid is null then
    raise exception 'USER_NOT_FOUND' using errcode = '22023';
  end if;

  select p.subscription_tier, p.subscription_expires_at
  into v_prev_tier, v_prev_expires
  from public.profiles p
  where p.id = v_uid;

  update public.profiles
  set subscription_tier = 'free',
      subscription_expires_at = null
  where id = v_uid;

  insert into public.admin_tutor_plan_grants
    (target_user_id, target_email, action, tier, expires_at,
     previous_tier, previous_expires_at, note, granted_by)
  values
    (v_uid, v_email, 'revoke', 'free', null,
     v_prev_tier, v_prev_expires, nullif(btrim(coalesce(p_note, '')), ''), v_caller);

  return jsonb_build_object(
    'user_id', v_uid,
    'email', v_email,
    'tier', 'free',
    'previous_tier', v_prev_tier,
    'previous_expires_at', v_prev_expires
  );
end;
$$;

revoke all on function public.admin_list_tutor_plans() from public, anon;
grant execute on function public.admin_list_tutor_plans() to authenticated, service_role;

revoke all on function public.admin_grant_tutor_plan(text, timestamptz, text) from public, anon;
grant execute on function public.admin_grant_tutor_plan(text, timestamptz, text) to authenticated, service_role;

revoke all on function public.admin_revoke_tutor_plan(text, text) from public, anon;
grant execute on function public.admin_revoke_tutor_plan(text, text) to authenticated, service_role;

comment on function public.admin_grant_tutor_plan(text, timestamptz, text) is
  'Admin-only: set profiles.subscription_tier=premium + subscription_expires_at for a tutor (by email). Makes their students get the 50/day homework AI limit. Audited in admin_tutor_plan_grants.';