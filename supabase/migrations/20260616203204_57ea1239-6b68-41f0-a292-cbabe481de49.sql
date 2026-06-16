-- 20260615200000_pay_bot_balance_reframe.sql
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
    COALESCE(NULLIF(btrim(ts.display_name), ''), pr.full_name, pr.username, 'Без имени')::text,
    (-ts.balance)::int
  FROM public.tutor_students ts
  LEFT JOIN public.profiles pr ON pr.id = ts.student_id
  WHERE ts.tutor_id = _tutor_id
    AND ts.balance < 0
  ORDER BY ts.balance ASC;
END $$;

REVOKE ALL ON FUNCTION public.get_tutor_balance_debtors_by_telegram(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tutor_balance_debtors_by_telegram(text) TO service_role;

COMMENT ON FUNCTION public.get_tutor_balance_debtors_by_telegram IS
  'Должники по балансу (balance<0) для тутора по telegram_id. debt = -balance (рубли). /pay-бот (B5).';

CREATE OR REPLACE FUNCTION public.tutor_settle_debt_by_telegram(
  _telegram_id text, _tutor_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tutor_id uuid; _actor uuid; _owner uuid; _balance int; _debt int;
BEGIN
  SELECT id, user_id INTO _tutor_id, _actor FROM public.tutors WHERE telegram_id = _telegram_id LIMIT 1;
  IF _tutor_id IS NULL THEN RAISE EXCEPTION 'TUTOR_NOT_FOUND'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(_tutor_student_id::text));

  SELECT tutor_id, balance INTO _owner, _balance
  FROM public.tutor_students WHERE id = _tutor_student_id;
  IF _owner IS NULL THEN RAISE EXCEPTION 'STUDENT_NOT_FOUND'; END IF;
  IF _owner IS DISTINCT FROM _tutor_id THEN RAISE EXCEPTION 'NOT_OWNED'; END IF;

  IF COALESCE(_balance, 0) >= 0 THEN
    RETURN jsonb_build_object('ok', true, 'credited', 0, 'new_balance', COALESCE(_balance, 0));
  END IF;

  _debt := -_balance;
  INSERT INTO public.tutor_ledger_entries
    (tutor_id, tutor_student_id, kind, amount, occurred_on, source_kind, note, created_by)
  VALUES (_tutor_id, _tutor_student_id, 'credit', _debt, CURRENT_DATE, 'topup',
          'оплата (Telegram /pay)', _actor);

  SELECT balance INTO _balance FROM public.tutor_students WHERE id = _tutor_student_id;
  RETURN jsonb_build_object('ok', true, 'credited', _debt, 'new_balance', COALESCE(_balance, 0));
END $$;

REVOKE ALL ON FUNCTION public.tutor_settle_debt_by_telegram(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_settle_debt_by_telegram(text, uuid) TO service_role;

COMMENT ON FUNCTION public.tutor_settle_debt_by_telegram IS
  'Гасит долг ученика topup-кредитом (= -balance) по telegram_id. Race-safe (advisory-lock). /pay-бот (B5).';

NOTIFY pgrst, 'reload schema';