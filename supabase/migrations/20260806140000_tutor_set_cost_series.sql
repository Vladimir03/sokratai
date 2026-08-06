-- Волна 2 Расписания (money-critical): цена на СЕРИЮ занятий.
-- Запрос репетитора: «Если изменил стоимость для кого-то в группе — вопрос:
-- применить ко всем занятиям серии или только к одному».
--
-- Семантика scope ЛИТЕРАЛЬНАЯ (дизайн-решение, план 1-valiant-papert):
--   'this_and_following' — выбранное + занятия с start_at >= выбранного;
--   'all'                — вся серия, ВКЛЮЧАЯ прошедшие (пересчёт списаний; UI предупреждает).
--   «Только это» клиент шлёт в существующие tutor_set_lesson_cost / tutor_set_participant_cost.
-- Пересчёт append-only и обратим (reverse-пары видны в ленте) — «all, но прошлое не трогаем»
-- было бы ложью в интерфейсе.
--
-- Инварианты (rule 60):
--  - cancelled НЕ трогаем: их payment_amount = сумма отмены (tutor_cancel_lesson_with_charge),
--    и cron спишет именно её; перезапись = чужая механика.
--  - occurrence со сменённым учеником (tutor_student_id != выбранного) не трогаем.
--  - ORDER BY l.id — канонический порядок advisory-локов (deadlock-safety с cron, см. M3).
--  - Пересчёт трогает ТОЛЬКО debit; легаси lesson-credit до-cutover не пересчитывается (осознанно).

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Индивидуальное занятие: цена на серию
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.tutor_set_lesson_cost_series(
  _lesson_id uuid, _amount integer, _scope text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tutor_id uuid; _student uuid; _root uuid; _anchor timestamptz;
  _ids uuid[]; _id uuid;
BEGIN
  IF _amount IS NULL OR _amount < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF _scope NOT IN ('this_and_following', 'all') THEN RAISE EXCEPTION 'INVALID_SCOPE'; END IF;

  SELECT l.tutor_id, l.tutor_student_id, COALESCE(l.parent_lesson_id, l.id), l.start_at
    INTO _tutor_id, _student, _root, _anchor
  FROM public.tutor_lessons l JOIN public.tutors t ON t.id = l.tutor_id
  WHERE l.id = _lesson_id AND t.user_id = auth.uid();
  IF _tutor_id IS NULL THEN RAISE EXCEPTION 'NOT_OWNED'; END IF;
  IF _student IS NULL THEN RAISE EXCEPTION 'GROUP_LESSON'; END IF;

  SELECT ARRAY(
    SELECT l.id FROM public.tutor_lessons l
    WHERE l.tutor_id = _tutor_id
      AND (l.id = _root OR l.parent_lesson_id = _root)
      AND l.tutor_student_id = _student
      AND l.status IN ('booked', 'completed')
      AND (_scope = 'all' OR l.id = _lesson_id OR l.start_at >= _anchor)
    ORDER BY l.id
  ) INTO _ids;
  IF COALESCE(array_length(_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'NOT_OWNED'; END IF;

  UPDATE public.tutor_lessons SET payment_amount = _amount WHERE id = ANY(_ids);

  FOREACH _id IN ARRAY _ids LOOP
    -- Будущее → no-op (спишет cron по сохранённой цене); прошедшее → пересчёт под
    -- 2-key advisory-lock; 0 → waive (reverse). Всё — внутри _apply (TOCTOU-safe).
    PERFORM public._apply_lesson_debit_from_current_cost(_id, _student, auth.uid());
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'updated', COALESCE(array_length(_ids, 1), 0));
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Участник группы: цена на серию (остальные участники не тронуты)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.tutor_set_participant_cost_series(
  _lesson_id uuid, _tutor_student_id uuid, _amount integer, _scope text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tutor_id uuid; _root uuid; _anchor timestamptz;
  _ids uuid[]; _id uuid;
BEGIN
  IF _amount IS NULL OR _amount < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF _scope NOT IN ('this_and_following', 'all') THEN RAISE EXCEPTION 'INVALID_SCOPE'; END IF;

  SELECT l.tutor_id, COALESCE(l.parent_lesson_id, l.id), l.start_at
    INTO _tutor_id, _root, _anchor
  FROM public.tutor_lessons l JOIN public.tutors t ON t.id = l.tutor_id
  WHERE l.id = _lesson_id AND t.user_id = auth.uid();
  IF _tutor_id IS NULL THEN RAISE EXCEPTION 'NOT_OWNED'; END IF;

  -- Ownership участника через tutor_students.tutor_id (P2-паттерн 20260616210000).
  IF NOT EXISTS (
    SELECT 1 FROM public.tutor_lesson_participants p
    JOIN public.tutor_students ts ON ts.id = p.tutor_student_id AND ts.tutor_id = _tutor_id
    WHERE p.lesson_id = _lesson_id AND p.tutor_student_id = _tutor_student_id
  ) THEN RAISE EXCEPTION 'PARTICIPANT_NOT_FOUND'; END IF;

  -- Набор: занятия серии, где ЕСТЬ строка этого участника (снятые с занятия не трогаем).
  SELECT ARRAY(
    SELECT l.id FROM public.tutor_lessons l
    JOIN public.tutor_lesson_participants p
      ON p.lesson_id = l.id AND p.tutor_student_id = _tutor_student_id
    WHERE l.tutor_id = _tutor_id
      AND (l.id = _root OR l.parent_lesson_id = _root)
      AND l.status IN ('booked', 'completed')
      AND (_scope = 'all' OR l.id = _lesson_id OR l.start_at >= _anchor)
    ORDER BY l.id
  ) INTO _ids;
  IF COALESCE(array_length(_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'PARTICIPANT_NOT_FOUND'; END IF;

  UPDATE public.tutor_lesson_participants SET payment_amount = _amount
   WHERE tutor_student_id = _tutor_student_id AND lesson_id = ANY(_ids);

  FOREACH _id IN ARRAY _ids LOOP
    -- _sync_lesson_debit внутри _apply дополнительно валидирует STUDENT_TUTOR_MISMATCH.
    PERFORM public._apply_lesson_debit_from_current_cost(_id, _tutor_student_id, auth.uid());
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'updated', COALESCE(array_length(_ids, 1), 0));
END $$;

-- Тройной паттерн грантов (rule 99): GRANT → REVOKE PUBLIC → REVOKE anon.
GRANT EXECUTE ON FUNCTION public.tutor_set_lesson_cost_series(uuid, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tutor_set_participant_cost_series(uuid, uuid, integer, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.tutor_set_lesson_cost_series(uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tutor_set_participant_cost_series(uuid, uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tutor_set_lesson_cost_series(uuid, integer, text) FROM anon;
REVOKE ALL ON FUNCTION public.tutor_set_participant_cost_series(uuid, uuid, integer, text) FROM anon;

NOTIFY pgrst, 'reload schema';
