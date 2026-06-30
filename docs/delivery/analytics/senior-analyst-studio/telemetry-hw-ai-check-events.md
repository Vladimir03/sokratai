# Телеметрия проверок ДЗ — таблица `hw_ai_check_events` (для Кати-Дубай)

Это **слой B** (вердикт/уверенность/тип ошибки/причина сбоя), которого нет в ретроспективе
(`homework_tutor_task_states` его не хранит). Таблица **копит данные вперёд** с момента деплоя —
ретроспективы по ней нет (как Катя и ожидала: «включить логирование на период»).

- **Миграция:** `supabase/migrations/20260630120000_hw_ai_check_events.sql`.
- **Пишет:** edge-функция `homework-api` под `service_role` (best-effort — сбой записи телеметрии
  никогда не ломает проверку ДЗ).
- **Доступ:** только `service_role`. RLS включён без policy → ученики/репетиторы видят 0 строк.
- **PII-free by design:** никакого свободного текста (ни фидбэка, ни комментариев) — только
  категориальный исход, баллы, флаги, id. Сырые id обезличиваются **на экспорте** (как в
  `export-hw-check-anonymized.sql`).
- **Когда заработает:** после того как Lovable применит миграцию + передеплоит `homework-api`
  (на синк main; **не** `deploy-sokratai` — фронт не затронут). Данные нужны через 2–4 недели — окно
  сбора совпадает.

## Два типа событий

| `event_type` | Когда пишется | Ключевые поля |
|---|---|---|
| `check_completed` | каждая AI-проверка ответа (`runStudentAnswerGrading`) | `verdict`, `confidence`, `error_type`, `failure_reason`, `ai_score`, + контекст (subject/check_format/task_kind/kim_number/max_score) |
| `tutor_correction` | репетитор правит/закрывает задачу (`handleSetTutorScoreOverride`: override / reset / reopen / force_complete) | `correction_kind`, `tutor_score_override`, `ai_score_at_correction`, `override_delta` |

Связь событий: оба несут `task_state_id` + `task_id` + `student_id` (raw, внутренние) → можно
соединить «как AI оценил» с «как репетитор поправил».

## Схема (колонки)

`id, event_type, occurred_at` · identity: `student_id, tutor_id, assignment_id, task_id,
task_state_id` · контекст: `subject, check_format, task_kind, kim_number, max_score` ·
check_completed: `verdict, confidence, error_type, failure_reason, ai_score` (+ зарезервированы
`latency_ms, fast_path, leak_retry, leak_scrubbed, image_missing`) · tutor_correction:
`correction_kind, tutor_score_override, ai_score_at_correction, override_delta` · `meta jsonb`.

> ⚠ `verdict` здесь = **применённый** вердикт (после low-confidence-даунгрейда CORRECT→ON_TRACK).
> Сырой вердикт модели, если отличался, лежит в `meta.raw_verdict`.

## Примеры запросов (когда накопятся данные)

```sql
-- 1) Распределение вердиктов
select verdict, count(*)
from hw_ai_check_events
where event_type = 'check_completed'
group by 1 order by 2 desc;

-- 2) Error-rate по типам ошибок
select error_type, count(*)
from hw_ai_check_events
where event_type = 'check_completed'
group by 1 order by 2 desc;

-- 3) Причины сбоев проверки (CHECK_FAILED)
select failure_reason, count(*)
from hw_ai_check_events
where event_type = 'check_completed' and verdict = 'CHECK_FAILED'
group by 1 order by 2 desc;

-- 4) Правки репетитора → F1/F2 (ложно-«верно» / ложно-«ошибка»)
select case
         when override_delta < 0 then 'F1 false-accept'
         when override_delta > 0 then 'F2 false-reject'
         else 'equal'
       end as kind,
       count(*)
from hw_ai_check_events
where event_type = 'tutor_correction' and override_delta is not null
group by 1 order by 2 desc;

-- 5) Связка: какой вердикт AI чаще приводит к правке репетитора
select c.verdict, count(distinct t.task_state_id) as corrected
from hw_ai_check_events c
join hw_ai_check_events t
  on t.task_state_id = c.task_state_id and t.event_type = 'tutor_correction'
where c.event_type = 'check_completed'
group by 1 order by 2 desc;
```

## Экспорт для аналитики

Когда понадобится отдать Кате — обезличить так же, как в `export-hw-check-anonymized.sql`
(хешировать `student_id`/`tutor_id`/`task_id`/`task_state_id` той же солью → стабильная связка с
ретроспективной выгрузкой по `student_anon`/`task_id`). Сырые id наружу не отдавать.
