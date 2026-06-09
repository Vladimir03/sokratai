-- Student balance ledger — Phase 2a, TASK-1 (foundation, NEW code only).
-- SPEC: docs/delivery/features/scheduling-payments-balance/spec.md (v4) — Migration 1–3.
--
-- Money model: balance = Σ all signed ledger entries (RUBLES, integer). Append-only.
-- Invariants:
--   * Ledger writes ONLY via SECURITY DEFINER (RPC/helpers) — REVOKE from authenticated/anon.
--   * Direct UPDATE of tutor_students.balance is BLOCKED by a guarded trigger (AC-10);
--     balance changes only inside a ledger op (GUC app.ledger_op='on').
--   * balance = recompute_student_balance() (AC-4).
-- Units: RUBLES integer everywhere (no kopecks, no *100). This migration is purely additive
-- and does NOT touch any existing RPC (debit wiring = TASK-3).

-- ─── 1. Ledger table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tutor_ledger_entries (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id             uuid NOT NULL REFERENCES public.tutors(id) ON DELETE CASCADE,
  tutor_student_id     uuid NOT NULL REFERENCES public.tutor_students(id) ON DELETE CASCADE,
  kind                 text NOT NULL CHECK (kind IN ('debit','credit')),
  amount               integer NOT NULL CHECK (amount > 0),          -- RUBLES, sign derived from kind
  occurred_on          date NOT NULL DEFAULT CURRENT_DATE,
  source_kind          text NOT NULL CHECK (source_kind IN ('lesson','topup','adjustment')),
  source_lesson_id     uuid REFERENCES public.tutor_lessons(id) ON DELETE SET NULL,
  reverses_entry_id    uuid REFERENCES public.tutor_ledger_entries(id) ON DELETE SET NULL, -- on the offsetting row: which entry it reverses
  reversed_by_entry_id uuid REFERENCES public.tutor_ledger_entries(id) ON DELETE SET NULL, -- on the original row: the offsetting entry
  note                 text,
  created_by           uuid,    -- NULLABLE: seed/service-role/Telegram (no auth.uid); = COALESCE(auth.uid(), tutors.user_id) in RPC
  created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tutor_ledger_entries IS
  'Append-only money ledger per student (RUBLES). balance = Σ signed entries. Writes only via SECURITY DEFINER.';

-- Idempotency: exactly one ACTIVE lesson-debit per (lesson, student); reverse frees the slot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_active_lesson_debit
  ON public.tutor_ledger_entries (source_lesson_id, tutor_student_id)
  WHERE source_kind = 'lesson' AND kind = 'debit' AND reversed_by_entry_id IS NULL;

-- One reversal per original entry.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_one_reversal
  ON public.tutor_ledger_entries (reverses_entry_id)
  WHERE reverses_entry_id IS NOT NULL;

-- Ledger feed (student card / «Оплаты»).
CREATE INDEX IF NOT EXISTS idx_ledger_student_created
  ON public.tutor_ledger_entries (tutor_student_id, created_at DESC);

-- ─── 2. Denormalized balance (RUBLES) ─────────────────────────────────────────
ALTER TABLE public.tutor_students
  ADD COLUMN IF NOT EXISTS balance integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.tutor_students.balance IS
  'Денормализованный баланс (РУБЛИ) = Σ ledger. Ledger-managed: прямой UPDATE заблокирован триггером.';

-- ─── 3. RLS: tutor reads own ledger; writes only via SECURITY DEFINER ──────────
ALTER TABLE public.tutor_ledger_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tutors view own ledger entries" ON public.tutor_ledger_entries;
CREATE POLICY "Tutors view own ledger entries"
  ON public.tutor_ledger_entries FOR SELECT
  USING (public.owns_tutor_student(tutor_student_id));
-- No INSERT/UPDATE/DELETE policy → authenticated cannot write directly.
REVOKE INSERT, UPDATE, DELETE ON public.tutor_ledger_entries FROM authenticated, anon;

-- ─── 4. Balance-maintenance trigger (AFTER INSERT): atomic +delta ─────────────
-- Sets the transaction-local GUC so the guarded BEFORE-UPDATE trigger (below) permits
-- THIS balance write, then clears it. SECURITY DEFINER → bypasses the ledger REVOKE/RLS.
CREATE OR REPLACE FUNCTION public.tutor_ledger_apply_balance()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.ledger_op', 'on', true);  -- transaction-local
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

-- ─── 5. Guarded trigger: block direct balance writes (AC-10) ──────────────────
-- balance is ledger-managed: any UPDATE that changes balance outside a ledger op (GUC) raises.
-- Profile edits (notes/rate/…) don't touch balance → pass. Direct PostgREST UPDATE of balance → reject.
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

-- ─── 6. Reconcile helper (nightly / AC-4) ─────────────────────────────────────
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
