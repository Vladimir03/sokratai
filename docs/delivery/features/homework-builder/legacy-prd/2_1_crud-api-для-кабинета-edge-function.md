## 2.1 CRUD API для кабинета (Edge Function)
**Цель**: дать кабинету (Lovable) безопасный API для управления домашками, назначения учеников, просмотра результатов и tutor review.

### In‑scope
Файл: `supabase/functions/homework-api/index.ts`

### Эндпоинты
**Auth**: JWT (Supabase) + проверка роли tutor (или доступ через ownership assignment).
**CORS**: разрешить origin кабинета.

1) `POST /assignments`
- body: `{ title, subject, topic?, description?, deadline?, tasks:[{order_num?, task_text, task_image_url?, correct_answer?, solution_steps?, max_score?}] }`
- response: `{ assignment_id }`

2) `GET /assignments?status=active|closed|draft|all`
- response: `[{id,title,subject,deadline,status,submitted_count,assigned_count,avg_score}]`

3) `GET /assignments/:id`
- response: `{ assignment, tasks, assigned_students:[{student_id, name?, notified, notified_at}], submissions_summary? }`

4) `PUT /assignments/:id`
- body: patch полей assignment + (опционально) upsert tasks

5) `POST /assignments/:id/assign`
- body: `{ student_ids: string[] }`
- response: `{ added: number }`

6) `POST /assignments/:id/notify`
- body: `{ message_template? }`
- action: отправить ученикам push в TG (через существующий telegram sender)
- response: `{ sent: number, failed: number }`

7) `GET /assignments/:id/results`
- response: `{ summary:{avg_score, distribution, common_error_types}, per_student:[...], per_task:[...] }`

8) `POST /submissions/:id/review`
- body: `{ items:[{task_id, tutor_override_correct, tutor_comment, tutor_score?}], status?:'tutor_reviewed' }`
- response: `{ ok:true }`

### Нефункциональные требования
- Все endpoints — idempotent где возможно.
- Валидация входа (zod/valibot/ручная).
- Ошибки: 400 (bad input), 401/403, 404, 500.

### Приёмка
- Tutor может создать домашку и увидеть её в списке.
- Tutor может назначить учеников, увидеть прогресс сдачи.
- Tutor может открыть submission и скорректировать оценку.

### Инструкция для Codex/Claude
Реализуй `homework-api` с router’ом (минимальный), валидацией, проверкой ownership. Документируй контракт ответов в комментариях и добавь `supabase/functions/homework-api/README.md`.

---
