-- Phase 9 (2026-05-25, "1-functional-meteor.md") — fix save-as-template для не-legacy subjects.
--
-- Зеркало миграции 20260414150000_unify_homework_subject_check.sql, но для
-- homework_tutor_templates (которая была пропущена в той миграции).
--
-- Симптом до фикса (CLAUDE.md §7 known schema drift bug):
--   репетитор французского нажимает «Сохранить как шаблон» на DELF B1 ДЗ →
--   backend INSERT INTO homework_tutor_templates (subject='french', ...) →
--   CHECK constraint violation (legacy список принимает только
--   'math', 'physics', 'history', 'social', 'english', 'cs') →
--   handleCreateTemplateFromAssignment ловит generic insertErr →
--   возвращает 500 DB_ERROR → frontend toast «Не удалось сохранить шаблон».
--
-- До этой миграции `homework_tutor_assignments_subject_check` был унифицирован
-- (20260414150000), но `homework_tutor_templates_subject_check` остался на legacy
-- списке из исходной миграции 20260226100000_homework_20.sql:40.
--
-- После — оба CHECK constraint полностью симметричны (19 canonical + legacy ids).
-- Идемпотентно: DROP CONSTRAINT IF EXISTS защищает от re-apply.

ALTER TABLE public.homework_tutor_templates
  DROP CONSTRAINT IF EXISTS homework_tutor_templates_subject_check;

ALTER TABLE public.homework_tutor_templates
  ADD CONSTRAINT homework_tutor_templates_subject_check
  CHECK (subject IN (
    -- Canonical modern ids (src/types/homework.ts SUBJECTS + VALID_SUBJECTS_CREATE)
    'maths', 'physics', 'informatics',
    'russian', 'literature', 'history', 'social',
    'english', 'french', 'spanish',
    'chemistry', 'biology', 'geography',
    'other',
    -- Legacy ids preserved for backward compat с существующими шаблонами
    -- и с VALID_SUBJECTS_UPDATE в supabase/functions/homework-api/index.ts
    'math', 'cs', 'rus', 'algebra', 'geometry'
  ));

COMMENT ON CONSTRAINT homework_tutor_templates_subject_check ON public.homework_tutor_templates IS
  'Unified subject CHECK constraint (Phase 9, 2026-05-25). Mirror homework_tutor_assignments_subject_check. При добавлении нового subject в src/types/homework.ts SUBJECTS — обновлять ОБА CHECK constraint одновременно (см. CLAUDE.md §7).';
