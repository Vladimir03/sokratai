-- Per-tutor feature flag для голосовых заданий (voice-speaking-mvp, Этап 2, TASK-6).
--
-- Назначение:
--   Gating устной части (task_kind='speaking' + рекордер) на конкретного тутора.
--   MVP включается только Эмилии (power-user, языковой репетитор). Остальные
--   туторы флаг не видят → не показываем опцию «Устный ответ (монолог)» в
--   конструкторе ДЗ и не рендерим рекордер.
--
-- Mirror feature_mock_exams_enabled 1:1 (канонический образец —
--   20260508120000_mock_exams_v1_schema.sql §9): тот же тип BOOLEAN, тот же
--   NOT NULL DEFAULT false, тот же GRANT/RLS-контекст.
--
-- GRANT/RLS:
--   tutors уже имеет table-level GRANT SELECT, INSERT, UPDATE TO authenticated
--   (миграция 20260117213552) — НЕ column-whitelisted, поэтому новая колонка
--   автоматически читается клиентом без отдельного GRANT (как feature_mock_exams_enabled).
--   RLS на tutors — row-level (FOR SELECT policies), добавление колонки её не
--   затрагивает. Дополнительные GRANT/RLS не нужны (mirror mock-exams flag).
--
-- Additive only, idempotent (ADD COLUMN IF NOT EXISTS). Без DROP/RENAME.
--
-- Spec: docs/delivery/features/voice-speaking-mvp/spec.md §5 (Миграции), tasks.md TASK-6.
-- Включение Эмилии — TASK-11 (UPDATE tutors SET feature_voice_speaking_enabled=true WHERE user_id=...).

ALTER TABLE public.tutors
  ADD COLUMN IF NOT EXISTS feature_voice_speaking_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tutors.feature_voice_speaking_enabled IS
  'Per-tutor feature flag для voice-speaking-mvp (устные задания, task_kind=speaking). Tutor с false не видит опцию «Устный ответ (монолог)» в конструкторе ДЗ и рекордер у ученика. MVP включается только Эмилии (языковой power-user). Mirror feature_mock_exams_enabled.';
