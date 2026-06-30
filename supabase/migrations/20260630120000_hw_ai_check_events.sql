-- ============================================================================
-- AI-check telemetry (analytics layer for "Качество AI-проверки ДЗ", 2026-06-30)
-- ============================================================================
-- Append-only event log, который захватывает «слой вердикта» каждой AI-проверки
-- ДЗ (verdict / confidence / error_type / failure_reason) — он НЕ хранится на
-- `homework_tutor_task_states`, поэтому ретроспективно его взять неоткуда. Плюс
-- правки репетитора (override / reopen / force_complete) с таймингом.
--
-- Назначение: дать проекту Senior Analyst Studio (Катя-Дубай) queryable данные
-- для error-rate по типам, auto-accept-rate, времени-до-проверки. Копит вперёд.
--
-- Инварианты:
--   • PII-free by design — НИКАКОГО свободного текста (ни feedback, ни комментариев),
--     только категориальный исход + баллы + флаги + id (id обезличиваются на экспорте).
--   • Пишется edge-функцией `homework-api` под service_role; ученикам/репетиторам
--     НЕ видна (RLS on + нет policy → authenticated/anon получают 0 строк).
--   • Append-only: строки не UPDATE/DELETE.
-- ============================================================================

create table if not exists public.hw_ai_check_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('check_completed', 'tutor_correction')),
  occurred_at timestamptz not null default now(),

  -- identity (raw internal ids; обезличиваются на экспорте, клиентам не отдаются)
  student_id uuid,
  tutor_id uuid,
  assignment_id uuid,
  task_id uuid,
  task_state_id uuid,

  -- task context (для стратификации)
  subject text,
  check_format text,
  task_kind text,
  kim_number int,
  max_score numeric,

  -- payload события 'check_completed'
  verdict text,            -- CORRECT | ON_TRACK | INCORRECT | CHECK_FAILED (применённый вердикт)
  confidence numeric,      -- 0..1
  error_type text,
  failure_reason text,
  ai_score numeric,
  latency_ms int,          -- зарезервировано (v1 = null)
  fast_path boolean,       -- зарезервировано
  leak_retry boolean,      -- зарезервировано
  leak_scrubbed boolean,   -- зарезервировано
  image_missing boolean,   -- зарезервировано

  -- payload события 'tutor_correction'
  correction_kind text,            -- override | reset | reopen | force_complete
  tutor_score_override numeric,
  ai_score_at_correction numeric,
  override_delta numeric,          -- = override − ai_score (ключевой сигнал F1/F2)

  -- catch-all для будущих полей без новой миграции
  meta jsonb
);

comment on table public.hw_ai_check_events is
  'Append-only AI homework-check telemetry (analytics). Service-role only; PII-free (no free text). 2026-06-30.';

create index if not exists idx_hw_ai_check_events_type_time
  on public.hw_ai_check_events (event_type, occurred_at desc);
create index if not exists idx_hw_ai_check_events_subject
  on public.hw_ai_check_events (subject);
create index if not exists idx_hw_ai_check_events_student
  on public.hw_ai_check_events (student_id);
create index if not exists idx_hw_ai_check_events_task_state
  on public.hw_ai_check_events (task_state_id);

-- Security: внутренняя аналитическая таблица. Пишет/читает ТОЛЬКО service_role.
-- RLS включён без policy → authenticated/anon видят 0 строк; service_role обходит RLS.
-- Belt-and-suspenders: REVOKE привилегий у anon/authenticated.
alter table public.hw_ai_check_events enable row level security;
revoke all on public.hw_ai_check_events from anon, authenticated;
grant all on public.hw_ai_check_events to service_role;
