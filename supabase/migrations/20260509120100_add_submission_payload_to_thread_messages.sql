-- Add submission_payload JSONB column + extend message_kind enum on homework_tutor_thread_messages.
--
-- Назначение:
--   Phase 1 student-side homework problem screen вводит SubmitSheet —
--   single-shot сдачу решения (числовой ответ + фото от руки + опциональный текст).
--   Submission хранится прямо в существующей таблице thread_messages,
--   через новый message_kind='submission' + структурированный payload в
--   submission_payload JSONB. Никакой отдельной submissions-таблицы
--   (та была удалена миграцией 20260406120000_drop_classic_homework.sql и
--   возрождать её не нужно).
--
--   submission_payload shape:
--     {
--       "numeric":   string,           -- canonical "1.4" или "1,4"
--       "photos":    string[],         -- storage:// refs (uploaded заранее)
--       "text":      string,           -- optional reasoning от ученика
--       "voice_ref": string | null     -- optional, Phase 2 voice recorder
--     }
--
--   Для message_kind != 'submission' колонка остаётся NULL — старые сообщения
--   не ломаются, RLS не трогается (existing policies из 20260306100000_*.sql
--   покрывают новый столбец автоматически).
--
-- Spec: docs/delivery/features/student-homework-problem-screen/spec.md §5 (Data Model), AC-1.
-- Phase: 1 (DB foundation, TASK-2).
--
-- Idempotent: безопасно прогонять повторно.
--   - ADD COLUMN IF NOT EXISTS защищает повторный add
--   - DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT даёт идемпотентный CHECK
--   - До этой миграции CHECK на message_kind в каноничной истории не существовал;
--     IF EXISTS защищает на случай ad-hoc constraint в staging.
--
-- Additive only: никаких DROP/RENAME существующих columns. Все existing
-- message_kind values из codebase остаются валидными после миграции.

-- 1. Новая nullable колонка для structured submission payload.
ALTER TABLE public.homework_tutor_thread_messages
  ADD COLUMN IF NOT EXISTS submission_payload jsonb NULL;

COMMENT ON COLUMN public.homework_tutor_thread_messages.submission_payload IS
  'For message_kind=submission: structured JSON {numeric: string, photos: string[], text: string, voice_ref?: string|null}.';

-- 2. CHECK constraint на message_kind (idempotent через DROP IF EXISTS + ADD).
--    NULL допускается для backward compat: existing rows и legacy insert paths,
--    которые не указывают message_kind, продолжают проходить.
ALTER TABLE public.homework_tutor_thread_messages
  DROP CONSTRAINT IF EXISTS homework_tutor_thread_messages_message_kind_check;

ALTER TABLE public.homework_tutor_thread_messages
  ADD CONSTRAINT homework_tutor_thread_messages_message_kind_check
    CHECK (
      message_kind IS NULL OR message_kind IN (
        'answer',
        'hint_request',
        'question',
        'bootstrap',
        'ai_reply',
        'system',
        'check_result',
        'hint_reply',
        'tutor_message',
        'tutor_note',
        'submission'
      )
    );
