

## Исправление "Some student_ids are not your students"

### Корневая причина

В базе данных две таблицы используют разные ID для идентификации репетитора:
- `homework_tutor_assignments.tutor_id` -> `auth.users(id)` (auth user ID)
- `tutor_students.tutor_id` -> `tutors(id)` (ID записи в таблице tutors)

Функция `handleAssignStudents` получает `userId` (auth ID) и использует его для обоих запросов. Проверка владения студентами на строке 716 ищет `tutor_students.tutor_id = auth_user_id`, но в таблице хранится `tutors.id` -- поэтому находит 0 записей.

### Данные из базы

- Auth user ID: `420b1476-6988-4f00-b435-09400420d145`
- Tutors table ID: `70ff3df8-f081-4ed1-83bb-4d1a1f80f795`
- Оба студента (Lera и Иван) привязаны к `tutor_id = 70ff3df8-...`

### Решение

В `handleAssignStudents` нужно использовать **два разных ID**:
- `tutorUserId` (auth ID) -- для проверки владения assignment (таблица `homework_tutor_assignments`)
- `tutorId` (ID из таблицы `tutors`) -- для проверки владения студентами (таблица `tutor_students`)

Сигнатура функции уже принимает оба параметра (`tutorUserId` и `tutorId`), но на строке 716 используется `tutorId`, который сейчас тоже равен `userId`.

### Изменения

**Файл: `supabase/functions/homework-api/index.ts`**

1. В главном обработчике (строка 1247): изменить вызов, чтобы передавать `tutor.id` как второй параметр:
   ```
   // Было:
   handleAssignStudents(db, userId, userId, seg[1], body, cors)
   // Станет:
   handleAssignStudents(db, userId, tutor.id, seg[1], body, cors)
   ```

2. Задеплоить `homework-api`

### Почему только этот handler

Остальные handler-ы работают только с `homework_tutor_assignments`, где `tutor_id = auth user ID` -- там всё корректно. Только `handleAssignStudents` обращается и к `homework_tutor_assignments`, и к `tutor_students` -- поэтому ему нужны оба ID.

### Lera без Telegram

Это **не проблема** для назначения ДЗ. Отсутствие Telegram аккаунта влияет только на отправку уведомлений (которые и так выключены на скриншоте). Назначить ДЗ можно любому студенту.
