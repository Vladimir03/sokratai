-- Расписание, Волна 1: цвета групп/учеников, тема урока, новые периоды повтора.
ALTER TABLE public.tutor_students ADD COLUMN IF NOT EXISTS color TEXT;

UPDATE public.tutor_students SET color = NULL
  WHERE color IS NOT NULL AND color !~ '^#[0-9A-Fa-f]{6}$';
ALTER TABLE public.tutor_students DROP CONSTRAINT IF EXISTS tutor_students_color_format_check;
ALTER TABLE public.tutor_students ADD CONSTRAINT tutor_students_color_format_check
  CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$');

UPDATE public.tutor_groups SET color = NULL
  WHERE color IS NOT NULL AND color !~ '^#[0-9A-Fa-f]{6}$';
ALTER TABLE public.tutor_groups DROP CONSTRAINT IF EXISTS tutor_groups_color_format_check;
ALTER TABLE public.tutor_groups ADD CONSTRAINT tutor_groups_color_format_check
  CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$');

ALTER TABLE public.tutor_lessons ADD COLUMN IF NOT EXISTS topic TEXT;

ALTER TABLE public.tutor_lessons DROP CONSTRAINT IF EXISTS tutor_lessons_recurrence_rule_check;
ALTER TABLE public.tutor_lessons ADD CONSTRAINT tutor_lessons_recurrence_rule_check
  CHECK (recurrence_rule IS NULL OR recurrence_rule IN ('daily', 'weekly', 'biweekly', 'monthly'));

ALTER TABLE public.tutor_calendar_events DROP CONSTRAINT IF EXISTS tutor_calendar_events_recurrence_rule_check;
ALTER TABLE public.tutor_calendar_events ADD CONSTRAINT tutor_calendar_events_recurrence_rule_check
  CHECK (recurrence_rule IS NULL OR recurrence_rule IN ('daily', 'weekly', 'biweekly', 'monthly'));