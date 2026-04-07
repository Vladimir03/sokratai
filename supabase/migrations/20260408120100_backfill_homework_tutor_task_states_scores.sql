-- Homework Results v2, TASK-1
-- Backfill ai_score for existing guided task states.
-- Idempotent: only fills rows where ai_score is still NULL.
--
-- Preferred source of truth is a task-state verdict column when present.
-- Current repo migrations do not define such a column, and the guided flow
-- only marks task_state.status = 'completed' after a correct answer.

BEGIN;

DO $$
DECLARE
  has_verdict_column boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'homework_tutor_task_states'
      AND column_name = 'verdict'
  )
  INTO has_verdict_column;

  IF has_verdict_column THEN
    EXECUTE $sql$
      UPDATE public.homework_tutor_task_states AS task_state
      SET ai_score = CASE
        WHEN upper(task_state.verdict) = 'CORRECT' THEN task.max_score::numeric(5,2)
        WHEN upper(task_state.verdict) = 'INCORRECT' THEN 0::numeric(5,2)
        ELSE task_state.ai_score
      END
      FROM public.homework_tutor_tasks AS task
      WHERE task.id = task_state.task_id
        AND task_state.ai_score IS NULL
        AND task.max_score IS NOT NULL
        AND upper(coalesce(task_state.verdict, '')) IN ('CORRECT', 'INCORRECT')
    $sql$;
  ELSE
    UPDATE public.homework_tutor_task_states AS task_state
    SET ai_score = task.max_score::numeric(5,2)
    FROM public.homework_tutor_tasks AS task
    WHERE task.id = task_state.task_id
      AND task_state.status = 'completed'
      AND task_state.ai_score IS NULL
      AND task.max_score IS NOT NULL;

    UPDATE public.homework_tutor_task_states AS task_state
    SET ai_score = 0::numeric(5,2)
    FROM public.homework_tutor_tasks AS task
    WHERE task.id = task_state.task_id
      AND task_state.status <> 'completed'
      AND coalesce(task_state.attempts, 0) > 0
      AND task_state.ai_score IS NULL
      AND task.max_score IS NOT NULL;
  END IF;
END $$;

COMMIT;
