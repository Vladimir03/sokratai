ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS consent_accepted_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS consent_version text NULL,
  ADD COLUMN IF NOT EXISTS consent_source text NULL;

COMMENT ON COLUMN public.profiles.consent_accepted_at IS 'Timestamp when user accepted Offer + Privacy Policy';
COMMENT ON COLUMN public.profiles.consent_version IS 'Version tag of accepted documents, e.g. v1-2026-05';
COMMENT ON COLUMN public.profiles.consent_source IS 'Form/method that captured consent: web-signup-tutor | web-signup-student | google-oauth-tutor | google-oauth-student | telegram-oauth';