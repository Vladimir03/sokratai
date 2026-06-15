CREATE TABLE IF NOT EXISTS public.tutor_ledger_credit_recon_runs (
  tutor_student_id uuid PRIMARY KEY REFERENCES public.tutor_students(id) ON DELETE CASCADE,
  reconciled_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tutor_ledger_credit_recon_runs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.tutor_ledger_credit_recon_runs TO service_role;

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
  AND NOT EXISTS (
    SELECT 1 FROM public.tutor_ledger_credit_recon_runs r
    WHERE r.tutor_student_id = tp.tutor_student_id
  )
ON CONFLICT (source_lesson_id, tutor_student_id)
  WHERE source_kind = 'lesson' AND kind = 'credit' AND reversed_by_entry_id IS NULL
DO NOTHING;

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

INSERT INTO public.tutor_ledger_credit_recon_runs (tutor_student_id)
SELECT DISTINCT tp.tutor_student_id
FROM public.tutor_payments tp
WHERE NOT EXISTS (
  SELECT 1 FROM public.tutor_ledger_credit_recon_runs r
  WHERE r.tutor_student_id = tp.tutor_student_id
)
ON CONFLICT (tutor_student_id) DO NOTHING;

DO $$
DECLARE _row RECORD;
BEGIN
  FOR _row IN SELECT tutor_student_id FROM public.tutor_ledger_credit_recon_runs LOOP
    PERFORM public.recompute_student_balance(_row.tutor_student_id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';