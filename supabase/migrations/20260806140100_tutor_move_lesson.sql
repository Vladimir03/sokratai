-- Волна 2 Расписания (money-critical): перенос занятия через money-aware RPC —
-- разблокирует перенос ПРОШЕДШИХ занятий (запрос репетитора: «нужно, чтобы прошедшие
-- занятия в расписании тоже можно было переносить»).
--
-- Почему нельзя прямым UPDATE start_at (как делал клиент):
--  - past→future: активный lesson-debit остаётся висеть — _apply_lesson_debit_from_current_cost
--    для БУДУЩЕГО занятия no-op (IF NOT _is_past THEN RETURN), реверсить обязан вызывающий;
--  - past→past со сменой даты: _sync_lesson_debit no-op при той же сумме, а occurred_on
--    активного debit обязан равняться НОВОЙ дате занятия (инвариант rule 60 §17 — иначе
--    «Доход за месяц» считает списание в старом месяце).
--
-- Одна RPC для индивидуального и unified-группы (одна строка tutor_lessons — участники
-- едут вместе с ней). completed/cancelled не переносятся (NOT_BOOKED): completed — ручной
-- статус, cancelled приглушён и двигать его бессмысленно.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. RPC переноса
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.tutor_move_lesson(_lesson_id uuid, _new_start_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tutor_id uuid; _student uuid; _status text; _dur int;
  _students uuid[]; _s uuid; _now_past boolean;
  _debit_id uuid; _debit_on date;
BEGIN
  IF _new_start_at IS NULL THEN RAISE EXCEPTION 'INVALID_TIME'; END IF;

  SELECT l.tutor_id, l.tutor_student_id, l.status, COALESCE(l.duration_min, 60)
    INTO _tutor_id, _student, _status, _dur
  FROM public.tutor_lessons l JOIN public.tutors t ON t.id = l.tutor_id
  WHERE l.id = _lesson_id AND t.user_id = auth.uid();
  IF _tutor_id IS NULL THEN RAISE EXCEPTION 'NOT_OWNED'; END IF;
  IF _status <> 'booked' THEN RAISE EXCEPTION 'NOT_BOOKED'; END IF;

  -- Участники: unified-группа → все из junction; индивид → ученик занятия; без ученика → пусто.
  -- ORDER BY tutor_student_id — канонический порядок локов (deadlock-safety с cron, M3).
  SELECT ARRAY(
    SELECT p.tutor_student_id FROM public.tutor_lesson_participants p
    WHERE p.lesson_id = _lesson_id ORDER BY p.tutor_student_id
  ) INTO _students;
  IF COALESCE(array_length(_students, 1), 0) = 0 AND _student IS NOT NULL THEN
    _students := ARRAY[_student];
  END IF;

  -- Локи ДО UPDATE — сериализация с cron/setters (тот же 2-key namespace, реентерабельно).
  FOREACH _s IN ARRAY _students LOOP
    PERFORM pg_advisory_xact_lock(hashtext(_lesson_id::text), hashtext(_s::text));
  END LOOP;

  -- Триггер-гард прямого UPDATE (ниже) обходим транзакционным GUC (паттерн app.ledger_op).
  PERFORM set_config('app.lesson_move', 'on', true);
  UPDATE public.tutor_lessons SET start_at = _new_start_at WHERE id = _lesson_id;
  PERFORM set_config('app.lesson_move', 'off', true);

  _now_past := (_new_start_at + make_interval(mins => _dur) <= now());

  FOREACH _s IN ARRAY _students LOOP
    IF _now_past THEN
      -- past→past со сменой ДАТЫ: явный reverse (иначе _sync no-op на той же сумме
      -- оставит occurred_on старого дня), затем пересоздание по текущей цене.
      SELECT e.id, e.occurred_on INTO _debit_id, _debit_on
      FROM public.tutor_ledger_entries e
      WHERE e.source_lesson_id = _lesson_id AND e.tutor_student_id = _s
        AND e.source_kind = 'lesson' AND e.kind = 'debit' AND e.reversed_by_entry_id IS NULL
      LIMIT 1;
      IF _debit_id IS NOT NULL AND _debit_on IS DISTINCT FROM _new_start_at::date THEN
        PERFORM public._reverse_lesson_debit(_lesson_id, _s);
      END IF;
      PERFORM public._apply_lesson_debit_from_current_cost(_lesson_id, _s, auth.uid());
    ELSE
      -- past→future (или future→future): будущее занятие не должно нести активный debit;
      -- _apply будущее НЕ реверсит → снимаем явно (no-op, если debit'а нет).
      PERFORM public._reverse_lesson_debit(_lesson_id, _s);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'is_past', _now_past,
    'students', COALESCE(array_length(_students, 1), 0)
  );
END $$;

-- Тройной паттерн грантов (rule 99): GRANT → REVOKE PUBLIC → REVOKE anon.
GRANT EXECUTE ON FUNCTION public.tutor_move_lesson(uuid, timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.tutor_move_lesson(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tutor_move_lesson(uuid, timestamptz) FROM anon;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. DB-гард: прямой UPDATE start_at у прошедшего занятия с активным списанием
-- ════════════════════════════════════════════════════════════════════════════
-- Закрывает ровно опасный случай (стейл-бандл / консоль двигает прошедшее занятие,
-- за которое уже списано → висящий debit или debit на не той дате). Метаданные,
-- будущие переносы и series-shift БУДУЩИХ занятий не задеты. Fail-loud (rule 60).
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
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tutor_lessons_guard_start_move ON public.tutor_lessons;
CREATE TRIGGER trg_tutor_lessons_guard_start_move
BEFORE UPDATE OF start_at ON public.tutor_lessons
FOR EACH ROW
WHEN (OLD.start_at IS DISTINCT FROM NEW.start_at)
EXECUTE FUNCTION public.tutor_lessons_guard_start_move();

NOTIFY pgrst, 'reload schema';
