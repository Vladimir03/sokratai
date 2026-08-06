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

-- ════════════════════════════════════════════════════════════════════════════
-- 2. complete_lesson_and_create_payment — advisory-локи ДО UPDATE строки занятия
-- ════════════════════════════════════════════════════════════════════════════
-- Контроль-ревью Волны 2 (P1): completion делал row-lock (UPDATE tutor_lessons) и
-- ЗАТЕМ ждал advisory внутри _apply; series-cost держит advisory и ждёт row-lock
-- (FOR UPDATE) → взаимоблокировка. Единый порядок ВЕЗДЕ: advisory → row.
-- Тело VERBATIM из 20260616203136 + блок предзахвата локов (пометка -- M3 LOCK).
CREATE OR REPLACE FUNCTION public.complete_lesson_and_create_payment(
  _lesson_id uuid,
  _amount integer,
  _payment_status text DEFAULT 'pending',
  _tutor_telegram_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  _tutor_id uuid;
  _tutor_student_id uuid;
  _is_group boolean;
  _actor uuid;
  _locked_students uuid[];
  _s uuid;
BEGIN
  IF _tutor_telegram_id IS NOT NULL THEN
    SELECT t.id, l.tutor_student_id INTO _tutor_id, _tutor_student_id
    FROM public.tutors t JOIN public.tutor_lessons l ON l.tutor_id = t.id
    WHERE l.id = _lesson_id AND t.telegram_id = _tutor_telegram_id;
  ELSE
    SELECT t.id, l.tutor_student_id INTO _tutor_id, _tutor_student_id
    FROM public.tutors t JOIN public.tutor_lessons l ON l.tutor_id = t.id
    WHERE l.id = _lesson_id AND t.user_id = auth.uid();
  END IF;

  IF _tutor_id IS NULL THEN
    RETURN false;
  END IF;

  _actor := COALESCE(auth.uid(), (SELECT user_id FROM public.tutors WHERE id = _tutor_id));

  SELECT EXISTS (
    SELECT 1 FROM public.tutor_lesson_participants WHERE lesson_id = _lesson_id
  ) INTO _is_group;

  -- M3 LOCK: advisory-локи всех учеников В КАНОНИЧЕСКОМ порядке (student ASC)
  -- ДО UPDATE tutor_lessons — иначе цикл с series-cost/move (advisory → row).
  IF _is_group THEN
    SELECT ARRAY(
      SELECT p.tutor_student_id FROM public.tutor_lesson_participants p
      WHERE p.lesson_id = _lesson_id ORDER BY p.tutor_student_id
    ) INTO _locked_students;
  ELSIF _tutor_student_id IS NOT NULL THEN
    _locked_students := ARRAY[_tutor_student_id];
  ELSE
    _locked_students := ARRAY[]::uuid[];
  END IF;
  FOREACH _s IN ARRAY _locked_students LOOP
    PERFORM pg_advisory_xact_lock(hashtext(_lesson_id::text), hashtext(_s::text));
  END LOOP;

  UPDATE public.tutor_lessons
  SET
    status = 'completed',
    payment_status = _payment_status,
    payment_amount = CASE WHEN NOT _is_group THEN _amount ELSE NULL END,
    paid_at = CASE WHEN _payment_status IN ('paid', 'paid_earlier') THEN NOW() ELSE NULL END,
    payment_reminder_sent = true
  WHERE id = _lesson_id;

  -- M3 LOCK (контроль-ревью-3 P1): второй цикл идёт по ЗАЛОЧЕННОМУ снапшоту, НЕ по
  -- свежему чтению — участник, добавленный конкурентно после пре-лока, не залочен,
  -- и попытка _apply на нём под удерживаемым row-lock вернула бы deadlock-цикл
  -- с series-cost. Его дебет создаст cron tutor_auto_debit_due_lessons (идемпотентно).
  FOREACH _s IN ARRAY _locked_students LOOP
    PERFORM public._apply_lesson_debit_from_current_cost(_lesson_id, _s, _actor);
    IF _is_group THEN
      UPDATE public.tutor_lesson_participants
      SET payment_status = _payment_status,
          paid_at = CASE WHEN _payment_status IN ('paid', 'paid_earlier') THEN NOW() ELSE NULL END
      WHERE lesson_id = _lesson_id AND tutor_student_id = _s;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_lesson_and_create_payment(uuid, integer, text, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
