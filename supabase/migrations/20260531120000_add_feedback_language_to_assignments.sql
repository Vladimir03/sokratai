-- Phase 11 (2026-05-31, "1-functional-meteor.md") — детерминированный язык AI-feedback
-- на языковых ДЗ.
--
-- Баг (репортер — Эмилия, FR/DELF, 2026-05-31): на одном и том же французском ДЗ
-- AI одному ученику отвечает по-русски, другому по-французски. Причина: нет
-- детерминированной инструкции языка ответа — модель угадывает по языку ввода
-- ученика. (Тот же класс, что CEFR-level fix 2026-05-29: эвристика вместо явного
-- сигнала.)
--
-- Fix — assignment-level `feedback_language`:
--   'auto'    — уровень-зависимо: A2 → русские объяснения (примеры на изучаемом),
--               B1+ → полная иммерсия на изучаемом языке. ДЕФОЛТ.
--   'russian' — всегда по-русски (объяснения), примеры на изучаемом.
--   'target'  — всегда на изучаемом языке (иммерсия), даже если ученик пишет по-русски.
--
-- Резолвится в `_shared/subject-rubrics` → `response_language_instruction`,
-- инжектится во все 3 AI-пути (check / hint / chat). Non-language subjects
-- игнорируют (instruction = null).
--
-- Assignment-level (одна политика на ДЗ). 'auto' уже даёт per-task поведение
-- через `homework_tutor_tasks.cefr_level`. DB DEFAULT покрывает HWDrawer path B
-- (он не пишет колонку явно).
--
-- Идемпотентно: ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.homework_tutor_assignments
  ADD COLUMN IF NOT EXISTS feedback_language TEXT NULL
    DEFAULT 'auto'
    CHECK (feedback_language IS NULL OR feedback_language IN ('auto', 'russian', 'target'));

COMMENT ON COLUMN public.homework_tutor_assignments.feedback_language IS
  'Phase 11 (2026-05-31). Язык AI-feedback на языковых ДЗ: auto (A2→ru, B1+→target) / russian / target. NULL = auto. Резолвится в _shared/subject-rubrics → response_language_instruction → все 3 AI-пути. Non-language subjects игнорируют.';
