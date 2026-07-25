ALTER TABLE public.homework_tutor_task_states
  ADD COLUMN IF NOT EXISTS ai_help_events integer,
  ADD COLUMN IF NOT EXISTS best_earned_score numeric(5,2);

COMMENT ON COLUMN public.homework_tutor_task_states.ai_help_events IS
  'Число обращений к помощи AI по задаче (разбор ошибки / подсказка / ответ Сократа в обсуждении). Основа «% самостоятельности» = 100 - 10*N, floor 0. NULL = данных нет (до релиза 2026-07-25 или force-complete) → в UI «—», в агрегат не входит. Инкрементится ТОЛЬКО кодом homework-api (SQL-каунт по thread_messages дал бы 2-3x: вердикты и подсказки пишутся одним kind=ai_reply).';

COMMENT ON COLUMN public.homework_tutor_task_states.best_earned_score IS
  'Лучший балл за все попытки задачи (GREATEST(prev, earned) на каждой записи балла). Приоритет в computeFinalScore: override → best_earned_score → earned_score → ai_score → (completed ? max : 0). Ручной балл репетитора здесь НЕ пишется — иначе override стал бы «липким» после сброса.';

COMMENT ON COLUMN public.homework_tutor_task_states.best_score IS
  'DEPRECATED для скоринга (integer — теряет дробные баллы). Для «лучшего балла» использовать best_earned_score numeric(5,2). Колонку не удаляем: читается легаси-RPC.';

GRANT SELECT (ai_help_events, best_earned_score)
  ON public.homework_tutor_task_states
  TO authenticated;

UPDATE public.homework_tutor_task_states
   SET best_earned_score = earned_score
 WHERE earned_score IS NOT NULL
   AND best_earned_score IS NULL;

UPDATE public.homework_tutor_task_states
   SET ai_help_events = 0
 WHERE ai_help_events IS NULL
   AND COALESCE(hint_count, 0) = 0
   AND COALESCE(wrong_answer_count, 0) = 0
   AND COALESCE(attempts, 0) <= 1;

CREATE OR REPLACE FUNCTION public.hw_bump_ai_help_events(
  _task_state_id uuid,
  _delta integer DEFAULT 1
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new integer;
BEGIN
  IF _delta IS NULL OR _delta <= 0 THEN
    RAISE EXCEPTION 'hw_bump_ai_help_events: _delta must be positive, got %', _delta;
  END IF;

  UPDATE homework_tutor_task_states
     SET ai_help_events = COALESCE(ai_help_events, 0) + _delta,
         updated_at = now()
   WHERE id = _task_state_id
  RETURNING ai_help_events INTO v_new;

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.hw_bump_ai_help_events(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hw_bump_ai_help_events(uuid, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hw_bump_ai_help_events(uuid, integer) TO service_role;

COMMENT ON FUNCTION public.hw_bump_ai_help_events(uuid, integer) IS
  'Атомарный инкремент homework_tutor_task_states.ai_help_events (метрика «% самостоятельности»). service_role-only: вызывается из homework-api в 3 точках (разбор ошибки ON_TRACK/INCORRECT, подсказка, ответ AI в обсуждении). NULL в ответе = задачи нет.';