-- ============================================================================
-- Онбординг-активация v2 — серверная воронка активации (analytics_events)
-- ============================================================================
create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null check (event_name in (
    'tutor_first_student_added',
    'invite_generated',
    'tutor_first_homework_created',
    'homework_sent_to_student',
    'student_received_and_opened',
    'invite_claimed',
    'student_first_login',
    'student_registered',
    'student_first_homework_opened',
    'student_first_submission'
  )),
  occurred_at timestamptz not null default now(),
  actor_user_id uuid,
  tutor_id uuid,
  student_id uuid,
  tutor_student_id uuid,
  assignment_id uuid,
  source text,
  meta jsonb
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

alter table public.analytics_events enable row level security;
revoke all on public.analytics_events from anon, authenticated;
grant all on public.analytics_events to service_role;

-- ============================================================================
-- Онбординг-активация v2 — per-student claim token
-- ============================================================================
ALTER TABLE public.tutor_students
  ADD COLUMN IF NOT EXISTS claim_token            text,
  ADD COLUMN IF NOT EXISTS claim_token_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_at             timestamptz,
  ADD COLUMN IF NOT EXISTS claim_channel          text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tutor_students_claim_token
  ON public.tutor_students (claim_token)
  WHERE claim_token IS NOT NULL;

COMMENT ON COLUMN public.tutor_students.claim_token IS
  'Per-student bearer claim-токен (одноразовый, обнуляется edge при первом минте). rule 96.';
COMMENT ON COLUMN public.tutor_students.claimed_at IS
  'Когда ученик впервые claim''нул запись (минт сессии). NULL = не подключился.';

CREATE OR REPLACE FUNCTION public.tutor_ensure_student_claim_token(
  p_tutor_student_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tutor_pk_id   uuid;
  v_owns          boolean;
  v_student_id    uuid;
  v_token         text;
  v_token_created timestamptz;
  v_last_sign_in  timestamptz;
  v_new_token     text;
  v_exists        boolean;
  v_ttl           interval := interval '30 days';
BEGIN
  SELECT id INTO v_tutor_pk_id FROM public.tutors WHERE user_id = auth.uid();
  IF v_tutor_pk_id IS NULL THEN
    RAISE EXCEPTION 'TUTOR_NOT_FOUND';
  END IF;

  SELECT (tutor_id = v_tutor_pk_id), student_id, claim_token, claim_token_created_at
    INTO v_owns, v_student_id, v_token, v_token_created
  FROM public.tutor_students
  WHERE id = p_tutor_student_id;

  IF v_owns IS NULL THEN
    RAISE EXCEPTION 'STUDENT_NOT_FOUND';
  END IF;
  IF v_owns IS NOT TRUE THEN
    RAISE EXCEPTION 'NOT_OWNED';
  END IF;

  SELECT last_sign_in_at INTO v_last_sign_in FROM auth.users WHERE id = v_student_id;
  IF v_last_sign_in IS NOT NULL THEN
    RAISE EXCEPTION 'STUDENT_ALREADY_ACTIVE';
  END IF;

  IF v_token IS NOT NULL AND v_token_created IS NOT NULL
     AND v_token_created > now() - v_ttl THEN
    RETURN v_token;
  END IF;

  LOOP
    v_new_token := encode(gen_random_bytes(16), 'hex');
    SELECT EXISTS(
      SELECT 1 FROM public.tutor_students WHERE claim_token = v_new_token
    ) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;

  UPDATE public.tutor_students
    SET claim_token = v_new_token,
        claim_token_created_at = now()
    WHERE id = p_tutor_student_id
      AND (claim_token IS NULL
           OR claim_token_created_at IS NULL
           OR claim_token_created_at <= now() - v_ttl)
    RETURNING claim_token INTO v_token;

  IF v_token IS NOT NULL THEN
    BEGIN
      INSERT INTO public.analytics_events (event_name, tutor_id, tutor_student_id, source)
      VALUES ('invite_generated', v_tutor_pk_id, p_tutor_student_id, 'gate');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RETURN v_token;
  END IF;

  SELECT claim_token INTO v_token FROM public.tutor_students WHERE id = p_tutor_student_id;
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.tutor_ensure_student_claim_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_ensure_student_claim_token(uuid) TO authenticated;

COMMENT ON FUNCTION public.tutor_ensure_student_claim_token(uuid) IS
  'Per-student claim-токен (генерит-если-NULL, атомарно). Ownership по auth.uid() (tutors.id). Онбординг v2.';

-- ============================================================================
-- Онбординг v2 — rate-limit «войти по коду» (email-бомбинг)
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