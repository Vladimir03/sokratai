CREATE OR REPLACE FUNCTION public.hw_log_tutor_correction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind        text;
  v_subject     text;
  v_tutor_id    uuid;
  v_student_id  uuid;
  v_assignment  uuid;
  v_check_fmt   text;
  v_task_kind   text;
  v_kim         int;
  v_max_score   numeric;
BEGIN
  v_kind := CASE
    WHEN NEW.tutor_force_completed_at IS NOT NULL AND OLD.tutor_force_completed_at IS NULL THEN 'force_complete'
    WHEN NEW.tutor_force_completed_at IS NULL AND OLD.tutor_force_completed_at IS NOT NULL THEN 'reopen'
    WHEN NEW.tutor_score_override IS NULL AND OLD.tutor_score_override IS NOT NULL THEN 'reset'
    WHEN NEW.tutor_score_override IS DISTINCT FROM OLD.tutor_score_override THEN 'override'
    WHEN NEW.tutor_reviewed_at IS NOT NULL AND OLD.tutor_reviewed_at IS NULL THEN 'review'
    WHEN NEW.tutor_reviewed_at IS NULL AND OLD.tutor_reviewed_at IS NOT NULL THEN 'review_reopen'
    ELSE 'other'
  END;

  SELECT a.subject, a.tutor_id, sa.student_id, a.id,
         t.check_format, t.task_kind, t.kim_number, t.max_score
    INTO v_subject, v_tutor_id, v_student_id, v_assignment,
         v_check_fmt, v_task_kind, v_kim, v_max_score
  FROM public.homework_tutor_threads th
    JOIN public.homework_tutor_student_assignments sa ON sa.id = th.student_assignment_id
    JOIN public.homework_tutor_assignments         a  ON a.id  = sa.assignment_id
    JOIN public.homework_tutor_tasks               t  ON t.id  = NEW.task_id
  WHERE th.id = NEW.thread_id;

  INSERT INTO public.hw_ai_check_events (
    event_type, student_id, tutor_id, assignment_id, task_id, task_state_id,
    subject, check_format, task_kind, kim_number, max_score,
    correction_kind, tutor_score_override, ai_score_at_correction, override_delta, meta
  ) VALUES (
    'tutor_correction', v_student_id, v_tutor_id, v_assignment, NEW.task_id, NEW.id,
    v_subject, v_check_fmt, v_task_kind, v_kim, v_max_score,
    v_kind, NEW.tutor_score_override, NEW.ai_score,
    CASE WHEN NEW.tutor_score_override IS NOT NULL AND NEW.ai_score IS NOT NULL
         THEN NEW.tutor_score_override - NEW.ai_score END,
    jsonb_build_object(
      'source',         'db_trigger',
      'score_changed',  (OLD.tutor_score_override    IS DISTINCT FROM NEW.tutor_score_override),
      'review_changed', (OLD.tutor_reviewed_at       IS DISTINCT FROM NEW.tutor_reviewed_at),
      'force_changed',  (OLD.tutor_force_completed_at IS DISTINCT FROM NEW.tutor_force_completed_at),
      'prev_override',  OLD.tutor_score_override,
      'status',         NEW.status
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'hw_log_tutor_correction failed (non-fatal): %', SQLERRM;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.hw_log_tutor_correction() IS
  'Пишет tutor_correction в hw_ai_check_events при ЛЮБОЙ правке тьюторских полей task_states (аналитика качества AI-проверки). Write-path-agnostic: заменяет инструментирование отдельных edge-хендлеров. Сбой не фатален.';

DROP TRIGGER IF EXISTS trg_hw_log_tutor_correction ON public.homework_tutor_task_states;

CREATE TRIGGER trg_hw_log_tutor_correction
AFTER UPDATE ON public.homework_tutor_task_states
FOR EACH ROW
WHEN (
  OLD.tutor_score_override     IS DISTINCT FROM NEW.tutor_score_override
  OR OLD.tutor_reviewed_at        IS DISTINCT FROM NEW.tutor_reviewed_at
  OR OLD.tutor_force_completed_at IS DISTINCT FROM NEW.tutor_force_completed_at
)
EXECUTE FUNCTION public.hw_log_tutor_correction();