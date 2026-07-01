-- ============================================================================
-- Онбординг-активация v2 — серверная воронка активации (analytics_events)
-- ============================================================================
-- Двусторонняя воронка хэндоффа (PRD §7.2). Закрывает F6 («нет воронки»).
-- Queryable + JOIN с tutor_students / homework. НЕ Yandex Metrica (она — только
-- лендинг). Mirror hw_ai_check_events (20260630120000).
--
-- Инварианты:
--   • PII-free by design — НИКАКОГО свободного текста (ни имён, ни email),
--     только имя события + категориальные поля + id + счётчики в meta.
--   • Пишется edge-функциями под service_role; клиентам НЕ видна
--     (RLS on + нет policy → authenticated/anon получают 0 строк).
--   • Append-only: строки не UPDATE/DELETE.
-- ============================================================================

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null check (event_name in (
    -- репетитор
    'tutor_first_student_added',
    'invite_generated',
    'tutor_first_homework_created',
    'homework_sent_to_student',
    'student_received_and_opened',   -- cross-side «ага»
    -- ученик
    'invite_claimed',
    'student_first_login',
    'student_registered',
    'student_first_homework_opened',
    'student_first_submission'
  )),
  occurred_at timestamptz not null default now(),

  -- identity (raw internal ids; клиентам не отдаются)
  actor_user_id uuid,        -- auth.users.id инициатора события (если есть)
  tutor_id uuid,             -- tutors.id (или auth.users.id репетитора — задаёт writer)
  student_id uuid,           -- profiles.id / auth.users.id ученика
  tutor_student_id uuid,     -- tutor_students.id (связь)
  assignment_id uuid,        -- homework_tutor_assignments.id

  -- категориальный контекст (стратификация) + счётчики — PII-free
  source text,               -- link | qr | email | telegram | gate | card | ...
  meta jsonb                 -- catch-all (counts/flags) без свободного текста
);

comment on table public.analytics_events is
  'Append-only онбординг/активация воронка (серверная). Service-role only; PII-free (no free text). Онбординг v2, 2026-07-01.';

create index if not exists idx_analytics_events_name_time
  on public.analytics_events (event_name, occurred_at desc);
create index if not exists idx_analytics_events_tutor
  on public.analytics_events (tutor_id);
create index if not exists idx_analytics_events_student
  on public.analytics_events (student_id);
create index if not exists idx_analytics_events_tutor_student
  on public.analytics_events (tutor_student_id);

-- Security: внутренняя аналитика. Пишет/читает ТОЛЬКО service_role.
-- RLS включён без policy → authenticated/anon видят 0 строк.
alter table public.analytics_events enable row level security;
revoke all on public.analytics_events from anon, authenticated;
grant all on public.analytics_events to service_role;
