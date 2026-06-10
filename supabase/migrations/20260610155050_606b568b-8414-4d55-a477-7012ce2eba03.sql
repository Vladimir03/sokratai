-- Student balance ledger — Phase 2a, TASK-1 (foundation, NEW code only).

-- ─── 1. Ledger table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tutor_ledger_entries (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id             uuid NOT NULL REFERENCES public.tutors(id) ON DELETE CASCADE,
  tutor_student_id     uuid NOT NULL REFERENCES public.tutor_students(id) ON DELETE CASCADE,
  kind                 text NOT NULL CHECK (kind IN ('debit','credit')),
  amount               integer NOT NULL CHECK (amount > 0),
  occurred_on          date NOT NULL DEFAULT CURRENT_DATE,
  source_kind          text NOT NULL CHECK (source_kind IN ('lesson','topup','adjustment')),
  source_lesson_id     uuid REFERENCES public.tutor_lessons(id) ON DELETE SET NULL,
  reverses_entry_id    uuid REFERENCES public.tutor_ledger_entries(id) ON DELETE SET NULL,
  reversed_by_entry_id uuid REFERENCES public.tutor_ledger_entries(id) ON DELETE SET NULL,
  note                 text,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tutor_ledger_entries IS
  'Append-only money ledger per student (RUBLES). balance = Σ signed entries. Writes only via SECURITY DEFINER.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_active_lesson_debit
  ON public.tutor_ledger_entries (source_lesson_id, tutor_student_id)
  WHERE source_kind = 'lesson' AND kind = 'debit' AND reversed_by_entry_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_one_reversal
  ON public.tutor_ledger_entries (reverses_entry_id)
  WHERE reverses_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ledger_student_created
  ON public.tutor_ledger_entries (tutor_student_id, created_at DESC);

ALTER TABLE public.tutor_students
  ADD COLUMN IF NOT EXISTS balance integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.tutor_students.balance IS
  'Денормализованный баланс (РУБЛИ) = Σ ledger. Ledger-managed.';

GRANT SELECT ON public.tutor_ledger_entries TO authenticated;
GRANT ALL ON public.tutor_ledger_entries TO service_role;

ALTER TABLE public.tutor_ledger_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tutors view own ledger entries" ON public.tutor_ledger_entries;
CREATE POLICY "Tutors view own ledger entries"
  ON public.tutor_ledger_entries FOR SELECT
  USING (public.owns_tutor_student(tutor_student_id));
REVOKE INSERT, UPDATE, DELETE ON public.tutor_ledger_entries FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.tutor_ledger_apply_balance()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.ledger_op', 'on', true);
  UPDATE public.tutor_students
     SET balance = balance + (CASE WHEN NEW.kind = 'credit' THEN NEW.amount ELSE -NEW.amount END)
   WHERE id = NEW.tutor_student_id;
  PERFORM set_config('app.ledger_op', 'off', true);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tutor_ledger_apply_balance ON public.tutor_ledger_entries;
CREATE TRIGGER trg_tutor_ledger_apply_balance
  AFTER INSERT ON public.tutor_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.tutor_ledger_apply_balance();

CREATE OR REPLACE FUNCTION public.tutor_students_guard_balance()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.balance IS DISTINCT FROM OLD.balance
     AND COALESCE(current_setting('app.ledger_op', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'tutor_students.balance is ledger-managed — change it via tutor_ledger_entries, not a direct UPDATE';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tutor_students_guard_balance ON public.tutor_students;
CREATE TRIGGER trg_tutor_students_guard_balance
  BEFORE UPDATE ON public.tutor_students
  FOR EACH ROW EXECUTE FUNCTION public.tutor_students_guard_balance();

CREATE OR REPLACE FUNCTION public.recompute_student_balance(_tutor_student_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _bal integer;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN kind = 'credit' THEN amount ELSE -amount END), 0)
    INTO _bal
    FROM public.tutor_ledger_entries
   WHERE tutor_student_id = _tutor_student_id;
  PERFORM set_config('app.ledger_op', 'on', true);
  UPDATE public.tutor_students SET balance = _bal WHERE id = _tutor_student_id;
  PERFORM set_config('app.ledger_op', 'off', true);
  RETURN _bal;
END $$;

REVOKE ALL ON FUNCTION public.recompute_student_balance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_student_balance(uuid) TO service_role;

-- ════════ TASK-2: helpers + client RPC ════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._reverse_ledger_entry(_entry_id uuid, _note text, _actor uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _orig public.tutor_ledger_entries; _new_id uuid;
BEGIN
  SELECT * INTO _orig FROM public.tutor_ledger_entries WHERE id = _entry_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF _orig.reversed_by_entry_id IS NOT NULL THEN RETURN NULL; END IF;

  INSERT INTO public.tutor_ledger_entries
    (tutor_id, tutor_student_id, kind, amount, occurred_on, source_kind, reverses_entry_id, note, created_by)
  VALUES
    (_orig.tutor_id, _orig.tutor_student_id,
     CASE WHEN _orig.kind = 'debit' THEN 'credit' ELSE 'debit' END,
     _orig.amount, CURRENT_DATE, 'adjustment', _entry_id, _note, _actor)
  ON CONFLICT (reverses_entry_id) WHERE reverses_entry_id IS NOT NULL DO NOTHING
  RETURNING id INTO _new_id;

  IF _new_id IS NULL THEN RETURN NULL; END IF;

  UPDATE public.tutor_ledger_entries SET reversed_by_entry_id = _new_id WHERE id = _entry_id;
  RETURN _new_id;
END $$;

CREATE OR REPLACE FUNCTION public._reverse_lesson_debit(_lesson_id uuid, _tutor_student_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _debit_id uuid;
BEGIN
  SELECT id INTO _debit_id FROM public.tutor_ledger_entries
   WHERE source_lesson_id = _lesson_id AND tutor_student_id = _tutor_student_id
     AND source_kind = 'lesson' AND kind = 'debit' AND reversed_by_entry_id IS NULL
   LIMIT 1;
  IF _debit_id IS NULL THEN RETURN NULL; END IF;
  RETURN public._reverse_ledger_entry(_debit_id, 'reverse: занятие отменено/удалено', NULL);
END $$;

CREATE OR REPLACE FUNCTION public._sync_lesson_debit(
  _lesson_id uuid, _tutor_student_id uuid, _tutor_id uuid, _amount integer, _actor uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _existing public.tutor_ledger_entries; _new_id uuid;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN
    PERFORM public._reverse_lesson_debit(_lesson_id, _tutor_student_id);
    RETURN NULL;
  END IF;

  SELECT * INTO _existing FROM public.tutor_ledger_entries
   WHERE source_lesson_id = _lesson_id AND tutor_student_id = _tutor_student_id
     AND source_kind = 'lesson' AND kind = 'debit' AND reversed_by_entry_id IS NULL
   FOR UPDATE;

  IF FOUND THEN
    IF _existing.amount = _amount THEN
      RETURN _existing.id;
    END IF;
    PERFORM public._reverse_ledger_entry(_existing.id, 'reverse: сумма списания изменена', _actor);
  END IF;

  INSERT INTO public.tutor_ledger_entries
    (tutor_id, tutor_student_id, kind, amount, occurred_on, source_kind, source_lesson_id, created_by)
  VALUES (_tutor_id, _tutor_student_id, 'debit', _amount,
          COALESCE((SELECT start_at::date FROM public.tutor_lessons WHERE id = _lesson_id), CURRENT_DATE),
          'lesson', _lesson_id, _actor)
  ON CONFLICT (source_lesson_id, tutor_student_id)
    WHERE source_kind = 'lesson' AND kind = 'debit' AND reversed_by_entry_id IS NULL
  DO NOTHING
  RETURNING id INTO _new_id;
  RETURN _new_id;
END $$;

REVOKE ALL ON FUNCTION public._reverse_ledger_entry(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._reverse_lesson_debit(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._sync_lesson_debit(uuid, uuid, uuid, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._reverse_ledger_entry(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._reverse_lesson_debit(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._sync_lesson_debit(uuid, uuid, uuid, integer, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.tutor_record_topup(
  _tutor_student_id uuid, _amount integer, _occurred_on date DEFAULT NULL, _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tutor_id uuid; _id uuid;
BEGIN
  IF NOT public.owns_tutor_student(_tutor_student_id) THEN
    RAISE EXCEPTION 'NOT_OWNED';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;
  SELECT tutor_id INTO _tutor_id FROM public.tutor_students WHERE id = _tutor_student_id;
  IF _tutor_id IS NULL THEN RAISE EXCEPTION 'STUDENT_NOT_FOUND'; END IF;

  INSERT INTO public.tutor_ledger_entries
    (tutor_id, tutor_student_id, kind, amount, occurred_on, source_kind, note, created_by)
  VALUES (_tutor_id, _tutor_student_id, 'credit', _amount,
          COALESCE(_occurred_on, CURRENT_DATE), 'topup', _note, auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.tutor_reverse_ledger_entry(_entry_id uuid, _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sid uuid; _new_id uuid;
BEGIN
  SELECT tutor_student_id INTO _sid FROM public.tutor_ledger_entries WHERE id = _entry_id;
  IF _sid IS NULL THEN RAISE EXCEPTION 'ENTRY_NOT_FOUND'; END IF;
  IF NOT public.owns_tutor_student(_sid) THEN RAISE EXCEPTION 'NOT_OWNED'; END IF;

  _new_id := public._reverse_ledger_entry(_entry_id, _note, auth.uid());
  IF _new_id IS NULL THEN RAISE EXCEPTION 'ALREADY_REVERSED'; END IF;
  RETURN _new_id;
END $$;

REVOKE ALL ON FUNCTION public.tutor_record_topup(uuid, integer, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tutor_reverse_ledger_entry(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_record_topup(uuid, integer, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tutor_reverse_ledger_entry(uuid, text) TO authenticated, service_role;

-- ════════ TASK-4: seed marker + backfill ══════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.tutor_ledger_seed_runs (
  tutor_student_id uuid PRIMARY KEY REFERENCES public.tutor_students(id) ON DELETE CASCADE,
  seeded_at        timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.tutor_ledger_seed_runs TO authenticated;
GRANT ALL ON public.tutor_ledger_seed_runs TO service_role;

INSERT INTO public.tutor_ledger_entries
  (tutor_id, tutor_student_id, kind, amount, occurred_on, source_kind, source_lesson_id, note, created_by)
SELECT ts.tutor_id, tp.tutor_student_id, 'debit', ROUND(tp.amount)::int,
       COALESCE((SELECT l.start_at::date FROM public.tutor_lessons l WHERE l.id = tp.lesson_id),
                tp.due_date, tp.created_at::date),
       CASE WHEN tp.lesson_id IS NOT NULL THEN 'lesson' ELSE 'adjustment' END,
       tp.lesson_id,
       'seed: начисление (история)', NULL
FROM public.tutor_payments tp
JOIN public.tutor_students ts ON ts.id = tp.tutor_student_id
WHERE ROUND(tp.amount)::int > 0
  AND NOT EXISTS (SELECT 1 FROM public.tutor_ledger_seed_runs r WHERE r.tutor_student_id = tp.tutor_student_id);

INSERT INTO public.tutor_ledger_entries
  (tutor_id, tutor_student_id, kind, amount, occurred_on, source_kind, note, created_by)
SELECT ts.tutor_id, tp.tutor_student_id, 'credit', ROUND(tp.amount)::int,
       COALESCE(tp.paid_at::date, tp.due_date, tp.created_at::date),
       'adjustment', 'seed: оплачено (история)', NULL
FROM public.tutor_payments tp
JOIN public.tutor_students ts ON ts.id = tp.tutor_student_id
WHERE tp.status = 'paid' AND ROUND(tp.amount)::int > 0
  AND NOT EXISTS (SELECT 1 FROM public.tutor_ledger_seed_runs r WHERE r.tutor_student_id = tp.tutor_student_id);

INSERT INTO public.tutor_ledger_seed_runs (tutor_student_id)
SELECT DISTINCT tp.tutor_student_id
FROM public.tutor_payments tp
WHERE NOT EXISTS (SELECT 1 FROM public.tutor_ledger_seed_runs r WHERE r.tutor_student_id = tp.tutor_student_id)
ON CONFLICT (tutor_student_id) DO NOTHING;

-- ════════ TASK-3: wire ledger debits into money RPCs ══════════════════════════
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
  _resolved_amount integer;
  _payment_row_status text;
  _is_group boolean;
  _participant record;
  _actor uuid;
BEGIN
  IF _tutor_telegram_id IS NOT NULL THEN
    SELECT t.id, l.tutor_student_id
      INTO _tutor_id, _tutor_student_id
    FROM public.tutors t
    JOIN public.tutor_lessons l ON l.tutor_id = t.id
    WHERE l.id = _lesson_id
      AND t.telegram_id = _tutor_telegram_id;
  ELSE
    SELECT t.id, l.tutor_student_id
      INTO _tutor_id, _tutor_student_id
    FROM public.tutors t
    JOIN public.tutor_lessons l ON l.tutor_id = t.id
    WHERE l.id = _lesson_id
      AND t.user_id = auth.uid();
  END IF;

  IF _tutor_id IS NULL THEN
    RETURN false;
  END IF;

  _actor := COALESCE(auth.uid(), (SELECT user_id FROM public.tutors WHERE id = _tutor_id));

  SELECT EXISTS (
    SELECT 1 FROM public.tutor_lesson_participants WHERE lesson_id = _lesson_id
  ) INTO _is_group;

  _payment_row_status := CASE
    WHEN _payment_status IN ('paid', 'paid_earlier') THEN 'paid'
    ELSE 'pending'
  END;

  UPDATE public.tutor_lessons
  SET
    status = 'completed',
    payment_status = _payment_status,
    payment_amount = CASE WHEN NOT _is_group THEN
      CASE WHEN _amount IS NOT NULL AND _amount > 0 THEN _amount ELSE NULL END
    ELSE NULL END,
    paid_at = CASE
      WHEN _payment_status IN ('paid', 'paid_earlier') THEN NOW()
      ELSE NULL
    END,
    payment_reminder_sent = true
  WHERE id = _lesson_id;

  IF _is_group THEN
    FOR _participant IN
      SELECT p.tutor_student_id, p.payment_amount
      FROM public.tutor_lesson_participants p
      WHERE p.lesson_id = _lesson_id
    LOOP
      IF _participant.payment_amount IS NOT NULL AND _participant.payment_amount > 0 THEN
        INSERT INTO public.tutor_payments (
          lesson_id, tutor_student_id, amount, status, due_date, paid_at
        ) VALUES (
          _lesson_id,
          _participant.tutor_student_id,
          _participant.payment_amount,
          _payment_row_status,
          CURRENT_DATE,
          CASE WHEN _payment_status IN ('paid', 'paid_earlier') THEN NOW() ELSE NULL END
        )
        ON CONFLICT (lesson_id, tutor_student_id)
          WHERE lesson_id IS NOT NULL AND tutor_student_id IS NOT NULL
        DO UPDATE SET
          amount = EXCLUDED.amount,
          status = EXCLUDED.status,
          due_date = EXCLUDED.due_date,
          paid_at = EXCLUDED.paid_at;

        PERFORM public._sync_lesson_debit(
          _lesson_id, _participant.tutor_student_id, _tutor_id, _participant.payment_amount, _actor);
      END IF;

      UPDATE public.tutor_lesson_participants
      SET
        payment_status = _payment_status,
        paid_at = CASE WHEN _payment_status IN ('paid', 'paid_earlier') THEN NOW() ELSE NULL END
      WHERE lesson_id = _lesson_id
        AND tutor_student_id = _participant.tutor_student_id;
    END LOOP;
  ELSE
    _resolved_amount := CASE
      WHEN _amount IS NOT NULL AND _amount > 0 THEN _amount
      ELSE NULL
    END;

    IF _resolved_amount IS NOT NULL AND _tutor_student_id IS NOT NULL THEN
      INSERT INTO public.tutor_payments (
        lesson_id, tutor_student_id, amount, status, due_date, paid_at
      ) VALUES (
        _lesson_id,
        _tutor_student_id,
        _resolved_amount,
        _payment_row_status,
        CURRENT_DATE,
        CASE WHEN _payment_status IN ('paid', 'paid_earlier') THEN NOW() ELSE NULL END
      )
      ON CONFLICT (lesson_id, tutor_student_id)
        WHERE lesson_id IS NOT NULL AND tutor_student_id IS NOT NULL
      DO UPDATE SET
        amount = EXCLUDED.amount,
        status = EXCLUDED.status,
        due_date = EXCLUDED.due_date,
        paid_at = EXCLUDED.paid_at;

      PERFORM public._sync_lesson_debit(
        _lesson_id, _tutor_student_id, _tutor_id, _resolved_amount, _actor);
    END IF;
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_lesson_and_create_payment(uuid, integer, text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_group_participant_payment_status(
  _lesson_id uuid,
  _tutor_student_id uuid,
  _payment_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  _tutor_id uuid;
  _lesson_status text;
  _payment_row_status text;
  _participant_amount integer;
  _paid_at timestamptz;
  _actor uuid;
BEGIN
  IF _payment_status NOT IN ('pending', 'paid') THEN
    RETURN jsonb_build_object(
      'ok', false, 'status', NULL, 'amount', NULL, 'paid_at', NULL,
      'error_code', 'INVALID_PAYMENT_STATUS'
    );
  END IF;

  SELECT t.id, l.status
    INTO _tutor_id, _lesson_status
  FROM public.tutor_lessons l
  JOIN public.tutors t ON t.id = l.tutor_id
  WHERE l.id = _lesson_id
    AND t.user_id = auth.uid();

  IF _tutor_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'status', NULL, 'amount', NULL, 'paid_at', NULL,
      'error_code', 'LESSON_NOT_FOUND_OR_FORBIDDEN'
    );
  END IF;

  _actor := COALESCE(auth.uid(), (SELECT user_id FROM public.tutors WHERE id = _tutor_id));

  IF _lesson_status <> 'completed' THEN
    RETURN jsonb_build_object(
      'ok', false, 'status', NULL, 'amount', NULL, 'paid_at', NULL,
      'error_code', 'LESSON_NOT_COMPLETED'
    );
  END IF;

  SELECT p.payment_amount
    INTO _participant_amount
  FROM public.tutor_lesson_participants p
  WHERE p.lesson_id = _lesson_id
    AND p.tutor_student_id = _tutor_student_id;

  IF _participant_amount IS NULL AND NOT EXISTS (
    SELECT 1
    FROM public.tutor_lesson_participants p
    WHERE p.lesson_id = _lesson_id
      AND p.tutor_student_id = _tutor_student_id
  ) THEN
    RETURN jsonb_build_object(
      'ok', false, 'status', NULL, 'amount', NULL, 'paid_at', NULL,
      'error_code', 'PARTICIPANT_NOT_FOUND'
    );
  END IF;

  _payment_row_status := CASE WHEN _payment_status = 'paid' THEN 'paid' ELSE 'pending' END;
  _paid_at := CASE WHEN _payment_status = 'paid' THEN NOW() ELSE NULL END;

  UPDATE public.tutor_lesson_participants
  SET payment_status = _payment_status, paid_at = _paid_at
  WHERE lesson_id = _lesson_id AND tutor_student_id = _tutor_student_id;

  IF _participant_amount IS NOT NULL AND _participant_amount > 0 THEN
    INSERT INTO public.tutor_payments (
      lesson_id, tutor_student_id, amount, status, due_date, paid_at
    ) VALUES (
      _lesson_id, _tutor_student_id, _participant_amount, _payment_row_status, CURRENT_DATE, _paid_at
    )
    ON CONFLICT (lesson_id, tutor_student_id)
      WHERE lesson_id IS NOT NULL AND tutor_student_id IS NOT NULL
    DO UPDATE SET
      amount = EXCLUDED.amount,
      status = EXCLUDED.status,
      due_date = EXCLUDED.due_date,
      paid_at = EXCLUDED.paid_at;

    PERFORM public._sync_lesson_debit(
      _lesson_id, _tutor_student_id, _tutor_id, _participant_amount, _actor);
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'status', _payment_status, 'amount', _participant_amount,
    'paid_at', _paid_at, 'error_code', NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_group_participant_payment_status(uuid, uuid, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tutor_delete_lessons(
  _lesson_id UUID,
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
  _paid_count INT;
  _pending_removed INT := 0;
  _deleted_count INT := 0;
  _new_root UUID;
  _led RECORD;
BEGIN
  IF _scope NOT IN ('this', 'this_and_following', 'all') THEN
    RAISE EXCEPTION 'INVALID_SCOPE' USING ERRCODE = '22023';
  END IF;

  SELECT t.id, COALESCE(l.parent_lesson_id, l.id), l.start_at, COALESCE(l.is_recurring, false)
    INTO _tutor_id, _root_id, _from_start, _is_recurring
  FROM public.tutor_lessons l
  JOIN public.tutors t ON t.id = l.tutor_id
  WHERE l.id = _lesson_id
    AND t.user_id = auth.uid();

  IF _tutor_id IS NULL THEN
    RAISE EXCEPTION 'NOT_OWNED' USING ERRCODE = '42501';
  END IF;

  IF _is_recurring AND _scope = 'all' THEN
    SELECT array_agg(id) INTO _delete_ids
    FROM public.tutor_lessons
    WHERE tutor_id = _tutor_id
      AND (id = _root_id OR parent_lesson_id = _root_id);
  ELSIF _is_recurring AND _scope = 'this_and_following' THEN
    SELECT array_agg(id) INTO _delete_ids
    FROM public.tutor_lessons
    WHERE tutor_id = _tutor_id
      AND (id = _root_id OR parent_lesson_id = _root_id)
      AND (id = _lesson_id OR start_at >= _from_start);
  ELSE
    _delete_ids := ARRAY[_lesson_id];
  END IF;

  SELECT count(*) INTO _paid_count
  FROM public.tutor_payments
  WHERE lesson_id = ANY (_delete_ids)
    AND status = 'paid';

  IF _paid_count > 0 THEN
    RAISE EXCEPTION 'HAS_PAID_PAYMENT' USING ERRCODE = '22023';
  END IF;

  WITH del AS (
    DELETE FROM public.tutor_payments
    WHERE lesson_id = ANY (_delete_ids)
      AND status IN ('pending', 'overdue')
    RETURNING 1
  )
  SELECT count(*) INTO _pending_removed FROM del;

  FOR _led IN
    SELECT id FROM public.tutor_ledger_entries
    WHERE source_lesson_id = ANY (_delete_ids)
      AND source_kind = 'lesson' AND kind = 'debit' AND reversed_by_entry_id IS NULL
  LOOP
    PERFORM public._reverse_ledger_entry(_led.id, 'reverse: занятие удалено', NULL);
  END LOOP;

  IF _root_id = ANY (_delete_ids) THEN
    SELECT id INTO _new_root
    FROM public.tutor_lessons
    WHERE tutor_id = _tutor_id
      AND (id = _root_id OR parent_lesson_id = _root_id)
      AND NOT (id = ANY (_delete_ids))
    ORDER BY start_at ASC
    LIMIT 1;

    IF _new_root IS NOT NULL THEN
      UPDATE public.tutor_lessons SET parent_lesson_id = NULL WHERE id = _new_root;
      UPDATE public.tutor_lessons
      SET parent_lesson_id = _new_root
      WHERE tutor_id = _tutor_id
        AND parent_lesson_id = _root_id
        AND id <> _new_root
        AND NOT (id = ANY (_delete_ids));
    END IF;
  END IF;

  WITH del AS (
    DELETE FROM public.tutor_lessons
    WHERE id = ANY (_delete_ids)
      AND tutor_id = _tutor_id
    RETURNING 1
  )
  SELECT count(*) INTO _deleted_count FROM del;

  RETURN jsonb_build_object(
    'deleted', _deleted_count,
    'pending_payments_removed', _pending_removed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.tutor_delete_lessons(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_delete_lessons(UUID, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tutor_revert_lesson(p_lesson_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _owned boolean;
  _deleted_pending int := 0;
  _had_paid boolean := false;
  _led RECORD;
BEGIN
  SELECT true INTO _owned
  FROM public.tutor_lessons l
  JOIN public.tutors t ON t.id = l.tutor_id
  WHERE l.id = p_lesson_id
    AND t.user_id = auth.uid()
    AND l.status = 'completed';

  IF _owned IS NOT TRUE THEN
    RAISE EXCEPTION 'NOT_OWNED_OR_NOT_COMPLETED';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.tutor_payments WHERE lesson_id = p_lesson_id AND status = 'paid'
  ) INTO _had_paid;

  WITH del AS (
    DELETE FROM public.tutor_payments
    WHERE lesson_id = p_lesson_id AND status = 'pending'
    RETURNING 1
  )
  SELECT count(*) INTO _deleted_pending FROM del;

  FOR _led IN
    SELECT id FROM public.tutor_ledger_entries
    WHERE source_lesson_id = p_lesson_id
      AND source_kind = 'lesson' AND kind = 'debit' AND reversed_by_entry_id IS NULL
  LOOP
    PERFORM public._reverse_ledger_entry(_led.id, 'reverse: занятие отменено (revert)', NULL);
  END LOOP;

  UPDATE public.tutor_lessons
  SET status = 'cancelled',
      cancelled_by = 'tutor',
      cancelled_at = now(),
      payment_status = 'unpaid',
      payment_amount = NULL,
      paid_at = NULL,
      payment_reminder_sent = false
  WHERE id = p_lesson_id;

  UPDATE public.tutor_lesson_participants
  SET payment_status = 'unpaid', paid_at = NULL
  WHERE lesson_id = p_lesson_id;

  RETURN jsonb_build_object('ok', true, 'deleted_pending', _deleted_pending, 'had_paid', _had_paid);
END;
$$;

REVOKE ALL ON FUNCTION public.tutor_revert_lesson(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_revert_lesson(uuid) TO authenticated, service_role;

-- ════════ TASK-3 review fix (P0/P1) + P2 single-responsibility _sync_lesson_debit ══════
CREATE OR REPLACE FUNCTION public._sync_lesson_debit(
  _lesson_id uuid, _tutor_student_id uuid, _tutor_id uuid, _amount integer, _actor uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _existing public.tutor_ledger_entries; _owner_tutor uuid; _new_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(_lesson_id::text), hashtext(_tutor_student_id::text));

  SELECT tutor_id INTO _owner_tutor FROM public.tutor_students WHERE id = _tutor_student_id;
  IF _owner_tutor IS NULL THEN RAISE EXCEPTION 'STUDENT_NOT_FOUND'; END IF;
  IF _tutor_id IS NOT NULL AND _tutor_id IS DISTINCT FROM _owner_tutor THEN
    RAISE EXCEPTION 'STUDENT_TUTOR_MISMATCH';
  END IF;

  IF _amount IS NULL OR _amount <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO _existing FROM public.tutor_ledger_entries
   WHERE source_lesson_id = _lesson_id AND tutor_student_id = _tutor_student_id
     AND source_kind = 'lesson' AND kind = 'debit' AND reversed_by_entry_id IS NULL
   FOR UPDATE;

  IF FOUND THEN
    IF _existing.amount = _amount THEN
      RETURN _existing.id;
    END IF;
    PERFORM public._reverse_ledger_entry(_existing.id, 'reverse: сумма списания изменена', _actor);
  END IF;

  INSERT INTO public.tutor_ledger_entries
    (tutor_id, tutor_student_id, kind, amount, occurred_on, source_kind, source_lesson_id, created_by)
  VALUES (_owner_tutor, _tutor_student_id, 'debit', _amount,
          COALESCE((SELECT start_at::date FROM public.tutor_lessons WHERE id = _lesson_id), CURRENT_DATE),
          'lesson', _lesson_id, _actor)
  ON CONFLICT (source_lesson_id, tutor_student_id)
    WHERE source_kind = 'lesson' AND kind = 'debit' AND reversed_by_entry_id IS NULL
  DO NOTHING
  RETURNING id INTO _new_id;

  IF _new_id IS NULL THEN
    SELECT * INTO _existing FROM public.tutor_ledger_entries
     WHERE source_lesson_id = _lesson_id AND tutor_student_id = _tutor_student_id
       AND source_kind = 'lesson' AND kind = 'debit' AND reversed_by_entry_id IS NULL;
    IF _existing.id IS NULL THEN
      RAISE EXCEPTION 'LEDGER_DEBIT_LOST lesson=% student=%', _lesson_id, _tutor_student_id;
    END IF;
    IF _existing.amount IS DISTINCT FROM _amount THEN
      RAISE EXCEPTION 'LEDGER_DEBIT_RACE active=% wanted=%', _existing.amount, _amount;
    END IF;
    RETURN _existing.id;
  END IF;
  RETURN _new_id;
END $$;

REVOKE ALL ON FUNCTION public._sync_lesson_debit(uuid, uuid, uuid, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._sync_lesson_debit(uuid, uuid, uuid, integer, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';