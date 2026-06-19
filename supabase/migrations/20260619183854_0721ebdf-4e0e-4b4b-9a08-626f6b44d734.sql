-- Личные дела репетитора (busy blocks)
CREATE TABLE IF NOT EXISTS public.tutor_calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id UUID NOT NULL REFERENCES public.tutors(id) ON DELETE CASCADE,
  start_at TIMESTAMPTZ NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 60 CHECK (duration_min > 0),
  title TEXT NOT NULL,
  notes TEXT,
  is_recurring BOOLEAN NOT NULL DEFAULT false,
  recurrence_rule TEXT CHECK (recurrence_rule IS NULL OR recurrence_rule IN ('weekly')),
  parent_event_id UUID REFERENCES public.tutor_calendar_events(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tutor_calendar_events_tutor_time
  ON public.tutor_calendar_events(tutor_id, start_at);
CREATE INDEX IF NOT EXISTS idx_tutor_calendar_events_parent
  ON public.tutor_calendar_events(parent_event_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tutor_calendar_events TO authenticated;
GRANT ALL ON public.tutor_calendar_events TO service_role;

ALTER TABLE public.tutor_calendar_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tutors view own calendar events" ON public.tutor_calendar_events;
CREATE POLICY "Tutors view own calendar events" ON public.tutor_calendar_events
  FOR SELECT USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Tutors insert own calendar events" ON public.tutor_calendar_events;
CREATE POLICY "Tutors insert own calendar events" ON public.tutor_calendar_events
  FOR INSERT WITH CHECK (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Tutors update own calendar events" ON public.tutor_calendar_events;
CREATE POLICY "Tutors update own calendar events" ON public.tutor_calendar_events
  FOR UPDATE USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Tutors delete own calendar events" ON public.tutor_calendar_events;
CREATE POLICY "Tutors delete own calendar events" ON public.tutor_calendar_events
  FOR DELETE USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

DROP TRIGGER IF EXISTS trg_tutor_calendar_events_updated_at ON public.tutor_calendar_events;
CREATE TRIGGER trg_tutor_calendar_events_updated_at
  BEFORE UPDATE ON public.tutor_calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- RPC: scoped delete
CREATE OR REPLACE FUNCTION public.tutor_delete_calendar_events(
  _event_id UUID,
  _scope TEXT DEFAULT 'this'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tutor_id UUID;
  _root_id UUID;
  _from_start TIMESTAMPTZ;
  _is_recurring BOOLEAN;
  _delete_ids UUID[];
  _deleted_count INT := 0;
  _new_root UUID;
BEGIN
  IF _scope NOT IN ('this', 'this_and_following', 'all') THEN
    RAISE EXCEPTION 'INVALID_SCOPE' USING ERRCODE = '22023';
  END IF;

  SELECT t.id, COALESCE(ev.parent_event_id, ev.id), ev.start_at, COALESCE(ev.is_recurring, false)
    INTO _tutor_id, _root_id, _from_start, _is_recurring
  FROM public.tutor_calendar_events ev
  JOIN public.tutors t ON t.id = ev.tutor_id
  WHERE ev.id = _event_id
    AND t.user_id = auth.uid();

  IF _tutor_id IS NULL THEN
    RAISE EXCEPTION 'NOT_OWNED' USING ERRCODE = '42501';
  END IF;

  IF _is_recurring AND _scope = 'all' THEN
    SELECT array_agg(id) INTO _delete_ids
    FROM public.tutor_calendar_events
    WHERE tutor_id = _tutor_id
      AND (id = _root_id OR parent_event_id = _root_id);
  ELSIF _is_recurring AND _scope = 'this_and_following' THEN
    SELECT array_agg(id) INTO _delete_ids
    FROM public.tutor_calendar_events
    WHERE tutor_id = _tutor_id
      AND (id = _root_id OR parent_event_id = _root_id)
      AND (id = _event_id OR start_at >= _from_start);
  ELSE
    _delete_ids := ARRAY[_event_id];
  END IF;

  IF _root_id = ANY (_delete_ids) THEN
    SELECT id INTO _new_root
    FROM public.tutor_calendar_events
    WHERE tutor_id = _tutor_id
      AND (id = _root_id OR parent_event_id = _root_id)
      AND NOT (id = ANY (_delete_ids))
    ORDER BY start_at ASC
    LIMIT 1;

    IF _new_root IS NOT NULL THEN
      UPDATE public.tutor_calendar_events SET parent_event_id = NULL WHERE id = _new_root;
      UPDATE public.tutor_calendar_events
      SET parent_event_id = _new_root
      WHERE tutor_id = _tutor_id
        AND parent_event_id = _root_id
        AND id <> _new_root
        AND NOT (id = ANY (_delete_ids));
    END IF;
  END IF;

  WITH del AS (
    DELETE FROM public.tutor_calendar_events
    WHERE id = ANY (_delete_ids)
      AND tutor_id = _tutor_id
    RETURNING 1
  )
  SELECT count(*) INTO _deleted_count FROM del;

  RETURN jsonb_build_object('deleted', _deleted_count);
END;
$$;

REVOKE ALL ON FUNCTION public.tutor_delete_calendar_events(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_delete_calendar_events(UUID, TEXT) TO authenticated, service_role;

-- RPC: update series
CREATE OR REPLACE FUNCTION public.update_calendar_event_series(
  _root_event_id UUID,
  _selected_event_id UUID,
  _from_start_at TIMESTAMPTZ,
  _title TEXT DEFAULT NULL,
  _notes TEXT DEFAULT NULL,
  _apply_time_shift BOOLEAN DEFAULT false,
  _shift_minutes INTEGER DEFAULT 0,
  _duration_min INTEGER DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _updated_count INTEGER;
  _tutor_id UUID;
BEGIN
  SELECT t.id INTO _tutor_id
  FROM tutor_calendar_events ev
  JOIN tutors t ON t.id = ev.tutor_id
  WHERE ev.id = _root_event_id
    AND t.user_id = auth.uid();

  IF _tutor_id IS NULL THEN
    RAISE EXCEPTION 'Access denied or event not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM tutor_calendar_events ev
    WHERE ev.id = _selected_event_id
      AND ev.tutor_id = _tutor_id
      AND (ev.id = _root_event_id OR ev.parent_event_id = _root_event_id)
  ) THEN
    RAISE EXCEPTION 'Selected event is not part of the series';
  END IF;

  UPDATE tutor_calendar_events
  SET
    title = COALESCE(_title, title),
    notes = COALESCE(_notes, notes),
    duration_min = COALESCE(_duration_min, duration_min),
    start_at = CASE
      WHEN _apply_time_shift AND _shift_minutes <> 0
      THEN start_at + make_interval(mins => _shift_minutes)
      ELSE start_at
    END,
    updated_at = now()
  WHERE tutor_id = _tutor_id
    AND (id = _root_event_id OR parent_event_id = _root_event_id)
    AND (id = _selected_event_id OR start_at >= _from_start_at);

  GET DIAGNOSTICS _updated_count = ROW_COUNT;
  RETURN _updated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.update_calendar_event_series(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_calendar_event_series(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER) TO authenticated, service_role;

-- RPC override: hide busy slots from public booking
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
      (
        EXISTS (
          SELECT 1 FROM tutor_lessons l
          WHERE l.tutor_id = _tutor_id AND l.status = 'booked' AND l.start_at::date = e.slot_date
            AND l.start_at < (e.slot_date + e.start_time + (e.duration_min || ' minutes')::interval + (_buffer_minutes || ' minutes')::interval)
            AND (l.start_at + (l.duration_min || ' minutes')::interval + (_buffer_minutes || ' minutes')::interval) > (e.slot_date + e.start_time)
        )
        OR EXISTS (
          SELECT 1 FROM tutor_calendar_events ev
          WHERE ev.tutor_id = _tutor_id AND ev.start_at::date = e.slot_date
            AND ev.start_at < (e.slot_date + e.start_time + (e.duration_min || ' minutes')::interval + (_buffer_minutes || ' minutes')::interval)
            AND (ev.start_at + (ev.duration_min || ' minutes')::interval + (_buffer_minutes || ' minutes')::interval) > (e.slot_date + e.start_time)
        )
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

  SELECT (
    EXISTS (
      SELECT 1 FROM tutor_lessons l
      WHERE l.tutor_id = _tutor_id AND l.status = 'booked'
        AND l.start_at < (_slot_date + _start_time + (_duration_min || ' minutes')::interval + (_buffer || ' minutes')::interval)
        AND (l.start_at + (l.duration_min || ' minutes')::interval + (_buffer || ' minutes')::interval) > (_slot_date + _start_time)
    )
    OR EXISTS (
      SELECT 1 FROM tutor_calendar_events ev
      WHERE ev.tutor_id = _tutor_id
        AND ev.start_at < (_slot_date + _start_time + (_duration_min || ' minutes')::interval + (_buffer || ' minutes')::interval)
        AND (ev.start_at + (ev.duration_min || ' minutes')::interval + (_buffer || ' minutes')::interval) > (_slot_date + _start_time)
    )
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

NOTIFY pgrst, 'reload schema';