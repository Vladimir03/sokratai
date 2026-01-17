-- Add missing columns to tutor_students table
ALTER TABLE public.tutor_students
ADD COLUMN IF NOT EXISTS paid_until DATE,
ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

-- Add comments for clarity
COMMENT ON COLUMN public.tutor_students.paid_until IS 'Date until which lessons are paid';
COMMENT ON COLUMN public.tutor_students.last_activity_at IS 'Last activity timestamp of student in the system';