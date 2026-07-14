-- ============================================================================
-- Обезличенная выгрузка проверок ДЗ для аналитики (проект Катя-Дубай) · v2 (2026-06-30)
-- ============================================================================
-- ГДЕ запускать: SQL-редактор Lovable Cloud / Supabase (под service_role).
-- ЧТО даёт: одна строка = (ученик × задача); поля проверки + контекст + производные.
-- ВЫГРУЗКА: выполни SELECT ниже → «Export CSV» → отправь файл.
--
-- ВАЖНО (прочитать перед запуском):
--   1) Поменяй СОЛЬ ('CHANGE_ME__HW_EXPORT_SALT_2026') на свой секрет и держи её ПОСТОЯННОЙ
--      между выгрузками — тогда хеши stu_/tut_/… стабильны и сопоставимы (в т.ч. с телеметрией).
--   2) Сырые UUID наружу НЕ идут — только стабильные хеши (stu_/tut_/asg_/tsk_/ts_).
--   3) Свободный текст (ai_score_comment, tutor_score_override_comment, комментарии в
--      ai_criteria_json / ai_nodes_json) включён КАК ЕСТЬ (решение владельца; данные под NDA).
--   4) ГРЕЙН: одна строка = (ученик × задача). Ключ строки = task_state_id, НЕ task_id
--      (task_id — сама задача ДЗ, общая для учеников → повторяется в строках разных учеников).
--   5) БАЗА для метрик качества: доли считать на `ai_score IS NOT NULL` (реально оценённые AI).
--      Все строки включают выданные-но-нерешённые задачи → без фильтра знаменатель занижает доли.
--   6) Это РЕТРОСПЕКТИВНЫЙ слой (баллы/правки). Вердикт/уверенность/тип ошибки/причина сбоя —
--      в телеметрии hw_ai_check_events (копит вперёд), в эту выгрузку НЕ входят.
--   7) v2 (обновление колонок): добавлены exam_type, cefr_level, ai_nodes_json, final_score.
-- ============================================================================

with params as (
  select 'CHANGE_ME__HW_EXPORT_SALT_2026'::text as salt
)
select
  -- ── ключи (обезличенные) ─────────────────────────────────────────────────
  'ts_'  || substr(md5(ts.id::text         || p.salt), 1, 10) as task_state_id,  -- КЛЮЧ строки
  'stu_' || substr(md5(sa.student_id::text || p.salt), 1, 10) as student_anon,
  'tut_' || substr(md5(a.tutor_id::text    || p.salt), 1, 10) as tutor_anon,
  'asg_' || substr(md5(a.id::text          || p.salt), 1, 10) as assignment_anon,
  'tsk_' || substr(md5(ts.task_id::text    || p.salt), 1, 10) as task_id,         -- ПОВТОРЯЕТСЯ (задача общая)
  -- ── контекст задачи (стратификация) ──────────────────────────────────────
  a.subject,                          -- предмет
  a.exam_type,                        -- ege / oge                          [v2]
  t.check_format,                     -- short_answer / detailed_solution
  t.task_kind,                        -- numeric / extended / proof / speaking
  t.kim_number,                       -- № КИМ ФИПИ (если задан)
  t.cefr_level,                       -- уровень языка A2/B1/B2/C1 (языки)   [v2]
  t.max_score,                        -- макс балл задачи
  -- ── прогресс / усилия ────────────────────────────────────────────────────
  ts.status,                          -- locked / active / completed / skipped
  ts.attempts,                        -- число попыток сдачи (>1 = несколько проверок!)
  ts.wrong_answer_count,
  ts.hint_count,
  -- ── оценка AI ────────────────────────────────────────────────────────────
  ts.ai_score,                        -- балл Gemini (шаг 0.5); null = не оценивал
  ts.ai_score_comment,                -- обоснование AI (как есть; tutor-only в проде)
  ts.ai_criteria_json,                -- покритериально (ТОЛЬКО языки; иначе null)
  ts.ai_nodes_json,                   -- трасса блок-схемы (физика Часть 2; иначе null) [v2]
  -- ── итоговые баллы ───────────────────────────────────────────────────────
  ts.earned_score,                    -- после деградации за подсказки/ошибки
  ts.available_score,
  coalesce(ts.tutor_score_override, ts.earned_score, ts.ai_score) as final_score, -- итог; null=не оценено [v2]
  -- ── правки репетитора ────────────────────────────────────────────────────
  ts.tutor_score_override,            -- ручной балл (≠ ai_score = переоценил)
  ts.tutor_score_override_comment,    -- как есть
  ts.tutor_score_override_at,
  ts.tutor_reviewed_at,               -- «проверено» (null = не подтверждено)
  ts.tutor_force_completed_at,        -- закрыто вручную без AI-вердикта
  case when ts.tutor_score_override is not null and ts.ai_score is not null
       then ts.tutor_score_override - ts.ai_score end as override_delta,          -- знак = F1/F2
  -- ── активность / время ───────────────────────────────────────────────────
  ts.student_opened_at,               -- открыл условие
  ts.created_at,
  ts.updated_at
from homework_tutor_task_states ts
  join homework_tutor_tasks               t  on t.id  = ts.task_id
  join homework_tutor_threads             th on th.id = ts.thread_id
  join homework_tutor_student_assignments sa on sa.id = th.student_assignment_id
  join homework_tutor_assignments         a  on a.id  = sa.assignment_id
  cross join params p
-- весь период; чтобы ограничить окно — раскомментируй:
-- where ts.created_at >= now() - interval '90 days'
order by ts.created_at;

-- ----- Быстрая проверка объёма/знаменателей (по желанию) --------------------
-- select
--   count(*)                                                     as all_rows,
--   count(*) filter (where ai_score is not null)                 as ai_graded,
--   count(*) filter (where status='completed')                   as completed,
--   count(*) filter (where tutor_reviewed_at is not null)        as reviewed,
--   count(*) filter (where tutor_score_override is not null)     as overridden
-- from homework_tutor_task_states;

-- ----- JSON вместо CSV (по желанию) -----------------------------------------
-- Оберни весь SELECT (без «;») в:  select json_agg(x) from ( <SELECT> ) x;
