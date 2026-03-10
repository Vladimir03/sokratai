-- Remove homework attempts system
-- Removes: max_attempts (assignment limit), attempt_no (submission sequence)
-- Keeps: attempts column in homework_tutor_task_states (guided-mode task step counter)

-- 1. Drop the trigger that enforces deadline + max_attempts on submission INSERT
DROP TRIGGER IF EXISTS trg_validate_homework_submission ON public.homework_tutor_submissions;

-- 2. Replace the validation function — deadline check only, no MAX_ATTEMPTS_REACHED
CREATE OR REPLACE FUNCTION public.validate_homework_submission()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_deadline TIMESTAMPTZ;
BEGIN
  SELECT deadline
    INTO v_deadline
    FROM public.homework_tutor_assignments
   WHERE id = NEW.assignment_id;

  IF v_deadline IS NOT NULL AND now() > v_deadline THEN
    RAISE EXCEPTION 'DEADLINE_PASSED';
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Re-attach trigger (deadline check only)
CREATE TRIGGER trg_validate_homework_submission
  BEFORE INSERT ON public.homework_tutor_submissions
  FOR EACH ROW EXECUTE FUNCTION public.validate_homework_submission();

-- 4. Drop CHECK constraint on max_attempts before dropping column
ALTER TABLE public.homework_tutor_assignments
  DROP CONSTRAINT IF EXISTS homework_tutor_assignments_max_attempts_positive;

-- 5. Drop columns
ALTER TABLE public.homework_tutor_assignments
  DROP COLUMN IF EXISTS max_attempts;

ALTER TABLE public.homework_tutor_submissions
  DROP COLUMN IF EXISTS attempt_no;
