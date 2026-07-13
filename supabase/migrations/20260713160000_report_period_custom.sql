-- «Отчёт родителю» — добавляем период 'custom' (ОС Елены: свой диапазон «с … по …»).
-- Аддитивно: расширяем CHECK на period_kind. Колонки period_start/period_end уже есть
-- (миграция 20260615120000_report_config.sql). DROP+ADD идемпотентен (re-runnable).

ALTER TABLE public.student_report_links DROP CONSTRAINT IF EXISTS chk_report_period_kind;
ALTER TABLE public.student_report_links
  ADD CONSTRAINT chk_report_period_kind CHECK (period_kind IN ('all', 'last_month', 'custom'));

COMMENT ON COLUMN public.student_report_links.period_kind IS
  'Пресет периода отчёта: all | last_month (текущий месяц с 1-го по сегодня) | custom (свой диапазон). period_start/period_end — конкретные даты снимка.';
