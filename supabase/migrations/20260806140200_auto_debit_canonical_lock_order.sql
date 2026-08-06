-- Волна 2 Расписания (M3): канонический порядок advisory-локов в cron-авто-списании.
--
-- tutor_auto_debit_due_lessons копит 2-key локи ОДНОЙ транзакцией на весь прогон
-- (per-tutor), но loop шёл без ORDER BY → с появлением multi-lock RPC
-- (tutor_set_*_cost_series, tutor_move_lesson — обе лочат в порядке lesson id ASC /
-- tutor_student_id ASC) возможна взаимоблокировка cron ↔ RPC. Re-assert verbatim
-- из 20260615190000 + детерминированный порядок: занятия по l.id ASC, участники
-- по tutor_student_id ASC → все multi-lock транзакции берут локи в одном глобальном
-- порядке, deadlock исключён структурно (rule 60 §15).
CREATE OR REPLACE FUNCTION public.tutor_auto_debit_due_lessons(_tutor_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _lesson RECORD; _student RECORD; _actor uuid; _processed int := 0; _errors int := 0;
BEGIN
  FOR _lesson IN
    SELECT l.id, l.tutor_id, l.tutor_student_id
    FROM public.tutor_lessons l
    WHERE (_tutor_id IS NULL OR l.tutor_id = _tutor_id)
      AND l.start_at + make_interval(mins => COALESCE(l.duration_min, 60)) <= now()
      AND l.start_at >= now() - interval '60 days'
    ORDER BY l.id                                   -- канонический порядок локов (M3)
  LOOP
    BEGIN
      _actor := COALESCE(auth.uid(), (SELECT user_id FROM public.tutors WHERE id = _lesson.tutor_id));
      IF EXISTS (SELECT 1 FROM public.tutor_lesson_participants p WHERE p.lesson_id = _lesson.id) THEN
        FOR _student IN
          SELECT tutor_student_id FROM public.tutor_lesson_participants
          WHERE lesson_id = _lesson.id
          ORDER BY tutor_student_id                 -- канонический порядок локов (M3)
        LOOP
          PERFORM public._apply_lesson_debit_from_current_cost(_lesson.id, _student.tutor_student_id, _actor);
          _processed := _processed + 1;
        END LOOP;
      ELSIF _lesson.tutor_student_id IS NOT NULL THEN
        PERFORM public._apply_lesson_debit_from_current_cost(_lesson.id, _lesson.tutor_student_id, _actor);
        _processed := _processed + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      _errors := _errors + 1;                                                  -- одно занятие не валит прогон
    END;
  END LOOP;
  RETURN jsonb_build_object('processed', _processed, 'errors', _errors);
END $$;

REVOKE ALL ON FUNCTION public.tutor_auto_debit_due_lessons(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_auto_debit_due_lessons(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
