-- Student balance ledger — Phase 2a, TASK-4 (seed from tutor_payments, one-shot, marker-guarded).
-- SPEC v4 / AC-1. Opening balance = −Σ(pending+overdue) (текущий долг, НЕ выручка).
-- Per-row: debit на КАЖДУЮ payment-строку (charge) + credit на КАЖДУЮ paid (received) → net = −долг.
-- Units: RUBLES (ROUND(amount)::int; tutor_payments.amount = NUMERIC). created_by = NULL (миграция).
-- Idempotency: marker-таблица (НЕ note/created_by — seed-debit неотличим от live).
--
-- lesson-linked payments → debit source_kind='lesson' (+source_lesson_id), чтобы будущий
-- re-complete того же занятия был ИДЕМПОТЕНТЕН (_sync_lesson_debit найдёт active debit → no-op,
-- без двойного списания). Non-lesson manual payments → source_kind='adjustment'.

-- ─── Marker ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tutor_ledger_seed_runs (
  tutor_student_id uuid PRIMARY KEY REFERENCES public.tutor_students(id) ON DELETE CASCADE,
  seeded_at        timestamptz NOT NULL DEFAULT now()
);

-- ─── Seed debits (одна на каждую payment-строку, amount>0, для не-сидированных учеников) ──
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

-- ─── Seed credits (одна на каждую PAID payment-строку) ───────────────────────
INSERT INTO public.tutor_ledger_entries
  (tutor_id, tutor_student_id, kind, amount, occurred_on, source_kind, note, created_by)
SELECT ts.tutor_id, tp.tutor_student_id, 'credit', ROUND(tp.amount)::int,
       COALESCE(tp.paid_at::date, tp.due_date, tp.created_at::date),
       'adjustment', 'seed: оплачено (история)', NULL
FROM public.tutor_payments tp
JOIN public.tutor_students ts ON ts.id = tp.tutor_student_id
WHERE tp.status = 'paid' AND ROUND(tp.amount)::int > 0
  AND NOT EXISTS (SELECT 1 FROM public.tutor_ledger_seed_runs r WHERE r.tutor_student_id = tp.tutor_student_id);

-- ─── Mark seeded students (любой, у кого были оплаты) ─────────────────────────
INSERT INTO public.tutor_ledger_seed_runs (tutor_student_id)
SELECT DISTINCT tp.tutor_student_id
FROM public.tutor_payments tp
WHERE NOT EXISTS (SELECT 1 FROM public.tutor_ledger_seed_runs r WHERE r.tutor_student_id = tp.tutor_student_id)
ON CONFLICT (tutor_student_id) DO NOTHING;

-- Итог: tutor_students.balance (через AFTER-INSERT trigger) = Σcredit − Σdebit = −Σ(pending+overdue).
-- Ученик только с paid-историей → balance 0. Re-run миграции → ученики в маркере → INSERT'ы пропускают (AC-1).
