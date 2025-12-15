-- YooKassa payments tracking table

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan text not null,
  amount_value numeric(12, 2) not null,
  currency text not null default 'RUB',
  status text not null default 'pending',
  yookassa_payment_id text unique,
  idempotence_key text unique,
  created_at timestamptz not null default now(),
  paid_at timestamptz null,
  raw_notification jsonb null
);

-- Basic integrity
alter table public.payments
  add constraint payments_status_check
  check (status in ('pending', 'succeeded', 'canceled'));

create index if not exists payments_user_id_created_at_idx on public.payments(user_id, created_at desc);

-- Enable RLS
alter table public.payments enable row level security;

-- Users can view own payments
create policy "Users can view own payments" on public.payments
  for select
  using (auth.uid() = user_id);

-- Users can create their own payment intent rows
create policy "Users can insert own payments" on public.payments
  for insert
  with check (auth.uid() = user_id);

-- Service role needs full access for edge functions (webhook)
create policy "Service role full access on payments" on public.payments
  for all
  using (true)
  with check (true);




