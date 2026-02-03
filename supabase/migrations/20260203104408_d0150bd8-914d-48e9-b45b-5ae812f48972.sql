-- Удаляем старые функции с другой сигнатурой
DROP FUNCTION IF EXISTS public.get_available_booking_slots(TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.book_lesson_slot(TEXT, DATE, TIME, INTEGER);
DROP FUNCTION IF EXISTS public.book_lesson_slot(TEXT, DATE, TIME, SMALLINT);

-- 1. Добавляем новые колонки в tutor_lessons (если не существуют)
DO $$ 
BEGIN
  -- lesson_type
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'tutor_lessons' AND column_name = 'lesson_type') THEN
    ALTER TABLE public.tutor_lessons ADD COLUMN lesson_type TEXT NOT NULL DEFAULT 'regular';
    ALTER TABLE public.tutor_lessons ADD CONSTRAINT tutor_lessons_lesson_type_check 
      CHECK (lesson_type IN ('regular', 'trial', 'mock_exam', 'consultation'));
  END IF;

  -- subject
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'tutor_lessons' AND column_name = 'subject') THEN
    ALTER TABLE public.tutor_lessons ADD COLUMN subject TEXT;
  END IF;

  -- is_recurring
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'tutor_lessons' AND column_name = 'is_recurring') THEN
    ALTER TABLE public.tutor_lessons ADD COLUMN is_recurring BOOLEAN NOT NULL DEFAULT false;
  END IF;

  -- recurrence_rule
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'tutor_lessons' AND column_name = 'recurrence_rule') THEN
    ALTER TABLE public.tutor_lessons ADD COLUMN recurrence_rule TEXT;
    ALTER TABLE public.tutor_lessons ADD CONSTRAINT tutor_lessons_recurrence_rule_check 
      CHECK (recurrence_rule IS NULL OR recurrence_rule IN ('weekly', 'biweekly'));
  END IF;

  -- parent_lesson_id
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'tutor_lessons' AND column_name = 'parent_lesson_id') THEN
    ALTER TABLE public.tutor_lessons ADD COLUMN parent_lesson_id UUID REFERENCES public.tutor_lessons(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 2. Создаём индексы если не существуют
CREATE INDEX IF NOT EXISTS idx_tutor_weekly_slots_tutor ON public.tutor_weekly_slots(tutor_id);
CREATE INDEX IF NOT EXISTS idx_tutor_weekly_slots_day ON public.tutor_weekly_slots(tutor_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_tutor_lessons_tutor_time ON public.tutor_lessons(tutor_id, start_at);
CREATE INDEX IF NOT EXISTS idx_tutor_lessons_student ON public.tutor_lessons(student_id);
CREATE INDEX IF NOT EXISTS idx_tutor_lessons_tutor_student ON public.tutor_lessons(tutor_student_id);
CREATE INDEX IF NOT EXISTS idx_tutor_lessons_status ON public.tutor_lessons(tutor_id, status);
CREATE INDEX IF NOT EXISTS idx_tutor_exceptions_tutor_date ON public.tutor_availability_exceptions(tutor_id, exception_date);

-- 3. Политика для учеников - бронирование через self_booking
DROP POLICY IF EXISTS "Students can book lessons" ON public.tutor_lessons;
CREATE POLICY "Students can book lessons"
  ON public.tutor_lessons FOR INSERT
  WITH CHECK (student_id = auth.uid() AND source = 'self_booking');

-- 4. Публичный доступ к настройкам календаря для страницы бронирования
DROP POLICY IF EXISTS "Anyone can view calendar settings for booking" ON public.tutor_calendar_settings;
CREATE POLICY "Anyone can view calendar settings for booking"
  ON public.tutor_calendar_settings FOR SELECT
  USING (true);

-- 5. Публичный доступ к исключениям для страницы бронирования  
DROP POLICY IF EXISTS "Anyone can view exceptions for booking" ON public.tutor_availability_exceptions;
CREATE POLICY "Anyone can view exceptions for booking"
  ON public.tutor_availability_exceptions FOR SELECT
  USING (true);

-- 6. Гранты для anon
GRANT SELECT ON public.tutor_weekly_slots TO anon;
GRANT SELECT ON public.tutor_calendar_settings TO anon;
GRANT SELECT ON public.tutor_availability_exceptions TO anon;

-- 7. Обновлённая RPC: Получить доступные слоты для записи
CREATE OR REPLACE FUNCTION public.get_available_booking_slots(
  _booking_link TEXT,
  _days_ahead INTEGER DEFAULT 14
)
RETURNS TABLE (
  slot_date DATE,
  start_time TIME,
  duration_min INTEGER,
  is_booked BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tutor_id UUID;
  _default_duration INTEGER;
  _buffer_minutes INTEGER;
  _min_notice_hours INTEGER;
  _max_advance_days INTEGER;
BEGIN
  SELECT id INTO _tutor_id FROM tutors WHERE booking_link = _booking_link;
  IF _tutor_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(cs.default_duration, 60),
    COALESCE(cs.buffer_minutes, 15),
    COALESCE(cs.min_notice_hours, 24),
    COALESCE(cs.max_advance_days, 30)
  INTO _default_duration, _buffer_minutes, _min_notice_hours, _max_advance_days
  FROM tutors t
  LEFT JOIN tutor_calendar_settings cs ON cs.tutor_id = t.id
  WHERE t.id = _tutor_id;

  IF _days_ahead > _max_advance_days THEN
    _days_ahead := _max_advance_days;
  END IF;

  RETURN QUERY
  WITH date_range AS (
    SELECT generate_series(CURRENT_DATE, CURRENT_DATE + _days_ahead - 1, '1 day'::interval)::date AS d
  ),
  weekly AS (
    SELECT ws.day_of_week, ws.start_time AS st, ws.duration_min AS dur
    FROM tutor_weekly_slots ws
    WHERE ws.tutor_id = _tutor_id AND ws.is_available = true
  ),
  expanded AS (
    SELECT dr.d AS slot_date, w.st AS start_time, COALESCE(w.dur, _default_duration) AS duration_min
    FROM date_range dr
    JOIN weekly w ON w.day_of_week = EXTRACT(ISODOW FROM dr.d)::integer - 1
    WHERE NOT EXISTS (
      SELECT 1 FROM tutor_availability_exceptions ae
      WHERE ae.tutor_id = _tutor_id AND ae.exception_date = dr.d
    )
    AND (dr.d + w.st) > (now() + (_min_notice_hours || ' hours')::interval)
  ),
  booked AS (
    SELECT e.slot_date, e.start_time, e.duration_min,
      EXISTS (
        SELECT 1 FROM tutor_lessons l
        WHERE l.tutor_id = _tutor_id AND l.status = 'booked' AND l.start_at::date = e.slot_date
          AND l.start_at < (e.slot_date + e.start_time + (e.duration_min || ' minutes')::interval + (_buffer_minutes || ' minutes')::interval)
          AND (l.start_at + (l.duration_min || ' minutes')::interval + (_buffer_minutes || ' minutes')::interval) > (e.slot_date + e.start_time)
      ) AS is_booked
    FROM expanded e
  )
  SELECT b.slot_date, b.start_time, b.duration_min, b.is_booked
  FROM booked b
  ORDER BY b.slot_date, b.start_time;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_available_booking_slots(TEXT, INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION public.get_available_booking_slots(TEXT, INTEGER) TO authenticated;

-- 8. Обновлённая RPC: Забронировать слот
CREATE OR REPLACE FUNCTION public.book_lesson_slot(
  _booking_link TEXT,
  _slot_date DATE,
  _start_time TIME,
  _duration_min INTEGER DEFAULT 60
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tutor_id UUID;
  _student_id UUID;
  _tutor_student_id UUID;
  _lesson_id UUID;
  _buffer INTEGER;
  _conflict BOOLEAN;
BEGIN
  _student_id := auth.uid();
  IF _student_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id INTO _tutor_id FROM tutors WHERE booking_link = _booking_link;
  IF _tutor_id IS NULL THEN
    RAISE EXCEPTION 'Tutor not found';
  END IF;

  SELECT COALESCE(cs.buffer_minutes, 15) INTO _buffer
  FROM tutors t
  LEFT JOIN tutor_calendar_settings cs ON cs.tutor_id = t.id
  WHERE t.id = _tutor_id;

  SELECT EXISTS (
    SELECT 1 FROM tutor_lessons l
    WHERE l.tutor_id = _tutor_id AND l.status = 'booked'
      AND l.start_at < (_slot_date + _start_time + (_duration_min || ' minutes')::interval + (_buffer || ' minutes')::interval)
      AND (l.start_at + (l.duration_min || ' minutes')::interval + (_buffer || ' minutes')::interval) > (_slot_date + _start_time)
  ) INTO _conflict;

  IF _conflict THEN
    RAISE EXCEPTION 'Slot is already booked';
  END IF;

  SELECT ts.id INTO _tutor_student_id
  FROM tutor_students ts
  WHERE ts.tutor_id = _tutor_id AND ts.student_id = _student_id
  LIMIT 1;

  INSERT INTO tutor_lessons (tutor_id, tutor_student_id, student_id, start_at, duration_min, status, source, lesson_type)
  VALUES (_tutor_id, _tutor_student_id, _student_id, _slot_date + _start_time, _duration_min, 'booked', 'self_booking', 'regular')
  RETURNING id INTO _lesson_id;

  RETURN _lesson_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.book_lesson_slot(TEXT, DATE, TIME, INTEGER) TO authenticated;