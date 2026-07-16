-- Реферальная программа репетиторов v1 (attribution-only)
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql VOLATILE;

ALTER TABLE public.tutors
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;

COMMENT ON COLUMN public.tutors.referral_code IS
  'Реферальный код для приглашения КОЛЛЕГ-репетиторов (UPPERCASE). НЕ путать с invite_code (приглашение учеников, lowercase).';

DO $$
DECLARE
  tutor_record RECORD;
  new_code TEXT;
  code_exists BOOLEAN;
BEGIN
  FOR tutor_record IN SELECT id FROM public.tutors WHERE referral_code IS NULL LOOP
    LOOP
      new_code := public.generate_referral_code();
      SELECT EXISTS(SELECT 1 FROM public.tutors WHERE referral_code = new_code) INTO code_exists;
      EXIT WHEN NOT code_exists;
    END LOOP;
    UPDATE public.tutors SET referral_code = new_code WHERE id = tutor_record.id;
  END LOOP;
END $$;

ALTER TABLE public.tutors
  ALTER COLUMN referral_code SET DEFAULT public.generate_referral_code();

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referred_by_code TEXT,
  ADD COLUMN IF NOT EXISTS referred_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.referred_by_code IS
  'Реферальный код репетитора, который привёл (tutors.referral_code). First-write-wins; admin-ретро-привязка может перезаписать.';
COMMENT ON COLUMN public.profiles.referred_at IS
  'Момент привязки реферального кода — под ретроактивные бонусы ранним.';

CREATE INDEX IF NOT EXISTS idx_profiles_referred_by_code
  ON public.profiles (referred_by_code)
  WHERE referred_by_code IS NOT NULL;

ALTER TABLE public.analytics_events
  DROP CONSTRAINT IF EXISTS analytics_events_event_name_check;

ALTER TABLE public.analytics_events
  ADD CONSTRAINT analytics_events_event_name_check CHECK (event_name IN (
    'tutor_first_student_added',
    'invite_generated',
    'tutor_first_homework_created',
    'homework_sent_to_student',
    'student_received_and_opened',
    'invite_claimed',
    'student_first_login',
    'student_registered',
    'student_first_homework_opened',
    'student_first_submission',
    'tutor_payment_created',
    'tutor_payment_succeeded',
    'tutor_demo_check_viewed',
    'tutor_demo_check_ran',
    'chat_first_message_sent',
    'tutor_chat_ai_ran',
    'student_chat_ai_ran',
    'qr_lead_registered',
    'promo_captured',
    'community_cta_clicked',
    'client_error',
    'referral_attributed',
    'referral_code_copied'
  ));