
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any existing schedule with same name (idempotent)
DO $$
BEGIN
  PERFORM cron.unschedule('tutor-plan-expiry-reminder-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Schedule daily 06:00 UTC (09:00 МСК)
SELECT cron.schedule(
  'tutor-plan-expiry-reminder-daily',
  '0 6 * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://vrsseotrfmsxpbciyqzc.supabase.co/functions/v1/tutor-plan-expiry-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SCHEDULER_SECRET' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $cmd$
);
