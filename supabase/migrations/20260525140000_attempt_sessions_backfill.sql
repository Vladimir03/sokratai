-- AC-P10 hotfix (2026-05-25, P0 #1 from ChatGPT-5.5 code review):
-- Backfill `sessions` JSONB for legacy attempts started before migration 20260525130000.
--
-- Bug: previous migration set DEFAULT '[]'::jsonb для `sessions`. Existing pilot
-- attempts с `status='in_progress'` AND `started_at IS NOT NULL` остались с
-- пустым sessions массивом. После deploy AC-P10:
--   1. Ученик открывает существующий pilot attempt → видит ⏸ Pause button
--   2. Click Pause → handlePauseAttempt видит sessions.length === 0 → 409 NO_ACTIVE_SESSION
--   3. Pause БЛОКИРУЕТСЯ для всех existing pilot attempts.
--
-- Fix: для всех `in_progress` attempts с `started_at IS NOT NULL` и пустыми
-- sessions — инициализируем sessions = [{started_at: started_at, ended_at: null}].
-- Это эквивалентно «backfill одной open session с момента started_at».
-- handlePauseAttempt сможет close её корректно.
--
-- Also handle: `paused` attempts с пустыми sessions — defensive, не должно быть
-- но safety. Закрываем session at created_at fallback.
--
-- Idempotent: WHERE sessions='[]'::jsonb защищает от re-apply.
--
-- Также добавляем defensive synthesis в handlePauseAttempt (F2) на случай если
-- какие-то attempts проскочат backfill (например, созданы между deploy AC-P10
-- и применением этой миграции).

BEGIN;

-- Case 1: in_progress + started_at set + sessions empty → init open session.
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

-- Case 2 (defensive): paused + started_at set + sessions empty (shouldn't exist
-- since pause endpoint requires sessions, но safety). Закрываем session at
-- best-effort (started_at + 1min — minimal active time чтобы не break math).
UPDATE public.mock_exam_attempts
SET sessions = jsonb_build_array(
  jsonb_build_object(
    'started_at', to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'ended_at', to_char((started_at + INTERVAL '1 minute') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
),
total_active_ms = 60000  -- 1 минута best-effort
WHERE status = 'paused'
  AND started_at IS NOT NULL
  AND sessions = '[]'::jsonb;

-- Telemetry: log how many rows backfilled for post-deploy verification.
-- Не блокирует transaction; warning level чтобы попало в Lovable logs.
DO $$
DECLARE
  in_progress_count INT;
  paused_count INT;
BEGIN
  SELECT COUNT(*) INTO in_progress_count
  FROM public.mock_exam_attempts
  WHERE status = 'in_progress' AND jsonb_array_length(sessions) >= 1;

  SELECT COUNT(*) INTO paused_count
  FROM public.mock_exam_attempts
  WHERE status = 'paused' AND jsonb_array_length(sessions) >= 1;

  RAISE NOTICE 'AC-P10 backfill: in_progress with sessions=% paused with sessions=%',
    in_progress_count, paused_count;
END $$;

COMMIT;
