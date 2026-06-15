ALTER TABLE public.student_report_links
  ADD COLUMN IF NOT EXISTS verdict          text    NULL,
  ADD COLUMN IF NOT EXISTS show_mock_score  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_hw_done     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_hw_success  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tutor_comment    text    NULL,
  ADD COLUMN IF NOT EXISTS period_kind      text    NOT NULL DEFAULT 'last_month',
  ADD COLUMN IF NOT EXISTS period_start     date    NULL,
  ADD COLUMN IF NOT EXISTS period_end       date    NULL,
  ADD COLUMN IF NOT EXISTS show_debt_line   boolean NOT NULL DEFAULT true;

DO $$ BEGIN
  ALTER TABLE public.student_report_links
    ADD CONSTRAINT chk_report_verdict
      CHECK (verdict IS NULL OR verdict IN ('good', 'ok', 'attention'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.student_report_links
    ADD CONSTRAINT chk_report_period_kind
      CHECK (period_kind IN ('all', 'last_month'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.student_report_links.verdict IS
  'Вердикт тренера для родителя: good (молодец) / ok (есть над чем поработать) / attention (нужен контроль). NULL = не задан.';
COMMENT ON COLUMN public.student_report_links.tutor_comment IS
  'Свободный комментарий тренера к отчёту. Виден родителю BY DESIGN (mirror tutor_overall_comment, rule 40).';
COMMENT ON COLUMN public.student_report_links.period_kind IS
  'Пресет периода отчёта: all | last_month. period_start/period_end — конкретные даты снимка для отображения и фильтрации.';
COMMENT ON COLUMN public.student_report_links.show_debt_line IS
  'Показывать ли строку баланса/оплат родителю (Елена: часть тренеров ведёт оплаты вне Сократа).';

ALTER TABLE public.tutors
  ADD COLUMN IF NOT EXISTS report_show_debt_default boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.tutors.report_show_debt_default IS
  'Запомненный выбор тренера: показывать ли оплату в «Отчёте родителю» по умолчанию.';

UPDATE public.student_report_links l
SET revoked_at = now()
WHERE l.revoked_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.student_report_links l2
    WHERE l2.tutor_student_id = l.tutor_student_id
      AND l2.revoked_at IS NULL
      AND (l2.created_at > l.created_at
           OR (l2.created_at = l.created_at AND l2.slug > l.slug))
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_report_links_active
  ON public.student_report_links (tutor_student_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.student_report_links
  ALTER COLUMN slug SET DEFAULT substr(md5(gen_random_uuid()::text), 1, 24);