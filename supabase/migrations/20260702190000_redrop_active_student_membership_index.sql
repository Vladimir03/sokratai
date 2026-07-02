-- =============================================================================
-- Fix: «Профиль ученика сохранён, но мини-группа не обновилась» (Владимир/Егор, 2026-07-02)
--
-- Диагностика: назначение ОСНОВНОЙ группы ученику падало на upsert в
-- tutor_group_memberships. Подозрение — воскресший partial-unique индекс
-- idx_tutor_group_memberships_active_student_unique (tutor_student_id) WHERE is_active
-- = «≤1 активный membership на ученика». Он НЕСОВМЕСТИМ с моделью «группа + метки»
-- (2026-06-18): ученику нужно ≥1 активной строки (основная группа + N меток), поэтому
-- индекс уже дропался в 20260618120000 и 20260619065643. Если schema-sync его
-- пересоздал — назначение группы ученику, у которого уже есть любой активный
-- membership (метка/группа), нарушает partial-unique → «группа не обновилась».
--
-- Инвариант «≤1 активная ОСНОВНАЯ группа» держит guard-триггер
-- tutor_group_memberships_single_primary_guard (20260618120000), НЕ этот индекс.
-- Дубль-гард idx_tutor_group_memberships_student_group_unique (student, group) остаётся.
--
-- DROP IF EXISTS — no-op если индекса уже нет; чинит, если воскрес.
-- =============================================================================

DROP INDEX IF EXISTS public.idx_tutor_group_memberships_active_student_unique;

NOTIFY pgrst, 'reload schema';
