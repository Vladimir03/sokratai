BEGIN;

ALTER TABLE public.tutor_students
  ADD COLUMN IF NOT EXISTS gender TEXT NULL
    CHECK (gender IS NULL OR gender IN ('male', 'female'));

COMMENT ON COLUMN public.tutor_students.gender IS
  'Tutor-curated student gender для AI grammar conjugation. Values: male / female / null. Fallback: tutor_students.gender → profiles.gender → null.';

COMMIT;