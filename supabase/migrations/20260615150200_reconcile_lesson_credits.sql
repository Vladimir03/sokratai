-- Student balance ledger — Phase 2b: one-time reconciliation of the credit side.
-- Plan: ~/.claude/plans/1-glowing-spindle.md. Depends on M1 (helpers) + M2 (wiring). Deploy AFTER M2.
--
-- ПРОБЛЕМА: сид (20260609120200 / 20260610155050 L247-255) зачёл исторические оплаченные строки
-- credit'ом `source_kind='adjustment'` БЕЗ source_lesson_id. Новый _sync_lesson_credit (M1) ключуется
-- по source_lesson_id и НЕ видит сидовый credit → каждый исторический оплаченный занятийный платёж
-- получил бы ДВОЙНОЙ зачёт при повторной пометке оплаты.
--
-- РЕШЕНИЕ — «reverse-all-then-rebuild» (доказуемо balance-neutral для сид-набора):
--   1. Сторнировать ВСЕ активные сидовые adjustment-credit'ы (note='seed: оплачено (история)') → −C_seed.
--   2a. Создать lesson-keyed credit на каждую `paid` lesson-привязанную tutor_payments-строку
--       (ON CONFLICT active-lesson-credit DO NOTHING — на случай, если M2 уже успел создать) → +C(lesson).
--   2b. Создать adjustment-credit на каждую `paid` НЕ-привязанную (manual) tutor_payments-строку → +C(manual).
--   3. Пометить учеников в маркере tutor_ledger_credit_recon_runs (идемпотентность re-apply).
--
-- БАЛАНС: для сид-набора Σ(сторно) = Σ(пересоздано) = C_seed → Δ=0. Шаги 2a/2b ДОПОЛНИТЕЛЬНО создают
-- credit'ы для post-seed `paid` строк, которые сид НЕ зачёл (дрейф: оплаченное занятие после сида = только
-- debit, баланс −amount; «+ Добавить» Lera 13.06 = вообще без ledger-записи). Для них Δ = +amount —
-- НАМЕРЕННОЕ выправление (владелец подтвердил «всё одним релизом», ожидает сдвиг балансов).
-- НЕ матчим credit↔занятие по сумме (same-amount неоднозначность) — сторним всё, пересоздаём из
-- tutor_payments-истины (одна строка = один credit, как в сиде).

-- ─── Маркер идемпотентности ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tutor_ledger_credit_recon_runs (
  tutor_student_id uuid PRIMARY KEY REFERENCES public.tutor_students(id) ON DELETE CASCADE,
  reconciled_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tutor_ledger_credit_recon_runs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.tutor_ledger_credit_recon_runs TO service_role;

-- ─── Шаг 1: сторнировать все активные сидовые adjustment-credit'ы (для не-сверенных учеников) ──
DO $$
DECLARE _row RECORD;
BEGIN
  FOR _row IN
    SELECT le.id
    FROM public.tutor_ledger_entries le
    WHERE le.kind = 'credit'
      AND le.source_kind = 'adjustment'
      AND le.note = 'seed: оплачено (история)'
      AND le.reversed_by_entry_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.tutor_ledger_credit_recon_runs r
        WHERE r.tutor_student_id = le.tutor_student_id
      )
  LOOP
    PERFORM public._reverse_ledger_entry(_row.id, 'reconcile: перенос оплаты на занятие', NULL);
  END LOOP;
END $$;

-- ─── Шаг 2a: lesson-keyed credit на каждую `paid` lesson-привязанную строку С активным debit ──
-- Review round-2 #2: гейт `EXISTS(active lesson-debit)` — credit создаём ТОЛЬКО где есть реальный заряд.
-- Нормальная оплаченная (есть debit) → +A после step1 −A = net 0 (balance-neutral). Reverted-paid
-- (debit сторнирован, paid-строка осталась) → step1 сторнирует сидовый credit, step2a SKIP → balance
-- +A→0 (исправление пред-существующего orphan'а). Cohort C (post-seed paid, есть debit, нет сидового
-- credit) → +A (намеренное выправление дрейфа).
INSERT INTO public.tutor_ledger_entries
  (tutor_id, tutor_student_id, kind, amount, occurred_on, source_kind, source_lesson_id, note, created_by)
SELECT ts.tutor_id, tp.tutor_student_id, 'credit', ROUND(tp.amount)::int,
       COALESCE((SELECT l.start_at::date FROM public.tutor_lessons l WHERE l.id = tp.lesson_id),
                tp.paid_at::date, tp.due_date, tp.created_at::date),
       'lesson', tp.lesson_id, 'reconcile: оплата за занятие', NULL
FROM public.tutor_payments tp
JOIN public.tutor_students ts ON ts.id = tp.tutor_student_id
WHERE tp.status = 'paid'
  AND tp.lesson_id IS NOT NULL
  AND ROUND(tp.amount)::int > 0
  AND EXISTS (
    SELECT 1 FROM public.tutor_ledger_entries d
    WHERE d.source_lesson_id = tp.lesson_id AND d.tutor_student_id = tp.tutor_student_id
      AND d.source_kind = 'lesson' AND d.kind = 'debit' AND d.reversed_by_entry_id IS NULL
  )
  -- round-4: гейт по СУЩЕСТВОВАНИЮ active debit, БЕЗ amount-match. M3 balance-neutral by construction
  -- (новый credit = ROUND(tp.amount) = сумма сторнированного сидового credit'а, независимо от суммы debit):
  -- amount-match здесь СКИПНУЛ бы аномальную строку (debit≠tp.amount) и сдвинул баланс после сторно
  -- сидового credit'а. Amount-match нужен ТОЛЬКО в runtime `_sync_lesson_credit` (где credit = новые
  -- деньги), не в сверке. Reverted-paid (нет active debit) по-прежнему скипается → orphan исправляется.
  AND NOT EXISTS (
    SELECT 1 FROM public.tutor_ledger_credit_recon_runs r
    WHERE r.tutor_student_id = tp.tutor_student_id
  )
ON CONFLICT (source_lesson_id, tutor_student_id)
  WHERE source_kind = 'lesson' AND kind = 'credit' AND reversed_by_entry_id IS NULL
DO NOTHING;

-- ─── Шаг 2b: adjustment-credit на каждую `paid` НЕ-привязанную (manual) строку ──
-- `source_payment_id` (round-2 #1): чтобы будущий `/pay` `_credit_manual_payment` (тот же ключ) был
-- идемпотентен против сверочного credit'а → нет двойного зачёта.
INSERT INTO public.tutor_ledger_entries
  (tutor_id, tutor_student_id, kind, amount, occurred_on, source_kind, source_payment_id, note, created_by)
SELECT ts.tutor_id, tp.tutor_student_id, 'credit', ROUND(tp.amount)::int,
       COALESCE(tp.paid_at::date, tp.due_date, tp.created_at::date),
       'adjustment', tp.id, 'reconcile: оплачено (история)', NULL
FROM public.tutor_payments tp
JOIN public.tutor_students ts ON ts.id = tp.tutor_student_id
WHERE tp.status = 'paid'
  AND tp.lesson_id IS NULL
  AND ROUND(tp.amount)::int > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.tutor_ledger_credit_recon_runs r
    WHERE r.tutor_student_id = tp.tutor_student_id
  )
ON CONFLICT (source_payment_id)
  WHERE source_payment_id IS NOT NULL AND kind = 'credit'
DO NOTHING;

-- ─── Шаг 3: пометить всех учеников с оплатами как сверенных (любой будущий re-apply → no-op) ──
INSERT INTO public.tutor_ledger_credit_recon_runs (tutor_student_id)
SELECT DISTINCT tp.tutor_student_id
FROM public.tutor_payments tp
WHERE NOT EXISTS (
  SELECT 1 FROM public.tutor_ledger_credit_recon_runs r
  WHERE r.tutor_student_id = tp.tutor_student_id
)
ON CONFLICT (tutor_student_id) DO NOTHING;

-- ─── Belt-and-suspenders: денормализованный balance == Σ ledger для сверенных учеников ──
DO $$
DECLARE _row RECORD;
BEGIN
  FOR _row IN SELECT tutor_student_id FROM public.tutor_ledger_credit_recon_runs LOOP
    PERFORM public.recompute_student_balance(_row.tutor_student_id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
