-- Phase 1.3: Multichannel delivery cascade
-- Extend delivery_status to track which channel delivered the notification.
-- Add delivery_channel column for explicit channel recording.

-- 1. Drop old CHECK constraint, add new one with extended values
ALTER TABLE public.homework_tutor_student_assignments
  DROP CONSTRAINT IF EXISTS homework_tutor_student_assignments_delivery_status_check;

ALTER TABLE public.homework_tutor_student_assignments
  ADD CONSTRAINT homework_tutor_student_assignments_delivery_status_check
  CHECK (delivery_status IN (
    'pending', 'delivered',
    'delivered_push', 'delivered_telegram', 'delivered_email',
    'failed_not_connected', 'failed_blocked_or_other',
    'failed_all_channels', 'failed_no_channel'
  ));

-- 2. Add delivery_channel column with CHECK (nullable — null for legacy rows and pending)
ALTER TABLE public.homework_tutor_student_assignments
  ADD COLUMN IF NOT EXISTS delivery_channel TEXT
  CHECK (delivery_channel IN ('push', 'telegram', 'email'));

-- 3. Add channel column to reminder_log with CHECK (nullable — null for legacy rows)
ALTER TABLE public.homework_tutor_reminder_log
  ADD COLUMN IF NOT EXISTS channel TEXT
  CHECK (channel IN ('push', 'telegram', 'email'));
