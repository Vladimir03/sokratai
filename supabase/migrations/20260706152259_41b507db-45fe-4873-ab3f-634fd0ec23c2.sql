create table if not exists public.hw_ai_check_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('check_completed', 'tutor_correction')),
  occurred_at timestamptz not null default now(),

  student_id uuid,
  tutor_id uuid,
  assignment_id uuid,
  task_id uuid,
  task_state_id uuid,

  subject text,
  check_format text,
  task_kind text,
  kim_number int,
  max_score numeric,

  verdict text,
  confidence numeric,
  error_type text,
  failure_reason text,
  ai_score numeric,
  latency_ms int,
  fast_path boolean,
  leak_retry boolean,
  leak_scrubbed boolean,
  image_missing boolean,

  correction_kind text,
  tutor_score_override numeric,
  ai_score_at_correction numeric,
  override_delta numeric,

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

alter table public.hw_ai_check_events enable row level security;
revoke all on public.hw_ai_check_events from anon, authenticated;
grant all on public.hw_ai_check_events to service_role;