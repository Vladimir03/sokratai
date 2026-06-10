CREATE TABLE IF NOT EXISTS public.student_report_links (
  slug             text PRIMARY KEY DEFAULT substr(md5(gen_random_uuid()::text), 1, 8),
  tutor_student_id uuid NOT NULL REFERENCES public.tutor_students(id) ON DELETE CASCADE,
  created_by       uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz NULL
);

COMMENT ON TABLE public.student_report_links IS
  'Share-ссылки «Отчёт родителю»: slug = bearer. Публичное чтение только через service_role edge (anti-leak whitelist).';

CREATE INDEX IF NOT EXISTS idx_student_report_links_student
  ON public.student_report_links (tutor_student_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_report_links TO authenticated;
GRANT ALL ON public.student_report_links TO service_role;

ALTER TABLE public.student_report_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tutors manage own report links" ON public.student_report_links;
CREATE POLICY "Tutors manage own report links"
  ON public.student_report_links
  FOR ALL
  TO authenticated
  USING (public.owns_tutor_student(tutor_student_id))
  WITH CHECK (public.owns_tutor_student(tutor_student_id));