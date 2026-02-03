-- =============================================
-- Отслеживание оплаты занятий
-- =============================================

-- 1. Добавляем поля оплаты в tutor_lessons
ALTER TABLE public.tutor_lessons
ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid'
  CHECK (payment_status IN ('unpaid', 'paid', 'pending', 'paid_earlier')),
ADD COLUMN IF NOT EXISTS payment_amount INTEGER,
ADD COLUMN IF NOT EXISTS payment_method TEXT
  CHECK (payment_method IN ('cash', 'card', 'transfer', 'other')),
ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS payment_reminder_sent BOOLEAN DEFAULT false;

-- Индекс для поиска занятий, требующих напоминания об оплате
CREATE INDEX IF NOT EXISTS idx_tutor_lessons_payment_reminder
ON public.tutor_lessons(tutor_id, status, payment_status, payment_reminder_sent)
WHERE status = 'completed' AND payment_status = 'unpaid' AND payment_reminder_sent = false;

-- 2. Добавляем настройки напоминаний об оплате в tutor_calendar_settings
ALTER TABLE public.tutor_calendar_settings
ADD COLUMN IF NOT EXISTS payment_reminder_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS payment_reminder_delay_minutes INTEGER DEFAULT 0;

-- 3. Таблица для отслеживания онбординга функций
CREATE TABLE IF NOT EXISTS public.tutor_feature_onboarding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id UUID NOT NULL REFERENCES public.tutors(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  shown_at TIMESTAMPTZ DEFAULT now(),
  dismissed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CONSTRAINT tutor_feature_onboarding_unique UNIQUE (tutor_id, feature_key)
);

ALTER TABLE public.tutor_feature_onboarding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tutors can view own onboarding"
  ON public.tutor_feature_onboarding FOR SELECT
  USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

CREATE POLICY "Tutors can insert own onboarding"
  ON public.tutor_feature_onboarding FOR INSERT
  WITH CHECK (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

CREATE POLICY "Tutors can update own onboarding"
  ON public.tutor_feature_onboarding FOR UPDATE
  USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE ON public.tutor_feature_onboarding TO authenticated;

-- 4. Функция для получения занятий, требующих напоминания об оплате
CREATE OR REPLACE FUNCTION public.get_lessons_needing_payment_reminder()
RETURNS TABLE (
  lesson_id UUID,
  tutor_id UUID,
  tutor_telegram_id TEXT,
  student_name TEXT,
  lesson_date DATE,
  lesson_time TIME,
  duration_min INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    l.id AS lesson_id,
    l.tutor_id,
    t.telegram_id AS tutor_telegram_id,
    COALESCE(p.username, 'Ученик') AS student_name,
    l.start_at::date AS lesson_date,
    l.start_at::time AS lesson_time,
    l.duration_min
  FROM tutor_lessons l
  JOIN tutors t ON t.id = l.tutor_id
  LEFT JOIN tutor_calendar_settings cs ON cs.tutor_id = l.tutor_id
  LEFT JOIN profiles p ON p.id = l.student_id
  WHERE l.status = 'completed'
    AND l.payment_status = 'unpaid'
    AND l.payment_reminder_sent = false
    AND t.telegram_id IS NOT NULL
    AND COALESCE(cs.payment_reminder_enabled, false) = true
    AND l.start_at + (l.duration_min || ' minutes')::interval
        + (COALESCE(cs.payment_reminder_delay_minutes, 0) || ' minutes')::interval
        <= NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_lessons_needing_payment_reminder() TO service_role;

-- 5. Функция для обновления статуса оплаты из Telegram
CREATE OR REPLACE FUNCTION public.update_lesson_payment(
  _lesson_id UUID,
  _payment_status TEXT,
  _tutor_telegram_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tutor_id UUID;
BEGIN
  -- Проверяем, что telegram_id принадлежит владельцу занятия
  SELECT t.id INTO _tutor_id
  FROM tutors t
  JOIN tutor_lessons l ON l.tutor_id = t.id
  WHERE l.id = _lesson_id AND t.telegram_id = _tutor_telegram_id;

  IF _tutor_id IS NULL THEN
    RETURN false;
  END IF;

  -- Обновляем статус оплаты
  UPDATE tutor_lessons
  SET
    payment_status = _payment_status,
    paid_at = CASE WHEN _payment_status IN ('paid', 'paid_earlier') THEN NOW() ELSE NULL END,
    payment_reminder_sent = true
  WHERE id = _lesson_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_lesson_payment(UUID, TEXT, TEXT) TO service_role;

-- 6. Функция для отметки напоминания как отправленного
CREATE OR REPLACE FUNCTION public.mark_payment_reminder_sent(_lesson_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE tutor_lessons
  SET payment_reminder_sent = true
  WHERE id = _lesson_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_payment_reminder_sent(UUID) TO service_role;
