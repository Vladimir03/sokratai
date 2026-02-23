-- =============================================
-- ВАУ-фича: Завершение урока и создание платежа
-- =============================================

CREATE OR REPLACE FUNCTION public.complete_lesson_and_create_payment(
  _lesson_id UUID,
  _amount INTEGER,
  _payment_status TEXT DEFAULT 'pending',
  _tutor_telegram_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tutor_id UUID;
  _tutor_student_id UUID;
BEGIN
  -- Проверяем права: либо через telegram_id, либо через auth.uid()
  IF _tutor_telegram_id IS NOT NULL THEN
    SELECT t.id, l.tutor_student_id INTO _tutor_id, _tutor_student_id
    FROM tutors t
    JOIN tutor_lessons l ON l.tutor_id = t.id
    WHERE l.id = _lesson_id AND t.telegram_id = _tutor_telegram_id;
  ELSE
    SELECT t.id, l.tutor_student_id INTO _tutor_id, _tutor_student_id
    FROM tutors t
    JOIN tutor_lessons l ON l.tutor_id = t.id
    WHERE l.id = _lesson_id AND t.user_id = auth.uid();
  END IF;

  IF _tutor_id IS NULL THEN
    RETURN false;
  END IF;

  -- Обновляем статус урока
  UPDATE tutor_lessons
  SET
    status = 'completed',
    payment_status = _payment_status,
    payment_amount = _amount,
    paid_at = CASE WHEN _payment_status IN ('paid', 'paid_earlier') THEN NOW() ELSE NULL END,
    payment_reminder_sent = true
  WHERE id = _lesson_id;

  -- Создаем запись в tutor_payments, если указана сумма и есть ученик
  IF _amount IS NOT NULL AND _amount > 0 AND _tutor_student_id IS NOT NULL THEN
    INSERT INTO tutor_payments (
      tutor_student_id,
      amount,
      status,
      due_date,
      paid_at
    ) VALUES (
      _tutor_student_id,
      _amount,
      CASE WHEN _payment_status IN ('paid', 'paid_earlier') THEN 'paid' ELSE 'pending' END,
      CURRENT_DATE,
      CASE WHEN _payment_status IN ('paid', 'paid_earlier') THEN NOW() ELSE NULL END
    );
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_lesson_and_create_payment(UUID, INTEGER, TEXT, TEXT) TO authenticated, service_role;

-- Обновляем функцию get_lessons_needing_payment_reminder для передачи hourly_rate_cents
DROP FUNCTION IF EXISTS public.get_lessons_needing_payment_reminder();

CREATE OR REPLACE FUNCTION public.get_lessons_needing_payment_reminder()
RETURNS TABLE (
  lesson_id UUID,
  tutor_id UUID,
  tutor_telegram_id TEXT,
  student_name TEXT,
  lesson_date DATE,
  lesson_time TIME,
  duration_min INTEGER,
  hourly_rate_cents INTEGER
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
    l.duration_min,
    ts.hourly_rate_cents
  FROM tutor_lessons l
  JOIN tutors t ON t.id = l.tutor_id
  LEFT JOIN tutor_students ts ON ts.id = l.tutor_student_id
  LEFT JOIN tutor_calendar_settings cs ON cs.tutor_id = l.tutor_id
  LEFT JOIN profiles p ON p.id = l.student_id
  WHERE l.status IN ('booked', 'completed') -- берем и booked (недавно завершенные), и completed (неоплаченные)
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
