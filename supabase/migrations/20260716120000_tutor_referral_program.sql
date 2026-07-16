-- ============================================================================
-- Реферальная программа репетиторов v1 — attribution-only (Stage 3
-- CEO-аналитики; spec docs/delivery/features/ceo-analytics/spec.md, rule 101).
--
-- Репетитор получает личный код для приглашения КОЛЛЕГ-репетиторов
-- (НЕ путать с tutors.invite_code — тот для приглашения УЧЕНИКОВ):
--   * tutors.referral_code — UPPERCASE-алфавит, визуально отличим от
--     lowercase-ученических кодов;
--   * profiles.referred_by_code — кто привёл (first-write-wins, зеркало
--     семантики promo_code); referred_at — момент привязки (под будущие
--     ретро-бонусы «ранним амбассадорам»).
-- referred_by_tutor_id НЕ заводим: код UNIQUE и не переиздаётся — резолв
-- по коду в runtime, один канонический write-path (signup/profile/admin).
--
-- v1 БЕЗ денег (решение владельца 2026-07-15): бонусы (−15% новичку,
-- 10% рефереру) — отдельная money-спека. TODO money-версии (анти-фрод):
--   * profiles-UPDATE policy позволяет юзеру самому записать referred_by_code
--     через PostgREST — в v1 это эквивалент легального ввода кода (мусорные
--     значения нейтрализуются резолвом: нерезолвящийся код = канал «Органика»);
--     при деньгах — REVOKE column-update + запись только через edge.
--   * rate-limit на claim, окно привязки от регистрации, связка код↔оплата.
--
-- RLS-posture (осознанно): tutors.referral_code публично читаем существующей
-- политикой "Anyone can view tutor by invite_code" (USING invite_code IS NOT
-- NULL — построчная, колонки не режет). Тот же posture, что у invite_code:
-- код и так публично шарится; self-referral блокируется серверно.
-- ============================================================================

-- ── 1. Генератор кода: 8 симв. UPPERCASE (без путающих 0/O/1/I/L) ──────────
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
-- SECURITY INVOKER, данных не читает — revoke-церемония rule 99 не требуется.

-- ── 2. Колонка кода у репетитора ────────────────────────────────────────────
ALTER TABLE public.tutors
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;

COMMENT ON COLUMN public.tutors.referral_code IS
  'Реферальный код для приглашения КОЛЛЕГ-репетиторов (UPPERCASE). НЕ путать с invite_code (приглашение учеников, lowercase).';

-- ── 3. Backfill существующим (паттерн 20260201140000_tutor_invite_code_c21) ─
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

-- ── 4. DEFAULT для новых строк (триггер не нужен — mirror invite_code) ──────
ALTER TABLE public.tutors
  ALTER COLUMN referral_code SET DEFAULT public.generate_referral_code();

-- ── 5. Сторона приглашённого ────────────────────────────────────────────────
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

-- ── 6. analytics_events CHECK: + referral-события ───────────────────────────
-- Whitelist скопирован из ПОСЛЕДНЕЙ версии (20260715120000) + 2 новых.
ALTER TABLE public.analytics_events
  DROP CONSTRAINT IF EXISTS analytics_events_event_name_check;

ALTER TABLE public.analytics_events
  ADD CONSTRAINT analytics_events_event_name_check CHECK (event_name IN (
    -- репетитор (онбординг v2)
    'tutor_first_student_added',
    'invite_generated',
    'tutor_first_homework_created',
    'homework_sent_to_student',
    'student_received_and_opened',
    -- ученик (онбординг v2)
    'invite_claimed',
    'student_first_login',
    'student_registered',
    'student_first_homework_opened',
    'student_first_submission',
    -- воронка оплаты тарифа репетитора (round 3, 2026-07-02)
    'tutor_payment_created',
    'tutor_payment_succeeded',
    -- демо-разбор (v2.1 W1, 2026-07-08)
    'tutor_demo_check_viewed',
    'tutor_demo_check_ran',
    -- чат репетитор↔ученик (2026-07-12)
    'chat_first_message_sent',
    'tutor_chat_ai_ran',
    'student_chat_ai_ran',
    -- QR-онбординг лидов Егора (2026-07-13)
    'qr_lead_registered',
    'promo_captured',
    'community_cta_clicked',
    -- клиентские краши (2026-07-15)
    'client_error',
    -- рефералка репетиторов v1 (2026-07-16): attributed — привязка кода
    -- (source = signup|profile|admin, tutor_id = tutors.id реферера,
    -- actor_user_id = приглашённый); copied — клик «скопировать» в кабинете
    'referral_attributed',
    'referral_code_copied'
  ));
