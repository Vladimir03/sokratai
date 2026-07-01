-- ============================================================================
-- Онбординг v2 (review P1 #5) — rate-limit «войти по коду» (email-бомбинг)
-- ============================================================================
-- student-otp-request публичен (verify_jwt=false). Без троттлинга бот мог бы
-- слать сотни magic-link на чужой email. Лёгкий счётчик по ключу (email) в окне.
-- Service-role only; клиентам не видна (RLS on + нет policy + REVOKE).
-- ============================================================================

create table if not exists public.auth_otp_throttle (
  throttle_key text primary key,
  attempts     int not null default 0,
  window_start timestamptz not null default now()
);

alter table public.auth_otp_throttle enable row level security;
revoke all on public.auth_otp_throttle from anon, authenticated;
grant all on public.auth_otp_throttle to service_role;

comment on table public.auth_otp_throttle is
  'Rate-limit «войти по коду» (student-otp-request). Service-role only. Онбординг v2, 2026-07-01.';
