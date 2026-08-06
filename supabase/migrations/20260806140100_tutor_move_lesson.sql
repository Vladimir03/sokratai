-- Волна 2 Расписания (money-critical): перенос занятия через money-aware RPC —
-- разблокирует перенос ПРОШЕДШИХ занятий (запрос репетитора: «нужно, чтобы прошедшие
-- занятия в расписании тоже можно было переносить»).
--
-- Почему нельзя прямым UPDATE start_at (как делал клиент):
--  - past→future: активный lesson-debit остаётся висеть — _apply_lesson_debit_from_current_cost
--    для БУДУЩЕГО занятия no-op (IF NOT _is_past THEN RETURN), реверсить обязан вызывающий;
--  - future→past: занятие мимо money-логики; дата старше cron-окна 60 дней = списание
--    не появится ВООБЩЕ (P0 ревью Codex 5.6);
--  - past→past со сменой даты: _sync_lesson_debit no-op при той же сумме, а occurred_on
--    активного debit обязан равняться НОВОЙ дате занятия (rule 60 §17 — иначе
--    «Доход за месяц» считает списание в старом месяце).
--
-- Одна RPC для индивидуального и unified-группы (одна строка tutor_lessons — участники
-- едут вместе с ней). completed/cancelled не переносятся (NOT_BOOKED).
--
-- Фиксы ревью Codex 5.6 (2026-08-07):
--  - Статус перепроверяется АТОМАРНО под локами (UPDATE ... WHERE status='booked'
--    RETURNING) — stale move после параллельной отмены больше не переносит cancelled
--    и не снимает сумму отмены (P0).
--  - Money-набор = текущие ученики ∪ владельцы АКТИВНЫХ lesson-debit (P0: у прошедшего
--    занятия мог остаться debit СНЯТОГО участника — remove-participant его не реверсит);
--    снятый-с-занятия владелец debit'а получает reverse в любой ветке.
--  - Триггер-гард блокирует и NEW-past прямые UPDATE (future→past мимо RPC).

-- ════════════════════════════════════════════════════════════════════════════
-- 1. RPC переноса (+ атомарные money-поля: длительность, смена ученика)
-- ════════════════════════════════════════════════════════════════════════════
-- Контроль-ревью P0: «перенос + смена ученика/длительности» ДВУМЯ транзакциями
-- давал debit старому ученику / derived по старой длительности. Поэтому RPC
-- принимает money-поля опционально и применяет всё ОДНОЙ транзакцией:
--   _new_duration_min  — NULL = не менять;
--   _set_student=true  — записать _new_tutor_student_id/_new_student_id (NULL = убрать
--                        ученика); только для индивидуальных занятий (GROUP_LESSON).
-- Не-money метаданные (тип/предмет/тема/заметки) остаются на updateLesson.
CREATE OR REPLACE FUNCTION public.tutor_move_lesson(
  _lesson_id uuid,
  _new_start_at timestamptz,
  _new_duration_min integer DEFAULT NULL,
  _set_student boolean DEFAULT false,
  _new_tutor_student_id uuid DEFAULT NULL,
  _new_student_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tutor_id uuid; _dur int;
  _students uuid[]; _s uuid; _now_past boolean; _attached boolean;
  _debit_id uuid; _debit_on date;
BEGIN
  IF _new_start_at IS NULL THEN RAISE EXCEPTION 'INVALID_TIME'; END IF;
  IF _new_duration_min IS NOT NULL AND _new_duration_min <= 0 THEN RAISE EXCEPTION 'INVALID_TIME'; END IF;

  SELECT l.tutor_id INTO _tutor_id
  FROM public.tutor_lessons l JOIN public.tutors t ON t.id = l.tutor_id
  WHERE l.id = _lesson_id AND t.user_id = auth.uid();
  IF _tutor_id IS NULL THEN RAISE EXCEPTION 'NOT_OWNED'; END IF;

  IF _set_student THEN
    -- Смена ученика — только индивидуальные занятия (у группы состав правится
    -- отдельными participant-RPC).
    IF EXISTS (SELECT 1 FROM public.tutor_lesson_participants WHERE lesson_id = _lesson_id) THEN
      RAISE EXCEPTION 'GROUP_LESSON';
    END IF;
    IF _new_tutor_student_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.tutor_students ts
      WHERE ts.id = _new_tutor_student_id AND ts.tutor_id = _tutor_id
    ) THEN RAISE EXCEPTION 'INVALID_STUDENT'; END IF;
  END IF;

  -- Money-набор: текущие участники группы ∪ ученик занятия ∪ НОВЫЙ ученик ∪ владельцы
  -- активных lesson-debit (снятые участники с висящим списанием — P0 ревью).
  -- ORDER BY sid — канонический порядок локов (rule 60 §15).
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

  -- Локи ДО UPDATE — сериализация с cron/setters (тот же 2-key namespace, реентерабельно).
  FOREACH _s IN ARRAY _students LOOP
    PERFORM pg_advisory_xact_lock(hashtext(_lesson_id::text), hashtext(_s::text));
  END LOOP;

  -- Атомарная перепроверка статуса ПОД локами (P0 ревью: параллельная
  -- tutor_cancel_lesson_with_charge между гейтом и UPDATE). Триггер-гард (ниже)
  -- обходим транзакционным GUC (паттерн app.ledger_op).
  PERFORM set_config('app.lesson_move', 'on', true);
  UPDATE public.tutor_lessons
     SET start_at = _new_start_at,
         duration_min = COALESCE(_new_duration_min, duration_min),
         tutor_student_id = CASE WHEN _set_student THEN _new_tutor_student_id ELSE tutor_student_id END,
         student_id = CASE WHEN _set_student THEN _new_student_id ELSE student_id END
   WHERE id = _lesson_id AND status = 'booked'
   RETURNING COALESCE(duration_min, 60) INTO _dur;
  PERFORM set_config('app.lesson_move', 'off', true);
  IF _dur IS NULL THEN RAISE EXCEPTION 'NOT_BOOKED'; END IF;

  _now_past := (_new_start_at + make_interval(mins => _dur) <= now());

  FOREACH _s IN ARRAY _students LOOP
    -- Снятый с занятия владелец активного debit: списание не должно существовать —
    -- reverse в ЛЮБОЙ ветке (в past-ветке _apply его бы молча пропустил).
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
      _debit_id := NULL; _debit_on := NULL;
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
GRANT EXECUTE ON FUNCTION public.tutor_move_lesson(uuid, timestamptz, integer, boolean, uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.tutor_move_lesson(uuid, timestamptz, integer, boolean, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tutor_move_lesson(uuid, timestamptz, integer, boolean, uuid, uuid) FROM anon;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. DB-гард: прямой UPDATE start_at мимо RPC в опасных случаях
-- ════════════════════════════════════════════════════════════════════════════
-- Блокирует (fail-loud, rule 60):
--  (а) двигают ПРОШЕДШЕЕ занятие с активным списанием (висящий debit / debit на не той дате);
--  (б) двигают занятие В ПРОШЛОЕ (future→past мимо money-логики; дата старше cron-окна
--      60 дней = молча несписанное занятие — P0 ревью).
-- Метаданные (WHEN start_at не менялся), future→future series-shift и INSERT не задеты.
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
