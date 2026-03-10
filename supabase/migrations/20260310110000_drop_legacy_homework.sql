-- Drop legacy student-only homework system
-- Tables: homework_sets, homework_tasks, homework_chat_messages
-- Also removes homework_task_id column and related constraint from chats table

-- 1. Drop CHECK constraint (requires homework_task_id when chat_type='homework_task')
ALTER TABLE public.chats
  DROP CONSTRAINT IF EXISTS homework_task_chat_has_task;

-- 2. Convert legacy homework_task chats to general type
UPDATE public.chats
   SET chat_type = 'general'
 WHERE chat_type = 'homework_task';

-- 3. Drop FK column from chats (FK constraint drops automatically with column)
ALTER TABLE public.chats
  DROP COLUMN IF EXISTS homework_task_id;

-- 4. Drop legacy tables (ON DELETE CASCADE handles child rows automatically)
DROP TABLE IF EXISTS public.homework_chat_messages;
DROP TABLE IF EXISTS public.homework_tasks;
DROP TABLE IF EXISTS public.homework_sets;
