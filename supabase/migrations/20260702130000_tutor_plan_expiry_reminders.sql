-- ============================================================================
-- Конверсия тарифа репетитора, round 3 (2026-07-02, решения Vladimir):
--   1) Лог идемпотентности нуджа «AI-старт истекает через 3 дня»
--      (edge tutor-plan-expiry-reminder, каскад telegram → email).
--   2) Расширение whitelist analytics_events под воронку оплаты тарифа.
-- ============================================================================

-- ── 1. Лог нуджей об истечении (mirror homework_tutor_reminder_log) ─────────
-- Один нудж на конкретную дату истечения: продление сдвигает expires_at →
-- новая строка в следующем цикле. UNIQUE + ignoreDuplicates в edge = идемпотентно.
create table if not exists public.tutor_plan_expiry_reminder_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,             -- auth.users.id репетитора
  expires_at timestamptz not null,   -- какой именно expiry напоминали
  channel text,                      -- 'telegram' | 'email' | null (нечем доставить)
  created_at timestamptz not null default now(),
  unique (user_id, expires_at)
);

comment on table public.tutor_plan_expiry_reminder_log is
  'Идемпотентность нуджа «тариф AI-старт истекает» (edge tutor-plan-expiry-reminder). Service-role only.';

-- Service-role only (mirror analytics_events): RLS on без политик.
alter table public.tutor_plan_expiry_reminder_log enable row level security;
revoke all on public.tutor_plan_expiry_reminder_log from anon, authenticated;
grant all on public.tutor_plan_expiry_reminder_log to service_role;

-- ── 2. analytics_events: события воронки оплаты тарифа ──────────────────────
-- event_name под CHECK-whitelist (миграция 20260701115000) — расширяем.
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
    'tutor_payment_succeeded'
  ));
