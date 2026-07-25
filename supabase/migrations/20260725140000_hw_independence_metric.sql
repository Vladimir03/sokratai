-- ============================================================================
-- «% самостоятельности» (Т7 из PRD homework-work-modes) — схема (T1, 2026-07-25)
--
-- МОДЕЛЬ (утверждена владельцем 2026-07-25):
--   самостоятельность задачи = 100% − 10 п.п. × (число обращений к помощи AI),
--   не ниже 0%. Обращение = разбор ошибки (одна сдача = один минус) / подсказка
--   по кнопке / ответ Сократа в обсуждении этой задачи. НЕ считается:
--   подтверждение верного ответа (CORRECT), авто-вступление, техсбой проверки,
--   реплики живого репетитора, системное понижение confidence.
--
--   Балл задачи = ЛУЧШИЙ за все попытки (раньше — последняя оценка), и балл
--   больше НЕ срезается за подсказки: штрафуем метрику процесса, а не оценку
--   знания. «Так будет чётко видна шкала ФИПИ, к которой мы приучаем ребёнка».
--
--   В самостоятельной работе (`work_mode='independent'`) метрика не
--   показывается — там AI выключен и она всегда 100%.
--
-- Эталон структуры GRANT'ов — `20260516120100_column_grants_homework_tutor_task_states.sql`:
-- у таблицы column-level whitelist, `*`-select для authenticated заблокирован
-- НАВСЕГДА, поэтому новая student/tutor-видимая колонка ОБЯЗАНА получить
-- явный GRANT — иначе клиентские чтения (`useTutorStudentActivity`) её не увидят.
-- ============================================================================

ALTER TABLE public.homework_tutor_task_states
  ADD COLUMN IF NOT EXISTS ai_help_events integer,
  ADD COLUMN IF NOT EXISTS best_earned_score numeric(5,2);

-- ─── Семантика NULL ──────────────────────────────────────────────────────────
-- `ai_help_events` НАМЕРЕННО nullable и БЕЗ DEFAULT 0: нуль соврал бы
-- «решено полностью самостоятельно» на всех работах до релиза и на задачах,
-- закрытых массовым force-complete (`hw_tutor_force_complete_all_tasks`
-- ставит `completed` вообще без баллов). NULL → в UI «—» и исключение из
-- знаменателя агрегата.
COMMENT ON COLUMN public.homework_tutor_task_states.ai_help_events IS
  'Число обращений к помощи AI по задаче (разбор ошибки / подсказка / ответ Сократа в обсуждении). Основа «% самостоятельности» = 100 - 10*N, floor 0. NULL = данных нет (до релиза 2026-07-25 или force-complete) → в UI «—», в агрегат не входит. Инкрементится ТОЛЬКО кодом homework-api (SQL-каунт по thread_messages дал бы 2-3x: вердикты и подсказки пишутся одним kind=ai_reply).';

COMMENT ON COLUMN public.homework_tutor_task_states.best_earned_score IS
  'Лучший балл за все попытки задачи (GREATEST(prev, earned) на каждой записи балла). Приоритет в computeFinalScore: override → best_earned_score → earned_score → ai_score → (completed ? max : 0). Ручной балл репетитора здесь НЕ пишется — иначе override стал бы «липким» после сброса.';

-- `best_score` (integer) остаётся для legacy-RPC, но для скоринга не годится:
-- теряет 0.5 (шаг max_score) и 0.1 (шаг override).
COMMENT ON COLUMN public.homework_tutor_task_states.best_score IS
  'DEPRECATED для скоринга (integer — теряет дробные баллы). Для «лучшего балла» использовать best_earned_score numeric(5,2). Колонку не удаляем: читается легаси-RPC.';

-- ─── GRANT (обязателен: таблица под column-whitelist) ────────────────────────
GRANT SELECT (ai_help_events, best_earned_score)
  ON public.homework_tutor_task_states
  TO authenticated;

-- ─── Бэкфилл ────────────────────────────────────────────────────────────────
-- 1. `best_earned_score = earned_score` там, где балл уже есть. Безопасно:
--    цепочка computeFinalScore ставит best_earned_score ПЕРЕД earned_score, и
--    при равных значениях итог не меняется ни у одной существующей работы.
UPDATE public.homework_tutor_task_states
   SET best_earned_score = earned_score
 WHERE earned_score IS NOT NULL
   AND best_earned_score IS NULL;

-- 2. `ai_help_events = 0` — ТОЛЬКО честный клин: задача решена без подсказок,
--    без неверных попыток и не более одной попытки. Всё остальное остаётся
--    NULL: восстановить историю обращений из логов нельзя, а догадка испортила
--    бы первую же метрику, которую увидит репетитор.
--
--    ⚠️ `tutor_force_completed_at IS NULL` (фикс 2026-07-25, найден на проде
--    после первого прогона): задача, закрытая репетитором вручную без единой
--    попытки ученика, проходила по `attempts <= 1` и получала 0 → «100%
--    самостоятельно» за работу, которую ученик даже не открывал, плюс
--    завышение средневзвешенного агрегата. Такие строки обязаны остаться NULL
--    («—»). На проде 39 строк исправлены отдельным UPDATE.
UPDATE public.homework_tutor_task_states
   SET ai_help_events = 0
 WHERE ai_help_events IS NULL
   AND COALESCE(hint_count, 0) = 0
   AND COALESCE(wrong_answer_count, 0) = 0
   AND COALESCE(attempts, 0) <= 1
   AND tutor_force_completed_at IS NULL;

-- ─── Инкремент счётчика ─────────────────────────────────────────────────────
-- Отдельная RPC вместо read-modify-write из edge: два AI-пути могут писать
-- одновременно (подсказка + ответ в обсуждении), а `UPDATE ... = col + 1`
-- атомарен на уровне строки. `COALESCE(...,0)` материализует NULL в 0 при
-- первом же обращении — то есть «нет данных» превращается в «есть данные»
-- ровно тогда, когда мы впервые что-то посчитали.
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

  RETURN v_new; -- NULL = строки нет (вызыватель трактует как no-op)
END;
$$;

-- rule 99: REVOKE FROM PUBLIC не снимает EXECUTE с anon/authenticated —
-- Supabase грантит им напрямую. Отзываем явно, оставляем только service_role
-- (счётчик пишет ТОЛЬКО edge homework-api; клиент не должен уметь «обнулить
-- себе помощь AI»).
REVOKE ALL ON FUNCTION public.hw_bump_ai_help_events(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hw_bump_ai_help_events(uuid, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hw_bump_ai_help_events(uuid, integer) TO service_role;

COMMENT ON FUNCTION public.hw_bump_ai_help_events(uuid, integer) IS
  'Атомарный инкремент homework_tutor_task_states.ai_help_events (метрика «% самостоятельности»). service_role-only: вызывается из homework-api в 3 точках (разбор ошибки ON_TRACK/INCORRECT, подсказка, ответ AI в обсуждении). NULL в ответе = задачи нет.';
