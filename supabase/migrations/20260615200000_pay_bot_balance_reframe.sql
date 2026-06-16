-- Phase 2b — B5: /pay-бот на единый баланс (вместо legacy tutor_payments pending).
-- План: ~/.claude/plans/1-glowing-spindle.md (Phase 2b, B5). Money-critical. Деплоить ВМЕСТЕ с B4.
--
-- После cutover (B4) занятия больше НЕ пишут tutor_payments → «должник» = ученик с balance < 0
-- (Σ списаний за занятия − Σ полученных оплат). «Получил оплату» в боте = topup-credit
-- (как «Внести оплату» в кабинете), гасит долг до нуля. Legacy `get_tutor_pending_payments_by_telegram`
-- и `mark_payment_as_paid_by_telegram` остаются в БЕ (dormant), бот их больше не зовёт.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Должники по балансу для бота — mirror DebtorsCard (TutorPayments.tsx:40/69)
--    + get_tutor_pending_payments_by_telegram (telegram-ownership + резолв имени).
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_tutor_balance_debtors_by_telegram(_telegram_id text)
RETURNS TABLE (tutor_student_id uuid, student_name text, debt integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _tutor_id uuid;
BEGIN
  SELECT id INTO _tutor_id FROM public.tutors WHERE telegram_id = _telegram_id LIMIT 1;
  IF _tutor_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    ts.id,
    -- каскад имени = DebtorsCard: display_name → profiles.full_name → profiles.username → 'Без имени'
    COALESCE(NULLIF(btrim(ts.display_name), ''), pr.full_name, pr.username, 'Без имени')::text,
    (-ts.balance)::int                                  -- долг = -balance (рубли, integer)
  FROM public.tutor_students ts
  LEFT JOIN public.profiles pr ON pr.id = ts.student_id
  WHERE ts.tutor_id = _tutor_id
    AND ts.balance < 0
  ORDER BY ts.balance ASC;                              -- самый большой долг первым
END $$;

REVOKE ALL ON FUNCTION public.get_tutor_balance_debtors_by_telegram(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tutor_balance_debtors_by_telegram(text) TO service_role;

COMMENT ON FUNCTION public.get_tutor_balance_debtors_by_telegram IS
  'Должники по балансу (balance<0) для тутора по telegram_id. debt = -balance (рубли). /pay-бот (B5).';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. «Получил оплату» в боте = погасить долг topup-кредитом (race-safe)
-- ════════════════════════════════════════════════════════════════════════════
-- Зачисляет РОВНО текущий долг (= -balance) одним credit'ом source_kind='topup' → balance → 0.
-- Зеркало tutor_record_topup (20260610155050 L183), но ownership через telegram_id (нет auth.uid),
-- created_by = tutors.user_id, и сумма = текущий долг (а не клиентская — callback-data не несёт сумму).
-- advisory-lock на ученика сериализует повторные тапы (двойной кредит исключён): второй тап по
-- устаревшему сообщению видит balance>=0 → no-op (credited=0). Параллельный авто-debit безопасен —
-- balance-триггер делает `balance = balance + delta` под row-lock (относительно, не absolute).
CREATE OR REPLACE FUNCTION public.tutor_settle_debt_by_telegram(
  _telegram_id text, _tutor_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tutor_id uuid; _actor uuid; _owner uuid; _balance int; _debt int;
BEGIN
  SELECT id, user_id INTO _tutor_id, _actor FROM public.tutors WHERE telegram_id = _telegram_id LIMIT 1;
  IF _tutor_id IS NULL THEN RAISE EXCEPTION 'TUTOR_NOT_FOUND'; END IF;

  -- single-key lock-space (≠ 2-key lesson-debit lock) → контендит только с другими settle того же ученика
  PERFORM pg_advisory_xact_lock(hashtext(_tutor_student_id::text));

  SELECT tutor_id, balance INTO _owner, _balance
  FROM public.tutor_students WHERE id = _tutor_student_id;
  IF _owner IS NULL THEN RAISE EXCEPTION 'STUDENT_NOT_FOUND'; END IF;
  IF _owner IS DISTINCT FROM _tutor_id THEN RAISE EXCEPTION 'NOT_OWNED'; END IF;  -- anti-injection

  IF COALESCE(_balance, 0) >= 0 THEN
    RETURN jsonb_build_object('ok', true, 'credited', 0, 'new_balance', COALESCE(_balance, 0));
  END IF;

  _debt := -_balance;
  INSERT INTO public.tutor_ledger_entries
    (tutor_id, tutor_student_id, kind, amount, occurred_on, source_kind, note, created_by)
  VALUES (_tutor_id, _tutor_student_id, 'credit', _debt, CURRENT_DATE, 'topup',
          'оплата (Telegram /pay)', _actor);

  -- balance уже обновлён AFTER-INSERT триггером (включая параллельный авто-debit, если был) → читаем факт
  SELECT balance INTO _balance FROM public.tutor_students WHERE id = _tutor_student_id;
  RETURN jsonb_build_object('ok', true, 'credited', _debt, 'new_balance', COALESCE(_balance, 0));
END $$;

REVOKE ALL ON FUNCTION public.tutor_settle_debt_by_telegram(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_settle_debt_by_telegram(text, uuid) TO service_role;

COMMENT ON FUNCTION public.tutor_settle_debt_by_telegram IS
  'Гасит долг ученика topup-кредитом (= -balance) по telegram_id. Race-safe (advisory-lock). /pay-бот (B5).';

NOTIFY pgrst, 'reload schema';
