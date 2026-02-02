-- =============================================
-- A1: Календарь репетитора — таблицы расписания
-- =============================================

-- 1. Недельные слоты доступности
CREATE TABLE IF NOT EXISTS public.tutor_weekly_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id UUID NOT NULL REFERENCES public.tutors(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Пн, 6=Вс
  start_time TIME NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 60,
  is_available BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_tutor_weekly_slots_tutor ON public.tutor_weekly_slots(tutor_id);
CREATE INDEX idx_tutor_weekly_slots_day ON public.tutor_weekly_slots(tutor_id, day_of_week);

ALTER TABLE public.tutor_weekly_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tutors can view own weekly slots"
  ON public.tutor_weekly_slots FOR SELECT
  USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

CREATE POLICY "Tutors can insert own weekly slots"
  ON public.tutor_weekly_slots FOR INSERT
  WITH CHECK (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

CREATE POLICY "Tutors can update own weekly slots"
  ON public.tutor_weekly_slots FOR UPDATE
  USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

CREATE POLICY "Tutors can delete own weekly slots"
  ON public.tutor_weekly_slots FOR DELETE
  USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

-- Public read for booking page
CREATE POLICY "Anyone can view available slots for booking"
  ON public.tutor_weekly_slots FOR SELECT
  USING (is_available = true);

CREATE TRIGGER update_tutor_weekly_slots_updated_at
  BEFORE UPDATE ON public.tutor_weekly_slots
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tutor_weekly_slots TO authenticated;
GRANT SELECT ON public.tutor_weekly_slots TO anon;

-- 2. Занятия (бронирования)
CREATE TABLE IF NOT EXISTS public.tutor_lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id UUID NOT NULL REFERENCES public.tutors(id) ON DELETE CASCADE,
  tutor_student_id UUID REFERENCES public.tutor_students(id) ON DELETE SET NULL,
  student_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  start_at TIMESTAMPTZ NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 60,
  status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'completed', 'cancelled')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'self_booking')),
  lesson_type TEXT NOT NULL DEFAULT 'regular' CHECK (lesson_type IN ('regular', 'trial', 'mock_exam', 'consultation')),
  subject TEXT,
  notes TEXT,
  cancelled_at TIMESTAMPTZ,
  cancelled_by TEXT CHECK (cancelled_by IN ('tutor', 'student')),
  -- Повторяющиеся занятия
  is_recurring BOOLEAN NOT NULL DEFAULT false,
  recurrence_rule TEXT CHECK (recurrence_rule IN ('weekly', 'biweekly')),
  parent_lesson_id UUID REFERENCES public.tutor_lessons(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_tutor_lessons_tutor_time ON public.tutor_lessons(tutor_id, start_at);
CREATE INDEX idx_tutor_lessons_student ON public.tutor_lessons(student_id);
CREATE INDEX idx_tutor_lessons_tutor_student ON public.tutor_lessons(tutor_student_id);
CREATE INDEX idx_tutor_lessons_status ON public.tutor_lessons(tutor_id, status);

ALTER TABLE public.tutor_lessons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tutors can view own lessons"
  ON public.tutor_lessons FOR SELECT
  USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

CREATE POLICY "Tutors can insert own lessons"
  ON public.tutor_lessons FOR INSERT
  WITH CHECK (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

CREATE POLICY "Tutors can update own lessons"
  ON public.tutor_lessons FOR UPDATE
  USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

CREATE POLICY "Tutors can delete own lessons"
  ON public.tutor_lessons FOR DELETE
  USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

-- Ученики видят свои занятия
CREATE POLICY "Students can view own lessons"
  ON public.tutor_lessons FOR SELECT
  USING (student_id = auth.uid());

CREATE TRIGGER update_tutor_lessons_updated_at
  BEFORE UPDATE ON public.tutor_lessons
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tutor_lessons TO authenticated;

-- 3. Настройки напоминаний
CREATE TABLE IF NOT EXISTS public.tutor_reminder_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id UUID NOT NULL REFERENCES public.tutors(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  remind_before_minutes INTEGER[] NOT NULL DEFAULT '{1440, 60}',
  template_student TEXT NOT NULL DEFAULT 'Привет! Напоминаю о занятии {{date}} в {{time}}. До встречи!',
  template_tutor TEXT NOT NULL DEFAULT 'Занятие с {{student_name}} {{date}} в {{time}}.',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT tutor_reminder_settings_tutor_unique UNIQUE (tutor_id)
);

ALTER TABLE public.tutor_reminder_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tutors can view own reminder settings"
  ON public.tutor_reminder_settings FOR SELECT
  USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

CREATE POLICY "Tutors can insert own reminder settings"
  ON public.tutor_reminder_settings FOR INSERT
  WITH CHECK (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

CREATE POLICY "Tutors can update own reminder settings"
  ON public.tutor_reminder_settings FOR UPDATE
  USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

CREATE TRIGGER update_tutor_reminder_settings_updated_at
  BEFORE UPDATE ON public.tutor_reminder_settings
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

GRANT SELECT, INSERT, UPDATE ON public.tutor_reminder_settings TO authenticated;

-- 4. Настройки календаря
CREATE TABLE IF NOT EXISTS public.tutor_calendar_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id UUID NOT NULL REFERENCES public.tutors(id) ON DELETE CASCADE,
  default_duration INTEGER NOT NULL DEFAULT 60,
  buffer_minutes INTEGER NOT NULL DEFAULT 15,
  min_notice_hours INTEGER NOT NULL DEFAULT 24,
  max_advance_days INTEGER NOT NULL DEFAULT 30,
  auto_confirm BOOLEAN NOT NULL DEFAULT true,
  allow_student_cancel BOOLEAN NOT NULL DEFAULT true,
  cancel_notice_hours INTEGER NOT NULL DEFAULT 24,
  timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT tutor_calendar_settings_tutor_unique UNIQUE (tutor_id)
);

ALTER TABLE public.tutor_calendar_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tutors can view own calendar settings"
  ON public.tutor_calendar_settings FOR SELECT
  USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

CREATE POLICY "Tutors can insert own calendar settings"
  ON public.tutor_calendar_settings FOR INSERT
  WITH CHECK (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

CREATE POLICY "Tutors can update own calendar settings"
  ON public.tutor_calendar_settings FOR UPDATE
  USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

CREATE TRIGGER update_tutor_calendar_settings_updated_at
  BEFORE UPDATE ON public.tutor_calendar_settings
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

GRANT SELECT, INSERT, UPDATE ON public.tutor_calendar_settings TO authenticated;

-- Public read for booking (to know buffer, duration etc.)
CREATE POLICY "Anyone can view calendar settings for booking"
  ON public.tutor_calendar_settings FOR SELECT
  USING (true);

GRANT SELECT ON public.tutor_calendar_settings TO anon;

-- 5. Исключения (отпуск, болезнь)
CREATE TABLE IF NOT EXISTS public.tutor_availability_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id UUID NOT NULL REFERENCES public.tutors(id) ON DELETE CASCADE,
  exception_date DATE NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_tutor_exceptions_tutor_date ON public.tutor_availability_exceptions(tutor_id, exception_date);

ALTER TABLE public.tutor_availability_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tutors can manage own exceptions"
  ON public.tutor_availability_exceptions FOR ALL
  USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

-- Public read for booking
CREATE POLICY "Anyone can view exceptions for booking"
  ON public.tutor_availability_exceptions FOR SELECT
  USING (true);

CREATE TRIGGER update_tutor_availability_exceptions_updated_at
  BEFORE UPDATE ON public.tutor_availability_exceptions
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tutor_availability_exceptions TO authenticated;
GRANT SELECT ON public.tutor_availability_exceptions TO anon;

-- 6. RPC: Получить доступные слоты для записи
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
  -- Find tutor
  SELECT id INTO _tutor_id FROM tutors WHERE booking_link = _booking_link;
  IF _tutor_id IS NULL THEN
    RETURN;
  END IF;

  -- Get calendar settings (or defaults)
  SELECT
    COALESCE(cs.default_duration, 60),
    COALESCE(cs.buffer_minutes, 15),
    COALESCE(cs.min_notice_hours, 24),
    COALESCE(cs.max_advance_days, 30)
  INTO _default_duration, _buffer_minutes, _min_notice_hours, _max_advance_days
  FROM tutors t
  LEFT JOIN tutor_calendar_settings cs ON cs.tutor_id = t.id
  WHERE t.id = _tutor_id;

  -- Limit days ahead
  IF _days_ahead > _max_advance_days THEN
    _days_ahead := _max_advance_days;
  END IF;

  RETURN QUERY
  WITH date_range AS (
    SELECT generate_series(
      CURRENT_DATE,
      CURRENT_DATE + _days_ahead - 1,
      '1 day'::interval
    )::date AS d
  ),
  -- Get weekly slots for this tutor
  weekly AS (
    SELECT ws.day_of_week, ws.start_time AS st, ws.duration_min AS dur
    FROM tutor_weekly_slots ws
    WHERE ws.tutor_id = _tutor_id AND ws.is_available = true
  ),
  -- Expand weekly slots to actual dates
  expanded AS (
    SELECT
      dr.d AS slot_date,
      w.st AS start_time,
      COALESCE(w.dur, _default_duration) AS duration_min
    FROM date_range dr
    JOIN weekly w ON w.day_of_week = EXTRACT(ISODOW FROM dr.d)::integer - 1
    -- Exclude exception dates
    WHERE NOT EXISTS (
      SELECT 1 FROM tutor_availability_exceptions ae
      WHERE ae.tutor_id = _tutor_id AND ae.exception_date = dr.d
    )
    -- Min notice: slot must be at least N hours from now
    AND (dr.d + w.st) > (now() + (_min_notice_hours || ' hours')::interval)
  ),
  -- Check which expanded slots are already booked
  booked AS (
    SELECT
      e.slot_date,
      e.start_time,
      e.duration_min,
      EXISTS (
        SELECT 1 FROM tutor_lessons l
        WHERE l.tutor_id = _tutor_id
          AND l.status = 'booked'
          AND l.start_at::date = e.slot_date
          -- Check overlap: lesson overlaps with slot (considering buffer)
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

-- 7. RPC: Забронировать слот
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

  -- Find tutor
  SELECT id INTO _tutor_id FROM tutors WHERE booking_link = _booking_link;
  IF _tutor_id IS NULL THEN
    RAISE EXCEPTION 'Tutor not found';
  END IF;

  -- Get buffer
  SELECT COALESCE(cs.buffer_minutes, 15) INTO _buffer
  FROM tutors t
  LEFT JOIN tutor_calendar_settings cs ON cs.tutor_id = t.id
  WHERE t.id = _tutor_id;

  -- Check for conflicts
  SELECT EXISTS (
    SELECT 1 FROM tutor_lessons l
    WHERE l.tutor_id = _tutor_id
      AND l.status = 'booked'
      AND l.start_at < (_slot_date + _start_time + (_duration_min || ' minutes')::interval + (_buffer || ' minutes')::interval)
      AND (l.start_at + (l.duration_min || ' minutes')::interval + (_buffer || ' minutes')::interval) > (_slot_date + _start_time)
  ) INTO _conflict;

  IF _conflict THEN
    RAISE EXCEPTION 'Slot is already booked';
  END IF;

  -- Find tutor_student relationship (if exists)
  SELECT ts.id INTO _tutor_student_id
  FROM tutor_students ts
  WHERE ts.tutor_id = _tutor_id AND ts.student_id = _student_id
  LIMIT 1;

  -- Create lesson
  INSERT INTO tutor_lessons (tutor_id, tutor_student_id, student_id, start_at, duration_min, status, source)
  VALUES (
    _tutor_id,
    _tutor_student_id,
    _student_id,
    _slot_date + _start_time,
    _duration_min,
    'booked',
    'self_booking'
  )
  RETURNING id INTO _lesson_id;

  RETURN _lesson_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.book_lesson_slot(TEXT, DATE, TIME, INTEGER) TO authenticated;
