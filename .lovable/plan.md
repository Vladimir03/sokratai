

## Исправление ошибки загрузки фото (42P17 — бесконечная рекурсия RLS)

### Проблема

При загрузке фото в `homework-task-images` Postgres возвращает ошибку `42P17` (infinite recursion). Причина: Postgres проверяет ВСЕ INSERT-политики на таблице `storage.objects`, включая политику для другого bucket (`homework-images`), которая обращается к `homework_tutor_assignments`. Далее возникает циклическая зависимость:

```text
storage.objects INSERT
  -> homework_tutor_assignments SELECT (RLS)
    -> homework_tutor_student_assignments SELECT (RLS)
      -> homework_tutor_assignments SELECT (RLS)  -- рекурсия!
```

### Решение

Разорвать рекурсию с помощью `SECURITY DEFINER` функций, которые обходят RLS.

**Шаг 1: Создать две security definer функции**

- `is_assignment_tutor(_assignment_id uuid)` -- проверяет, является ли `auth.uid()` владельцем задания (tutor_id)
- `is_assignment_student(_assignment_id uuid)` -- проверяет, назначен ли `auth.uid()` как студент на задание

**Шаг 2: Обновить RLS-политики `homework_tutor_student_assignments`**

Заменить подзапрос `EXISTS (SELECT 1 FROM homework_tutor_assignments ...)` на вызов `is_assignment_tutor(assignment_id)`.

**Шаг 3: Обновить RLS-политики `homework_tutor_assignments`**

Заменить подзапрос `EXISTS (SELECT 1 FROM homework_tutor_student_assignments ...)` на вызов `is_assignment_student(id)`.

**Шаг 4: Обновить storage-политики `homework-images`**

Заменить подзапросы с JOIN через `homework_tutor_assignments` на вызовы security definer функций.

### Миграция SQL (одна транзакция)

```sql
-- 1. Создать security definer функции
CREATE OR REPLACE FUNCTION public.is_assignment_tutor(_assignment_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM homework_tutor_assignments
    WHERE id = _assignment_id AND tutor_id = auth.uid()
  )
$$;

CREATE OR REPLACE FUNCTION public.is_assignment_student(_assignment_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM homework_tutor_student_assignments
    WHERE assignment_id = _assignment_id AND student_id = auth.uid()
  )
$$;

-- 2. Пересоздать политики homework_tutor_assignments (без подзапроса к student_assignments)
DROP POLICY IF EXISTS "HW students select assigned assignments" ON homework_tutor_assignments;
CREATE POLICY "HW students select assigned assignments"
ON homework_tutor_assignments FOR SELECT
USING (
  status IN ('active','closed')
  AND is_assignment_student(id)
);

-- 3. Пересоздать политики homework_tutor_student_assignments (без подзапроса к assignments)
DROP POLICY IF EXISTS "HW tutor student assignments select by owner" ON homework_tutor_student_assignments;
CREATE POLICY "HW tutor student assignments select by owner"
ON homework_tutor_student_assignments FOR SELECT
USING (is_assignment_tutor(assignment_id) AND is_tutor_of_student(student_id));

DROP POLICY IF EXISTS "HW tutor student assignments insert by owner" ON homework_tutor_student_assignments;
CREATE POLICY "HW tutor student assignments insert by owner"
ON homework_tutor_student_assignments FOR INSERT
WITH CHECK (is_assignment_tutor(assignment_id) AND is_tutor_of_student(student_id));

DROP POLICY IF EXISTS "HW tutor student assignments delete by owner" ON homework_tutor_student_assignments;
CREATE POLICY "HW tutor student assignments delete by owner"
ON homework_tutor_student_assignments FOR DELETE
USING (is_assignment_tutor(assignment_id) AND is_tutor_of_student(student_id));

-- 4. Пересоздать storage-политики homework-images (без рекурсивных JOIN)
-- (аналогично заменить подзапросы на вызовы security definer функций)
```

### Результат

- Загрузка фото в `homework-task-images` будет работать без ошибок
- Все остальные RLS-политики сохранят свою логику доступа
- Никаких изменений в frontend коде не требуется
