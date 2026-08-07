DROP FUNCTION IF EXISTS public.tutor_move_lesson(uuid, timestamptz, integer, boolean, uuid, uuid);
DROP FUNCTION IF EXISTS public.tutor_move_lesson(uuid, timestamptz);

CREATE OR REPLACE FUNCTION public.tutor_move_lesson(
  _lesson_id uuid,
  _new_start_at timestamptz,
  _new_duration_min integer DEFAULT NULL,
  _set_student boolean DEFAULT false,
  _new_tutor_student_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tutor_id uuid; _dur int; _new_profile_student uuid;
  _students uuid[]; _fresh uuid[]; _s uuid; _now_past boolean; _attached boolean;
  _debit_id uuid; _debit_on date;
BEGIN
  IF _new_start_at IS NULL THEN RAISE EXCEPTION 'INVALID_TIME'; END IF;
  IF _new_duration_min IS NOT NULL AND _new_duration_min <= 0 THEN RAISE EXCEPTION 'INVALID_TIME'; END IF;

  SELECT l.tutor_id INTO _tutor_id
  FROM public.tutor_lessons l JOIN public.tutors t ON t.id = l.tutor_id
  WHERE l.id = _lesson_id AND t.user_id = auth.uid();
  IF _tutor_id IS NULL THEN RAISE EXCEPTION 'NOT_OWNED'; END IF;

  IF _set_student THEN
    IF EXISTS (SELECT 1 FROM public.tutor_lesson_participants WHERE lesson_id = _lesson_id) THEN
      RAISE EXCEPTION 'GROUP_LESSON';
    END IF;
    IF _new_tutor_student_id IS NOT NULL THEN
      SELECT ts.student_id INTO _new_profile_student
      FROM public.tutor_students ts
      WHERE ts.id = _new_tutor_student_id AND ts.tutor_id = _tutor_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_STUDENT'; END IF;
    END IF;
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT sid FROM (
      SELECT p.tutor_student_id AS sid
        FROM public.tutor_lesson_participants p WHERE p.lesson_id = _lesson_id
      UNION
      SELECT l.tutor_student_id
        FROM public.tutor_lessons l
       WHERE l.id = _lesson_id AND l.tutor_student_id IS NOT NULL
      UNION
      SELECT _new_tutor_student_id WHERE _set_student AND _new_tutor_student_id IS NOT NULL
      UNION
      SELECT e.tutor_student_id
        FROM public.tutor_ledger_entries e
       WHERE e.source_lesson_id = _lesson_id AND e.source_kind = 'lesson'
         AND e.kind = 'debit' AND e.reversed_by_entry_id IS NULL
    ) s WHERE sid IS NOT NULL ORDER BY sid
  ) INTO _students;

  FOREACH _s IN ARRAY _students LOOP
    PERFORM pg_advisory_xact_lock(hashtext(_lesson_id::text), hashtext(_s::text));
  END LOOP;

  SELECT ARRAY(
    SELECT DISTINCT sid FROM (
      SELECT p.tutor_student_id AS sid
        FROM public.tutor_lesson_participants p WHERE p.lesson_id = _lesson_id
      UNION
      SELECT l.tutor_student_id
        FROM public.tutor_lessons l
       WHERE l.id = _lesson_id AND l.tutor_student_id IS NOT NULL
      UNION
      SELECT e.tutor_student_id
        FROM public.tutor_ledger_entries e
       WHERE e.source_lesson_id = _lesson_id AND e.source_kind = 'lesson'
         AND e.kind = 'debit' AND e.reversed_by_entry_id IS NULL
    ) s WHERE sid IS NOT NULL ORDER BY sid
  ) INTO _fresh;
  IF EXISTS (SELECT 1 FROM unnest(_fresh) f WHERE f <> ALL(_students)) THEN
    RAISE EXCEPTION 'LEDGER_CONFLICT';
  END IF;

  PERFORM set_config('app.lesson_move', 'on', true);
  UPDATE public.tutor_lessons
     SET start_at = _new_start_at,
         duration_min = COALESCE(_new_duration_min, duration_min),
         tutor_student_id = CASE WHEN _set_student THEN _new_tutor_student_id ELSE tutor_student_id END,
         student_id = CASE WHEN _set_student THEN _new_profile_student ELSE student_id END
   WHERE id = _lesson_id AND status = 'booked'
   RETURNING COALESCE(duration_min, 60) INTO _dur;
  PERFORM set_config('app.lesson_move', 'off', true);
  IF _dur IS NULL THEN RAISE EXCEPTION 'NOT_BOOKED'; END IF;

  _now_past := (_new_start_at + make_interval(mins => _dur) <= now());

  FOREACH _s IN ARRAY _students LOOP
    SELECT (
      EXISTS (SELECT 1 FROM public.tutor_lesson_participants p
              WHERE p.lesson_id = _lesson_id AND p.tutor_student_id = _s)
      OR EXISTS (SELECT 1 FROM public.tutor_lessons l
                 WHERE l.id = _lesson_id AND l.tutor_student_id = _s)
    ) INTO _attached;

    IF NOT _attached THEN
      PERFORM public._reverse_lesson_debit(_lesson_id, _s);
      CONTINUE;
    END IF;

    IF _now_past THEN
      SELECT e.id, e.occurred_on INTO _debit_id, _debit_on
      FROM public.tutor_ledger_entries e
      WHERE e.source_lesson_id = _lesson_id AND e.tutor_student_id = _s
        AND e.source_kind = 'lesson' AND e.kind = 'debit' AND e.reversed_by_entry_id IS NULL
      LIMIT 1;
      IF _debit_id IS NOT NULL AND _debit_on IS DISTINCT FROM _new_start_at::date THEN
        PERFORM public._reverse_lesson_debit(_lesson_id, _s);
      END IF;
      _debit_id := NULL; _debit_on := NULL;
      PERFORM public._apply_lesson_debit_from_current_cost(_lesson_id, _s, auth.uid());
    ELSE
      PERFORM public._reverse_lesson_debit(_lesson_id, _s);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'is_past', _now_past,
    'students', COALESCE(array_length(_students, 1), 0)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.tutor_move_lesson(uuid, timestamptz, integer, boolean, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.tutor_move_lesson(uuid, timestamptz, integer, boolean, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tutor_move_lesson(uuid, timestamptz, integer, boolean, uuid) FROM anon;

CREATE OR REPLACE FUNCTION public.tutor_lessons_guard_start_move()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(current_setting('app.lesson_move', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF (OLD.start_at + make_interval(mins => COALESCE(OLD.duration_min, 60)) <= now())
     AND EXISTS (
       SELECT 1 FROM public.tutor_ledger_entries e
       WHERE e.source_lesson_id = OLD.id AND e.source_kind = 'lesson'
         AND e.kind = 'debit' AND e.reversed_by_entry_id IS NULL
     )
  THEN
    RAISE EXCEPTION 'MOVE_VIA_RPC';
  END IF;
  IF (NEW.start_at + make_interval(mins => COALESCE(NEW.duration_min, 60)) <= now()) THEN
    RAISE EXCEPTION 'MOVE_VIA_RPC';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tutor_lessons_guard_start_move ON public.tutor_lessons;
CREATE TRIGGER trg_tutor_lessons_guard_start_move
BEFORE UPDATE OF start_at ON public.tutor_lessons
FOR EACH ROW
WHEN (OLD.start_at IS DISTINCT FROM NEW.start_at)
EXECUTE FUNCTION public.tutor_lessons_guard_start_move();

NOTIFY pgrst, 'reload schema';