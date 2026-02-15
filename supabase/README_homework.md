# Homework Tutor DB (Sprint 1.1)

Этот документ описывает новую подсистему ДЗ для Telegram-режима "Домашка".

## Почему `homework_tutor_*`

В проекте уже существуют legacy-таблицы `homework_sets`, `homework_tasks`, `homework_chat_messages`.
Чтобы не ломать текущий функционал, новая схема вынесена в отдельный namespace по именам:

- `homework_tutor_assignments`
- `homework_tutor_tasks`
- `homework_tutor_submissions`
- `homework_tutor_submission_items`
- `homework_tutor_student_assignments`
- `homework_tutor_user_bot_state`

## Таблицы и назначение

1. `homework_tutor_assignments`
- Домашка, созданная репетитором.
- Ключевые поля: `tutor_id`, `subject`, `status`, `deadline`.
- `status`: `draft | active | closed`.

2. `homework_tutor_tasks`
- Задачи внутри домашки.
- Ключевые поля: `assignment_id`, `order_num`, `task_text`, `max_score`.
- Уникальность: `(assignment_id, order_num)`.

3. `homework_tutor_submissions`
- Сдача домашки конкретным учеником.
- Ключевые поля: `assignment_id`, `student_id`, `telegram_chat_id`, `status`.
- `status`: `in_progress | submitted | ai_checked | tutor_reviewed`.
- Уникальность: `(assignment_id, student_id)`.

4. `homework_tutor_submission_items`
- Ответ ученика по одной задаче.
- Ключевые поля: `submission_id`, `task_id`, `student_image_urls`, `recognized_text`, AI-поля.
- Ограничение на фото: до 4 ссылок.
- Уникальность: `(submission_id, task_id)`.

5. `homework_tutor_student_assignments`
- Факт назначения ДЗ ученику.
- Ключевые поля: `assignment_id`, `student_id`, `notified`.
- Уникальность: `(assignment_id, student_id)`.

6. `homework_tutor_user_bot_state`
- Состояние state machine бота для пользователя.
- Ключевые поля: `user_id`, `state`, `context`.
- `state`: `IDLE | HW_SELECTING | HW_SUBMITTING | HW_CONFIRMING | HW_REVIEW`.

## Индексы

Минимальные индексы из PRD добавлены:

- `homework_tutor_assignments(tutor_id, status, deadline)`
- `homework_tutor_tasks(assignment_id, order_num)`
- `homework_tutor_student_assignments(student_id, assignment_id)`
- `homework_tutor_submissions(assignment_id, student_id, status)`
- `homework_tutor_submission_items(submission_id, task_id)`

## RLS матрица доступа

Все таблицы `homework_tutor_*` работают с включённым RLS.

### Tutor

- `homework_tutor_assignments`: `select/insert/update/delete` только где `tutor_id = auth.uid()`.
- `homework_tutor_tasks`: `select/insert/update/delete` через владение assignment.
- `homework_tutor_student_assignments`: `select/insert/delete` по своим assignment и только для своих учеников (`public.is_tutor_of_student`).
- `homework_tutor_submissions`: `select/update` по своим assignment.
- `homework_tutor_submission_items`: `select/update` по submission своих assignment.

### Student

- `homework_tutor_assignments`: `select` только назначенные ему и только `active/closed`.
- `homework_tutor_tasks`: `select` только из назначенных `active/closed` assignment.
- `homework_tutor_student_assignments`: `select` только свои связи.
- `homework_tutor_submissions`: `insert/select/update` только свои; update разрешён только из `in_progress` в `in_progress|submitted`.
- `homework_tutor_submission_items`: `insert/select/update` только по своим submission, пока submission в `in_progress`.
- `homework_tutor_user_bot_state`: `select/insert/update` только свой `user_id`.

## Storage

- Bucket: `homework-images` (private).
- Path convention:
  `homework/{assignment_id}/{submission_id}/{task_id}/{uuid}.jpg`

### Политики `storage.objects` для `homework-images`

- Upload/Update/Delete:
  только `owner = auth.uid()` и только если путь согласован с таблицами `homework_tutor_*`, где пользователь является `student_id`.
- Read:
  разрешён owner (ученик) и репетитору assignment (`assignment.tutor_id = auth.uid()`), при валидном пути.

## Вне scope этой задачи

- Изменения frontend/edge functions.
- Обновление `src/integrations/supabase/types.ts`.
- Миграция/удаление legacy `homework_*` таблиц.
