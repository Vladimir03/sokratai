# SQL-запросы для AI-метрик (запустить через Lovable Cloud → Supabase SQL Editor)

Запросы привязаны к актуальной схеме (см. `.claude/rules/40-homework-system.md`). Все таблицы — `homework_tutor_*` (текущая система ДЗ через guided chat).

---

## 1. AI-вызовы за всё время (для слайда «Traction»)

Считаем все «значимые» AI-сообщения от модели в guided chat: вступления, проверки, подсказки, диалог.

```sql
SELECT
  COUNT(*) FILTER (WHERE message_kind = 'system')        AS ai_intros,        -- AI bootstrap intro к задаче
  COUNT(*) FILTER (WHERE message_kind = 'check_result')  AS ai_check_results, -- AI разборы решения
  COUNT(*) FILTER (WHERE message_kind = 'hint_reply')    AS ai_hints,         -- AI подсказки
  COUNT(*) FILTER (WHERE message_kind = 'ai_reply')      AS ai_dialogue,      -- AI ответы в обсуждении
  COUNT(*) FILTER (WHERE role IN ('assistant','system')) AS ai_total
FROM public.homework_tutor_thread_messages
WHERE role IN ('assistant','system');
```

## 2. AI-вызовы за последние 30 дней

```sql
SELECT
  COUNT(*) FILTER (WHERE message_kind = 'check_result')  AS checks_30d,
  COUNT(*) FILTER (WHERE message_kind = 'hint_reply')    AS hints_30d,
  COUNT(*) FILTER (WHERE message_kind IN ('ai_reply','system')) AS other_ai_30d,
  COUNT(*)                                                AS ai_total_30d
FROM public.homework_tutor_thread_messages
WHERE role IN ('assistant','system')
  AND created_at >= now() - interval '30 days';
```

## 3. Активные ученики (DAU/WAU/MAU)

«Активный» = присылал сообщение в guided chat в окне.

```sql
SELECT
  COUNT(DISTINCT sa.student_id) FILTER (WHERE m.created_at >= now() - interval '1 day')   AS dau,
  COUNT(DISTINCT sa.student_id) FILTER (WHERE m.created_at >= now() - interval '7 days')  AS wau,
  COUNT(DISTINCT sa.student_id) FILTER (WHERE m.created_at >= now() - interval '30 days') AS mau,
  COUNT(DISTINCT sa.student_id)                                                            AS students_total
FROM public.homework_tutor_thread_messages m
JOIN public.homework_tutor_threads t  ON t.id = m.thread_id
JOIN public.homework_tutor_student_assignments sa ON sa.id = t.student_assignment_id
WHERE m.role = 'user';
```

## 4. Решённых задач (completed task_states)

```sql
SELECT
  COUNT(*) FILTER (WHERE status = 'completed') AS tasks_completed,
  COUNT(*) FILTER (WHERE status = 'active' AND attempts > 0) AS tasks_in_progress,
  ROUND(AVG(earned_score / NULLIF(ts.max_score::numeric, 0))::numeric, 2) AS avg_score_ratio
FROM public.homework_tutor_task_states ts;
```

## 5. Топ-репетиторы по объёму AI-нагрузки (engagement proof)

```sql
SELECT
  p.username           AS tutor_username,
  COUNT(DISTINCT a.id) AS assignments_created,
  COUNT(DISTINCT sa.student_id) AS unique_students,
  COUNT(m.id) FILTER (WHERE m.role IN ('assistant','system')) AS ai_messages_total
FROM public.homework_tutor_assignments a
JOIN public.profiles p ON p.id = a.tutor_id
LEFT JOIN public.homework_tutor_student_assignments sa ON sa.assignment_id = a.id
LEFT JOIN public.homework_tutor_threads t ON t.student_assignment_id = sa.id
LEFT JOIN public.homework_tutor_thread_messages m ON m.thread_id = t.id
GROUP BY p.username
ORDER BY ai_messages_total DESC NULLS LAST
LIMIT 10;
```

## 6. Темп роста по неделям (для timeline на слайде)

```sql
SELECT
  DATE_TRUNC('week', m.created_at)::date AS week_start,
  COUNT(*) FILTER (WHERE m.role IN ('assistant','system')) AS ai_messages,
  COUNT(DISTINCT sa.student_id) AS active_students,
  COUNT(DISTINCT t.id) AS active_threads
FROM public.homework_tutor_thread_messages m
JOIN public.homework_tutor_threads t  ON t.id = m.thread_id
JOIN public.homework_tutor_student_assignments sa ON sa.id = t.student_assignment_id
WHERE m.created_at >= now() - interval '90 days'
GROUP BY 1
ORDER BY 1;
```

## 7. Платящие подписки (для MRR-картинки)

```sql
SELECT
  COUNT(*) FILTER (WHERE subscription_tier = 'premium' AND subscription_expires_at > now()) AS premium_active,
  COUNT(*) FILTER (WHERE trial_ends_at > now())                                              AS trial_active
FROM public.profiles;
```

---

## Что подставить в дек

После прогона запросов в Lovable, замени в `02-sokrat-ai-pitch.pptx` следующие placeholder'ы:

| Slide | Placeholder | Источник запроса |
|---|---|---|
| 5 (Traction) | `AI-сообщений всего: ~XX,XXX` | Q1, поле `ai_total` |
| 5 (Traction) | `AI-вызовов / 30 дней: ~X,XXX` | Q2, поле `ai_total_30d` |
| 5 (Traction) | `Решено задач: XXX` | Q4, поле `tasks_completed` |

Если время — мини-график (Q6) можно вставить как картинку на слайд 5.
