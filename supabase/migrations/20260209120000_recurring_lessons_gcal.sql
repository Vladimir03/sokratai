-- Migration: Recurring lessons + Google Calendar import + lesson_type/subject
-- Date: 2026-02-09

-- =============================================
-- 1. Add lesson_type, subject, recurring, and external fields to tutor_lessons
-- =============================================

-- Lesson type
ALTER TABLE public.tutor_lessons
  ADD COLUMN IF NOT EXISTS lesson_type TEXT NOT NULL DEFAULT 'regular';

-- Subject
ALTER TABLE public.tutor_lessons
  ADD COLUMN IF NOT EXISTS subject TEXT;

-- Recurring lesson fields
ALTER TABLE public.tutor_lessons
  ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.tutor_lessons
  ADD COLUMN IF NOT EXISTS recurrence_rule TEXT;

ALTER TABLE public.tutor_lessons
  ADD COLUMN IF NOT EXISTS parent_lesson_id UUID REFERENCES public.tutor_lessons(id) ON DELETE SET NULL;

-- External source fields (Google Calendar import)
ALTER TABLE public.tutor_lessons
  ADD COLUMN IF NOT EXISTS external_source TEXT;

ALTER TABLE public.tutor_lessons
  ADD COLUMN IF NOT EXISTS external_event_id TEXT;

ALTER TABLE public.tutor_lessons
  ADD COLUMN IF NOT EXISTS external_calendar_id TEXT;

ALTER TABLE public.tutor_lessons
  ADD COLUMN IF NOT EXISTS external_event_updated_at TEXT;

-- Unique constraint for deduplication of imported events
CREATE UNIQUE INDEX IF NOT EXISTS idx_tutor_lessons_external_dedup
  ON public.tutor_lessons (tutor_id, external_source, external_event_id)
  WHERE external_source IS NOT NULL AND external_event_id IS NOT NULL;

-- Index for recurring lesson lookups
CREATE INDEX IF NOT EXISTS idx_tutor_lessons_parent
  ON public.tutor_lessons (parent_lesson_id)
  WHERE parent_lesson_id IS NOT NULL;

-- =============================================
-- 2. Google Calendar OAuth states (temporary, for secure callback)
-- =============================================

CREATE TABLE IF NOT EXISTS public.tutor_google_oauth_states (
  state TEXT PRIMARY KEY,
  tutor_id UUID NOT NULL REFERENCES public.tutors(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-cleanup expired states
CREATE INDEX IF NOT EXISTS idx_google_oauth_states_expires
  ON public.tutor_google_oauth_states (expires_at);

-- RLS: service role only (edge functions use service role key)
ALTER TABLE public.tutor_google_oauth_states ENABLE ROW LEVEL SECURITY;

-- =============================================
-- 3. Google Calendar connections
-- =============================================

CREATE TABLE IF NOT EXISTS public.tutor_google_calendar_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id UUID NOT NULL UNIQUE REFERENCES public.tutors(id) ON DELETE CASCADE,
  google_email TEXT NOT NULL,
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  refresh_token TEXT,
  access_token TEXT NOT NULL,
  access_token_expires_at TIMESTAMPTZ NOT NULL,
  last_import_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: service role only (edge functions manage tokens)
ALTER TABLE public.tutor_google_calendar_connections ENABLE ROW LEVEL SECURITY;
