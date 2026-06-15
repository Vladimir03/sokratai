-- Student balance ledger — Phase 2b (partial cutover): lesson-payment CREDITS.
-- Plan: ~/.claude/plans/1-glowing-spindle.md. Spec: docs/delivery/features/scheduling-payments-balance/spec.md.
--
-- Goal: «деньги получены» за занятие тоже зачисляется на баланс (credit), а не только списывается
-- (debit). Сейчас оплаченное занятие = только debit → баланс уходит в минус. После: оплаченное
-- занятие = debit + credit = net 0; неоплаченное = только debit.
--
-- M1 (this file) is INERT until called by M2 (wiring). Safe to deploy alone.
--   * idx_ledger_active_lesson_credit — partial-unique (один активный lesson-credit на занятие+ученика),
--     зеркало idx_ledger_active_lesson_debit (20260609120000 L23-25). НЕ пересекается с debit-индексом
--     (тот фильтрует kind='debit'); CHECK source_kind не трогаем (reuse 'lesson'+'credit').
--   * _sync_lesson_credit  — идемпотентный + amount-aware зеркало финального _sync_lesson_debit
--     (20260610155050 L681-734): тот же pg_advisory_xact_lock (реентерабелен в одной транзакции →
--     debit+credit одного занятия сериализуются вместе, без deadlock), derive+validate tutor_id →
--     STUDENT_TUTOR_MISMATCH, amount<=0 → pure no-op (реверс ТОЛЬКО в _reverse_lesson_credit, mirror v6),
--     amount-aware (active-credit другой суммы → reverse old + new), post-conflict re-read.
--   * _reverse_lesson_credit — зеркало _reverse_lesson_debit (20260610155050 L128-139). Сторно lesson-credit
--     создаёт adjustment-DEBIT (без source_lesson_id) → не занимает ни один lesson-индекс.

-- ─── 1. Partial-unique для активного lesson-credit ───────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_active_lesson_credit
  ON public.tutor_ledger_entries (source_lesson_id, tutor_student_id)
  WHERE source_kind = 'lesson' AND kind = 'credit' AND reversed_by_entry_id IS NULL;

-- ─── 1b. Manual-payment credit (Telegram /pay по legacy `lesson_id IS NULL` строкам) ──
-- `source_payment_id` привязывает credit к конкретной `tutor_payments`-строке → идемпотентность
-- (ON CONFLICT) для `_credit_manual_payment`. Review round-2 #1: manual `/pay` тоже зачисляет на баланс.
ALTER TABLE public.tutor_ledger_entries
  ADD COLUMN IF NOT EXISTS source_payment_id uuid REFERENCES public.tutor_payments(id) ON DELETE SET NULL;

-- Полная история (НЕ только active, round-3 #1): одна credit-запись на payment НАВСЕГДА → повторный
-- /pay после удаления оплаты НЕ создаёт её заново (иначе replay старой кнопки отменял бы намеренный
-- reverse). Offsetting от reverse имеет source_payment_id=NULL (его `_reverse_ledger_entry` не копирует)
-- → в индекс не попадает, так что reverse не конфликтует.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_manual_payment_credit_once
  ON public.tutor_ledger_entries (source_payment_id)
  WHERE source_payment_id IS NOT NULL AND kind = 'credit';

-- ─── 2. Сторно активного lesson-credit занятия (для toggle pending / revert / delete) ──
CREATE OR REPLACE FUNCTION public._reverse_lesson_credit(_lesson_id uuid, _tutor_student_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _credit_id uuid;
BEGIN
  SELECT id INTO _credit_id FROM public.tutor_ledger_entries
   WHERE source_lesson_id = _lesson_id AND tutor_student_id = _tutor_student_id
     AND source_kind = 'lesson' AND kind = 'credit' AND reversed_by_entry_id IS NULL
   LIMIT 1;
  IF _credit_id IS NULL THEN RETURN NULL; END IF;     -- no-op (оплата уже снята / её не было)
  RETURN public._reverse_ledger_entry(_credit_id, 'reverse: оплата за занятие снята', NULL);
END $$;

-- ─── 3. Идемпотентный + amount-aware lesson-credit sync (вызывается из payment-write RPC, M2) ──
CREATE OR REPLACE FUNCTION public._sync_lesson_credit(
  _lesson_id uuid, _tutor_student_id uuid, _tutor_id uuid, _amount integer, _actor uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _existing public.tutor_ledger_entries; _owner_tutor uuid; _new_id uuid;
BEGIN
  -- Те же ключи, что у _sync_lesson_debit → debit+credit одного (lesson,student) сериализуются вместе.
  -- pg_advisory_xact_lock реентерабелен: повторный захват в той же транзакции выдаётся сразу (без deadlock).
  PERFORM pg_advisory_xact_lock(hashtext(_lesson_id::text), hashtext(_tutor_student_id::text));

  SELECT tutor_id INTO _owner_tutor FROM public.tutor_students WHERE id = _tutor_student_id;
  IF _owner_tutor IS NULL THEN RAISE EXCEPTION 'STUDENT_NOT_FOUND'; END IF;
  IF _tutor_id IS NOT NULL AND _tutor_id IS DISTINCT FROM _owner_tutor THEN
    RAISE EXCEPTION 'STUDENT_TUTOR_MISMATCH';
  END IF;

  -- amount<=0 → pure no-op (реверс живёт ТОЛЬКО в _reverse_lesson_credit; mirror v6 single-responsibility).
  IF _amount IS NULL OR _amount <= 0 THEN
    RETURN NULL;
  END IF;

  -- credit зеркалит debit (round-3 #2): без активного lesson-debit ТОЙ ЖЕ суммы credit НЕ создаём.
  -- Иначе replay /pay по reverted-but-paid занятию (debit сторнирован, paid-строка осталась) → orphan +amount.
  -- В каноничных путях (complete/group-toggle) `_sync_lesson_debit` вызывается прямо перед этим → debit есть.
  IF NOT EXISTS (
    SELECT 1 FROM public.tutor_ledger_entries d
    WHERE d.source_lesson_id = _lesson_id AND d.tutor_student_id = _tutor_student_id
      AND d.source_kind = 'lesson' AND d.kind = 'debit' AND d.reversed_by_entry_id IS NULL
      AND d.amount = _amount
  ) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO _existing FROM public.tutor_ledger_entries
   WHERE source_lesson_id = _lesson_id AND tutor_student_id = _tutor_student_id
     AND source_kind = 'lesson' AND kind = 'credit' AND reversed_by_entry_id IS NULL
   FOR UPDATE;

  IF FOUND THEN
    IF _existing.amount = _amount THEN
      RETURN _existing.id;                            -- та же сумма → no-op (идемпотентный re-mark paid)
    END IF;
    PERFORM public._reverse_ledger_entry(_existing.id, 'reverse: сумма оплаты изменена', _actor);
  END IF;

  INSERT INTO public.tutor_ledger_entries
    (tutor_id, tutor_student_id, kind, amount, occurred_on, source_kind, source_lesson_id, created_by)
  VALUES (_owner_tutor, _tutor_student_id, 'credit', _amount,
          COALESCE((SELECT start_at::date FROM public.tutor_lessons WHERE id = _lesson_id), CURRENT_DATE),
          'lesson', _lesson_id, _actor)
  ON CONFLICT (source_lesson_id, tutor_student_id)
    WHERE source_kind = 'lesson' AND kind = 'credit' AND reversed_by_entry_id IS NULL
  DO NOTHING
  RETURNING id INTO _new_id;

  IF _new_id IS NULL THEN
    SELECT * INTO _existing FROM public.tutor_ledger_entries
     WHERE source_lesson_id = _lesson_id AND tutor_student_id = _tutor_student_id
       AND source_kind = 'lesson' AND kind = 'credit' AND reversed_by_entry_id IS NULL;
    IF _existing.id IS NULL THEN
      RAISE EXCEPTION 'LEDGER_CREDIT_LOST lesson=% student=%', _lesson_id, _tutor_student_id;
    END IF;
    IF _existing.amount IS DISTINCT FROM _amount THEN
      RAISE EXCEPTION 'LEDGER_CREDIT_RACE active=% wanted=%', _existing.amount, _amount;
    END IF;
    RETURN _existing.id;
  END IF;
  RETURN _new_id;
END $$;

-- ─── 4. Manual-payment credit helper (Telegram /pay по `lesson_id IS NULL` строкам) ──
-- Идемпотентно по source_payment_id (ON CONFLICT). Сумма ручного платежа не меняется через /pay →
-- amount-aware не нужен. Advisory-lock не нужен (ON CONFLICT сериализует на уникальном индексе).
CREATE OR REPLACE FUNCTION public._credit_manual_payment(
  _payment_id uuid, _tutor_student_id uuid, _tutor_id uuid, _amount integer, _actor uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _owner_tutor uuid; _new_id uuid;
BEGIN
  SELECT tutor_id INTO _owner_tutor FROM public.tutor_students WHERE id = _tutor_student_id;
  IF _owner_tutor IS NULL THEN RAISE EXCEPTION 'STUDENT_NOT_FOUND'; END IF;
  IF _tutor_id IS NOT NULL AND _tutor_id IS DISTINCT FROM _owner_tutor THEN
    RAISE EXCEPTION 'STUDENT_TUTOR_MISMATCH';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RETURN NULL; END IF;

  INSERT INTO public.tutor_ledger_entries
    (tutor_id, tutor_student_id, kind, amount, occurred_on, source_kind, source_payment_id, note, created_by)
  VALUES (_owner_tutor, _tutor_student_id, 'credit', _amount, CURRENT_DATE, 'adjustment', _payment_id,
          'оплата (Telegram /pay)', _actor)
  ON CONFLICT (source_payment_id)
    WHERE source_payment_id IS NOT NULL AND kind = 'credit'
  DO NOTHING
  RETURNING id INTO _new_id;
  RETURN _new_id;  -- NULL если уже зачислено когда-либо (идемпотентно навсегда, round-3 #1)
END $$;

-- ─── 5. tutor_reverse_ledger_entry — запрет прямого сторно lesson-связанных записей (review round-2 #3) ──
-- VERBATIM из 20260610155050 L206-218 + reject `source_kind='lesson'`. Lesson-debit/credit правятся ТОЛЬКО
-- через само занятие (re-complete / revert), иначе credit сторнируется без debit/`tutor_payments` → десинк.
-- Внутренние реверсы идут через `_reverse_ledger_entry` (не эту RPC) → не затронуты.
CREATE OR REPLACE FUNCTION public.tutor_reverse_ledger_entry(_entry_id uuid, _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sid uuid; _sk text; _slid uuid; _new_id uuid;
BEGIN
  SELECT tutor_student_id, source_kind, source_lesson_id INTO _sid, _sk, _slid
    FROM public.tutor_ledger_entries WHERE id = _entry_id;
  IF _sid IS NULL THEN RAISE EXCEPTION 'ENTRY_NOT_FOUND'; END IF;
  IF NOT public.owns_tutor_student(_sid) THEN RAISE EXCEPTION 'NOT_OWNED'; END IF;
  -- Reject только LINKED lesson-записи (round-3 #3): они правятся через занятие (re-complete / revert),
  -- иначе credit ушёл бы без debit/`tutor_payments` → десинк. ORPHAN (удалённое занятие, source_lesson_id
  -- IS NULL) реверсится обычным путём — занятия уже нет, рассинхрон исключён (spec TASK-6).
  IF _sk = 'lesson' AND _slid IS NOT NULL THEN RAISE EXCEPTION 'LESSON_ENTRY_NOT_REVERSIBLE'; END IF;

  _new_id := public._reverse_ledger_entry(_entry_id, _note, auth.uid());
  IF _new_id IS NULL THEN RAISE EXCEPTION 'ALREADY_REVERSED'; END IF;
  RETURN _new_id;
END $$;

-- ─── 6. Точный итог «Получено» для страницы «Оплаты» (round-3 #6: SQL aggregate, без клиент-капа) ──
CREATE OR REPLACE FUNCTION public.tutor_received_payments_summary(
  _from date DEFAULT NULL, _to date DEFAULT NULL, _student_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _tutor_id uuid; _total bigint; _count bigint;
BEGIN
  SELECT id INTO _tutor_id FROM public.tutors WHERE user_id = auth.uid();
  IF _tutor_id IS NULL THEN RETURN jsonb_build_object('total', 0, 'count', 0); END IF;

  SELECT COALESCE(SUM(amount), 0), COUNT(*) INTO _total, _count
  FROM public.tutor_ledger_entries
  WHERE tutor_id = _tutor_id
    AND kind = 'credit'
    AND reverses_entry_id IS NULL
    AND reversed_by_entry_id IS NULL
    AND (_student_id IS NULL OR tutor_student_id = _student_id)
    AND (_from IS NULL OR occurred_on >= _from)
    AND (_to IS NULL OR occurred_on <= _to);

  RETURN jsonb_build_object('total', _total, 'count', _count);
END $$;

REVOKE ALL ON FUNCTION public.tutor_received_payments_summary(date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_received_payments_summary(date, date, uuid) TO authenticated, service_role;

-- Helpers internal only (вызываются SECURITY DEFINER RPC, которые работают как owner).
REVOKE ALL ON FUNCTION public._reverse_lesson_credit(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._sync_lesson_credit(uuid, uuid, uuid, integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._credit_manual_payment(uuid, uuid, uuid, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._reverse_lesson_credit(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._sync_lesson_credit(uuid, uuid, uuid, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._credit_manual_payment(uuid, uuid, uuid, integer, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.tutor_reverse_ledger_entry(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_reverse_ledger_entry(uuid, text) TO authenticated, service_role;
