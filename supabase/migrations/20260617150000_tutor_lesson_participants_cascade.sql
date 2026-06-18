-- =============================================================================
-- Фикс: ученика невозможно удалить («Не удалось удалить ученика», репорт Елены —
-- «Дункан Маклауд»). Причина: tutor_lesson_participants.tutor_student_id ссылался
-- на tutor_students(id) БЕЗ ON DELETE (= RESTRICT) → удаление ученика, бывшего
-- участником группового занятия, падало FK-violation (23503). Остальные ссылки
-- (payments/ledger/memberships) уже CASCADE — participant был единственным блокером.
--
-- Приводим к консистентности: ON DELETE CASCADE (удаление ученика убирает его
-- строки-участники групповых занятий). Удаление — деструктивное по дизайну;
-- безопасная альтернатива (архив, archived_at) предлагается в UI.
--
-- Additive: меняем только поведение FK, колонку не трогаем.
-- =============================================================================

ALTER TABLE public.tutor_lesson_participants
  DROP CONSTRAINT IF EXISTS tutor_lesson_participants_tutor_student_id_fkey;

ALTER TABLE public.tutor_lesson_participants
  ADD CONSTRAINT tutor_lesson_participants_tutor_student_id_fkey
  FOREIGN KEY (tutor_student_id)
  REFERENCES public.tutor_students(id) ON DELETE CASCADE;
