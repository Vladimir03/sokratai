-- ============================================================================
-- Обезличенная выгрузка проверок ДЗ для аналитики (проект Катя-Дубай)
-- ============================================================================
-- ГДЕ запускать: SQL-редактор Lovable Cloud / Supabase (выполняется под service_role).
-- ЧТО даёт: одна строка = (ученик × задача); все поля проверки + контекст для интерпретации.
-- ВЫГРУЗКА: выполни основной SELECT → кнопка «Download CSV». Для JSON — см. блок Б внизу.
--
-- ВАЖНО (прочитать перед запуском):
--   1) Поменяй СОЛЬ ниже ('CHANGE_ME__HW_EXPORT_SALT_2026') на свой секрет. Держи её постоянной
--      между выгрузками — тогда stu_/tut_/… хеши стабильны и сопоставимы между выгрузками.
--   2) Сырые UUID наружу НЕ идут — только стабильные хеши (stu_/tut_/asg_/tsk_/ts_).
--   3) Свободный текст (ai_score_comment, tutor_score_override_comment, комментарии в
--      ai_criteria_json) включён КАК ЕСТЬ (решение владельца; данные под NDA). Теоретически может
--      содержать имя ученика → передавать только по защищённому каналу под NDA.
--   4) Это РЕТРОСПЕКТИВНЫЙ слой (баллы/правки) — он есть в БД уже сейчас, за весь период.
--      Вердикт/уверенность/тип ошибки/причина сбоя сюда НЕ входят (они только в телеметрии,
--      которая копит данные вперёд — отдельная таблица hw_ai_check_events).
--   5) ГРЕЙН: одна строка = (ученик × задача). Ключ строки = task_state_id, НЕ task_id
--      (task_id — сама задача ДЗ, общая для учеников → повторяется в строках разных учеников).
--   6) БАЗА для метрик качества: считай доли на `ts.ai_score IS NOT NULL` (реально оценённые AI).
--      Без фильтра знаменатель включает выданные-но-нерешённые задачи и занижает доли
--      (напр. review coverage = 656/1734 = 38%, а не 656/4882 = 14%).
-- ============================================================================

-- ----- БЛОК А. Основной запрос (для CSV) -----------------------------------
with params as (
  select 'CHANGE_ME__HW_EXPORT_SALT_2026'::text as salt
)
select
  'ts_'  || substr(md5(ts.id::text        || p.salt), 1, 10) as task_state_id,   -- ключ строки проверки
  'stu_' || substr(md5(sa.student_id::text || p.salt), 1, 10) as student_anon,    -- обезличенный ученик
  'tut_' || substr(md5(a.tutor_id::text   || p.salt), 1, 10) as tutor_anon,       -- обезличенный репетитор
  'asg_' || substr(md5(a.id::text         || p.salt), 1, 10) as assignment_anon,  -- ДЗ (группировка задач)
  'tsk_' || substr(md5(ts.task_id::text   || p.salt), 1, 10) as task_id,          -- задача
  a.subject,                                                                       -- предмет (стратификация)
  t.check_format,                                                                  -- short_answer/detailed_solution
  t.task_kind,                                                                     -- numeric/extended/proof/speaking
  t.kim_number,                                                                    -- № КИМ ФИПИ (если задан)
  t.max_score,                                                                     -- макс балл задачи
  ts.status,                                                                       -- locked/active/completed/skipped
  ts.attempts,
  ts.wrong_answer_count,
  ts.hint_count,
  ts.ai_score,                                                                     -- балл Gemini (шаг 0.5)
  ts.ai_score_comment,                                                             -- обоснование AI (как есть)
  ts.ai_criteria_json,                                                             -- покритериально (только языки)
  ts.earned_score,
  ts.available_score,
  ts.tutor_score_override,                                                         -- ручной балл репетитора
  ts.tutor_score_override_comment,                                                 -- комментарий репетитора (как есть)
  ts.tutor_score_override_at,
  ts.tutor_reviewed_at,                                                            -- подтверждено
  ts.tutor_force_completed_at,                                                     -- закрыто вручную
  ts.student_opened_at,                                                            -- открыл условие
  -- производное: знак = ошибка AI (см. скоркарту F1/F2)
  case
    when ts.tutor_score_override is not null and ts.ai_score is not null
    then ts.tutor_score_override - ts.ai_score
  end as override_delta,
  ts.created_at,
  ts.updated_at
from homework_tutor_task_states ts
  join homework_tutor_tasks               t  on t.id  = ts.task_id
  join homework_tutor_threads             th on th.id = ts.thread_id
  join homework_tutor_student_assignments sa on sa.id = th.student_assignment_id
  join homework_tutor_assignments         a  on a.id  = sa.assignment_id
  cross join params p
-- весь период; чтобы ограничить окно — раскомментируй строку ниже:
-- where ts.created_at >= now() - interval '90 days'
order by ts.created_at;

-- ----- БЛОК Б. JSON-вариант (одним массивом, опционально) -------------------
-- Если нужен JSON, а не CSV: оберни ВЕСЬ блок А (без финальной «;») в:
--
-- with params as (select 'CHANGE_ME__HW_EXPORT_SALT_2026'::text as salt)
-- select json_agg(x) from (
--   select ... (весь SELECT из блока А) ...
--   from homework_tutor_task_states ts
--   join ... cross join params p
--   order by ts.created_at
-- ) x;

-- ----- БЛОК В. Быстрая проверка объёма перед выгрузкой ----------------------
-- select count(*) as rows,
--        count(*) filter (where ai_score is not null)               as ai_graded,
--        count(*) filter (where tutor_score_override is not null)    as overridden,
--        count(*) filter (where tutor_reviewed_at is not null)       as reviewed
-- from homework_tutor_task_states;
