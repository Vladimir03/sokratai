-- Create tutor_calendar_settings table
CREATE TABLE IF NOT EXISTS public.tutor_calendar_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id UUID NOT NULL REFERENCES public.tutors(id) ON DELETE CASCADE UNIQUE,
  default_duration SMALLINT NOT NULL DEFAULT 60,
  buffer_minutes SMALLINT NOT NULL DEFAULT 15,
  min_notice_hours SMALLINT NOT NULL DEFAULT 24,
  max_advance_days SMALLINT NOT NULL DEFAULT 30,
  auto_confirm BOOLEAN NOT NULL DEFAULT true,
  allow_student_cancel BOOLEAN NOT NULL DEFAULT true,
  cancel_notice_hours SMALLINT NOT NULL DEFAULT 24,
  timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create tutor_availability_exceptions table
CREATE TABLE IF NOT EXISTS public.tutor_availability_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id UUID NOT NULL REFERENCES public.tutors(id) ON DELETE CASCADE,
  exception_date DATE NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT tutor_availability_exceptions_unique UNIQUE (tutor_id, exception_date)
);

-- Enable RLS
ALTER TABLE public.tutor_calendar_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tutor_availability_exceptions ENABLE ROW LEVEL SECURITY;

-- RLS policies for tutor_calendar_settings
CREATE POLICY "Tutors can view own calendar settings"
ON public.tutor_calendar_settings FOR SELECT
USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

CREATE POLICY "Tutors can insert own calendar settings"
ON public.tutor_calendar_settings FOR INSERT
WITH CHECK (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

CREATE POLICY "Tutors can update own calendar settings"
ON public.tutor_calendar_settings FOR UPDATE
USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

-- RLS policies for tutor_availability_exceptions
CREATE POLICY "Tutors can view own availability exceptions"
ON public.tutor_availability_exceptions FOR SELECT
USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

CREATE POLICY "Tutors can insert own availability exceptions"
ON public.tutor_availability_exceptions FOR INSERT
WITH CHECK (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

CREATE POLICY "Tutors can update own availability exceptions"
ON public.tutor_availability_exceptions FOR UPDATE
USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

CREATE POLICY "Tutors can delete own availability exceptions"
ON public.tutor_availability_exceptions FOR DELETE
USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

-- Add updated_at trigger for tutor_calendar_settings
CREATE TRIGGER update_tutor_calendar_settings_updated_at
BEFORE UPDATE ON public.tutor_calendar_settings
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();