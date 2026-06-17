-- =============================================================================
-- schedule-materials (rule 98) — разрешить НЕСКОЛЬКО разных ДЗ на один урок.
-- Запрос Елены Ивановой: «не могу прикрепить к одному уроку сразу две домашки».
--
-- Заменяем гард 1:1 (uq_tlm_one_hw_per_lesson) на гард от дублей: одно и то же
-- ДЗ нельзя привязать к уроку дважды, но РАЗНЫЕ ДЗ — можно. tlm_student_select
-- RLS уже построчный, поэтому N homework_ref остаются корректно скоупленными —
-- RLS не трогаем. Additive-safe: только своп индекса (DROP/CREATE INDEX).
-- =============================================================================

-- Старый 1:1 гард создан в 20260602140000 И продублирован в консолидированном
-- снапшоте Lovable 20260602160423 под тем же именем → IF EXISTS покрывает оба.
DROP INDEX IF EXISTS public.uq_tlm_one_hw_per_lesson;

-- Новый гард: пара (урок, ДЗ) уникальна. Partial на homework_ref, поэтому строки
-- recording/pdf (homework_assignment_id IS NULL) не затронуты. homework_assignment_id
-- здесь NOT NULL по chk_kind_payload, так что пара всегда определена.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tlm_one_hw_pair_per_lesson
  ON public.tutor_lesson_materials (lesson_id, homework_assignment_id)
  WHERE material_kind = 'homework_ref';

-- Данные мигрировать не нужно: до этой миграции на урок был максимум один
-- homework_ref, значит все существующие пары (lesson_id, homework_assignment_id)
-- уже уникальны. Старый индекс не пересоздавать.
