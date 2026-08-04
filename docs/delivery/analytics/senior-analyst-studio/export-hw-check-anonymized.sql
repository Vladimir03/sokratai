-- ============================================================================
-- Обезличенная выгрузка проверок ДЗ для аналитики (Катя-Дубай) · v3 (2026-08-04)
-- ============================================================================
-- ГДЕ запускать: SQL-редактор Lovable (проект sokratai) → Run → «Export CSV».
-- ЧТО даёт: одна строка = (ученик × задача); поля проверки + контекст + производные.
--
-- ВАЖНО (прочитать перед запуском):
--   1) СОЛЬ ('CHANGE_ME__HW_EXPORT_SALT_2026') держать ПОСТОЯННОЙ между выгрузками —
--      иначе хеши не совпадут с прошлым файлом аналитика и с телеметрией.
--   2) Сырые UUID наружу НЕ идут — только стабильные хеши (stu_/tut_/asg_/tsk_/ts_).
--   3) Свободный текст (ai_score_comment, tutor_score_override_comment, ai_criteria_json,
--      ai_nodes_json) включён КАК ЕСТЬ (решение владельца; данные под NDA).
--   4) ГРЕЙН: одна строка = (ученик × задача). Ключ строки = task_state_id, НЕ task_id
--      (task_id — сама задача ДЗ, общая для учеников → повторяется у разных учеников).
--   5) БАЗА для метрик качества: доли считать на `ai_score IS NOT NULL` (реально оценённые AI).
--      Все строки включают выданные-но-нерешённые задачи → без фильтра знаменатель занижает доли.
--   6) Это РЕТРОСПЕКТИВНЫЙ слой (баллы/правки), за весь период. Вердикт/уверенность/тип ошибки —
--      в телеметрии hw_ai_check_events (см. telemetry-hw-ai-check-events.md).
--
-- ИЗМЕНЕНИЯ v3 (сверено с ЖИВОЙ схемой прода 2026-08-04):
--   • ИСПРАВЛЕН final_score: цепочка стала override → best_earned_score → earned_score → ai_score
--     (колонка best_earned_score, миграция 20260725140000). В v2 формула БЕЗ best_earned_score
--     давала заниженный балл там, где лучшая попытка была не последней.
--   • + best_earned_score, ai_help_events (метрика «% самостоятельности»; NULL = неизвестно,
--     намеренно НЕ 0 — до релиза 25.07 и у массово закрытых задач истории обращений нет).
--   • + work_mode (вид работы: homework / independent) — уровень ДЗ.
--   • + is_structured_choice: задача со структурным выбором (options_json). У них балл считает
--     КОД, а не суждение AI → при оценке качества AI такие строки исключать (сейчас их единицы).
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
  'tsk_' || substr(md5(ts.task_id::text    || p.salt), 1, 10) as task_id,         -- ПОВТОРЯЕТСЯ
  -- ── контекст (стратификация) ─────────────────────────────────────────────
  a.subject, a.exam_type, a.work_mode,
  t.check_format, t.task_kind, t.kim_number, t.cefr_level, t.max_score,
  (t.options_json is not null) as is_structured_choice,   -- балл считает КОД, не AI
  -- ── прогресс / усилия ────────────────────────────────────────────────────
  ts.status, ts.attempts, ts.wrong_answer_count, ts.hint_count,
  ts.ai_help_events,                                       -- обращений к AI (NULL = неизвестно)
  -- ── оценка AI ────────────────────────────────────────────────────────────
  ts.ai_score, ts.ai_score_comment,
  ts.ai_criteria_json,                                     -- покритериально (ТОЛЬКО языки)
  ts.ai_nodes_json,                                        -- трасса блок-схемы (физика Ч2)
  -- ── баллы ────────────────────────────────────────────────────────────────
  ts.earned_score, ts.best_earned_score, ts.available_score,
  coalesce(ts.tutor_score_override, ts.best_earned_score,
           ts.earned_score, ts.ai_score) as final_score,   -- итог (цепочка продукта)
  -- ── правки репетитора ────────────────────────────────────────────────────
  ts.tutor_score_override, ts.tutor_score_override_comment, ts.tutor_score_override_at,
  ts.tutor_reviewed_at, ts.tutor_force_completed_at,
  case when ts.tutor_score_override is not null and ts.ai_score is not null
       then ts.tutor_score_override - ts.ai_score end as override_delta,  -- знак = F1/F2
  -- ── активность / время ───────────────────────────────────────────────────
  ts.student_opened_at, ts.created_at, ts.updated_at
from homework_tutor_task_states ts
  join homework_tutor_tasks               t  on t.id  = ts.task_id
  join homework_tutor_threads             th on th.id = ts.thread_id
  join homework_tutor_student_assignments sa on sa.id = th.student_assignment_id
  join homework_tutor_assignments         a  on a.id  = sa.assignment_id
  cross join params p
order by ts.created_at;

-- ----- Контроль знаменателей (по желанию) -----------------------------------
-- select count(*) all_rows,
--   count(*) filter (where ai_score is not null)             ai_graded,
--   count(*) filter (where status='completed')               completed,
--   count(*) filter (where tutor_reviewed_at is not null)    reviewed,
--   count(*) filter (where tutor_score_override is not null) overridden
-- from homework_tutor_task_states;
-- Факт на 2026-08-04: 6226 / 2526 / 2426 / 1162 / 97.
