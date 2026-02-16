

## Исправление: "Failed to create assignment" — нарушение foreign key

### Корневая причина

Таблица `homework_tutor_assignments` имеет foreign key:
```
tutor_id -> auth.users(id)
```

Это означает, что `tutor_id` должен быть **auth user ID** (UUID пользователя из `auth.users`), а НЕ ID записи из таблицы `tutors`.

Предыдущий фикс ошибочно заменил `userId` на `tutor.id` во всех обработчиках. В результате при INSERT записывается ID из таблицы `tutors`, который не существует в `auth.users` -- отсюда ошибка FK constraint.

RLS-политики подтверждают это:
- `HW tutor assignments insert own`: `tutor_id = auth.uid()`
- `HW tutor assignments select own`: `tutor_id = auth.uid()`

### Решение

В главном обработчике (`Deno.serve`) заменить `tutor.id` обратно на `userId` во всех вызовах handler-функций. `getTutorOrThrow` остаётся как проверка авторизации (что пользователь -- репетитор), но его результат не используется как `tutor_id`.

### Изменения

**Файл: `supabase/functions/homework-api/index.ts`** (строки 1223-1264)

Заменить все `tutor.id` на `userId`:

```
handleCreateAssignment(db, userId, body, cors)
handleListAssignments(db, userId, route.searchParams, cors)
handleGetAssignment(db, userId, seg[1], cors)
handleUpdateAssignment(db, userId, seg[1], body, cors)
handleAssignStudents(db, userId, userId, seg[1], body, cors)
handleNotifyStudents(db, userId, seg[1], body, cors)
handleGetResults(db, userId, seg[1], cors)
handleReviewSubmission(db, userId, seg[1], body, cors)
```

После изменения -- задеплоить `homework-api`.

### Почему так

- `getTutorOrThrow` -- проверка, что auth user является репетитором (есть запись в `tutors`)
- Но сам `tutor_id` в таблицах домашек ссылается на `auth.users(id)`, поэтому нужно использовать auth user ID

