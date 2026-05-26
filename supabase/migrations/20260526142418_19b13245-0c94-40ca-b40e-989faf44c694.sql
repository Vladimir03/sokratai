-- Part 1: schema additions (20260525130000)
ALTER TABLE public.mock_exam_attempts
  ADD COLUMN IF NOT EXISTS exam_mode TEXT NOT NULL DEFAULT 'training'
    CHECK (exam_mode IN ('simulation', 'training'));

ALTER TABLE public.mock_exam_attempts
  ADD COLUMN IF NOT EXISTS sessions JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.mock_exam_attempts
  ADD COLUMN IF NOT EXISTS total_active_ms BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.mock_exam_attempts
  DROP CONSTRAINT IF EXISTS mock_exam_attempts_status_check;

ALTER TABLE public.mock_exam_attempts
  ADD CONSTRAINT mock_exam_attempts_status_check CHECK (status IN (
    'in_progress',
    'paused',
    'submitted',
    'ai_checking',
    'awaiting_review',
    'approved',
    'manually_entered'
  ));

ALTER TABLE public.mock_exam_assignments
  ADD COLUMN IF NOT EXISTS default_exam_mode TEXT NOT NULL DEFAULT 'training'
    CHECK (default_exam_mode IN ('simulation', 'training'));

COMMENT ON COLUMN public.mock_exam_attempts.exam_mode IS
  'AC-P10 (2026-05-25): immutable mode прохождения пробника.';
COMMENT ON COLUMN public.mock_exam_attempts.sessions IS
  'AC-P10: array of {started_at, ended_at|null}.';
COMMENT ON COLUMN public.mock_exam_attempts.total_active_ms IS
  'AC-P10: cached SUM(session duration_ms).';
COMMENT ON COLUMN public.mock_exam_assignments.default_exam_mode IS
  'AC-P10: tutor recommended mode.';

-- Part 2: backfill (20260525140000)
UPDATE public.mock_exam_attempts
SET sessions = jsonb_build_array(
  jsonb_build_object(
    'started_at', to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'ended_at', NULL
  )
)
WHERE status = 'in_progress'
  AND started_at IS NOT NULL
  AND sessions = '[]'::jsonb;

UPDATE public.mock_exam_attempts
SET sessions = jsonb_build_array(
  jsonb_build_object(
    'started_at', to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'ended_at', to_char((started_at + INTERVAL '1 minute') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
),
total_active_ms = 60000
WHERE status = 'paused'
  AND started_at IS NOT NULL
  AND sessions = '[]'::jsonb;