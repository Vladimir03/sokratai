

## План: Создание таблицы tutor_payments

### Проблема
Ошибка возникает потому что таблица `tutor_payments` **не существует** в базе данных. Код в файлах `src/lib/tutors.ts` и `src/types/tutor.ts` ссылается на эту таблицу, но миграция для её создания не была выполнена.

TypeScript показывает ошибки типа:
```
Argument of type '"tutor_payments"' is not assignable to parameter of type '"problems_public"'
```

Это означает, что таблица не найдена в автогенерируемых типах Supabase.

### Решение
Создать таблицу `tutor_payments` через миграцию базы данных.

### SQL-миграция

```sql
-- Создать таблицу для учёта оплат репетитору
CREATE TABLE public.tutor_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_student_id UUID NOT NULL REFERENCES public.tutor_students(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  period TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue')),
  due_date DATE,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Включить RLS
ALTER TABLE public.tutor_payments ENABLE ROW LEVEL SECURITY;

-- RLS-политики (только репетитор-владелец может управлять оплатами своих учеников)
CREATE POLICY "Tutors can view own student payments"
  ON public.tutor_payments FOR SELECT
  USING (owns_tutor_student(tutor_student_id));

CREATE POLICY "Tutors can insert payments for own students"
  ON public.tutor_payments FOR INSERT
  WITH CHECK (owns_tutor_student(tutor_student_id));

CREATE POLICY "Tutors can update own student payments"
  ON public.tutor_payments FOR UPDATE
  USING (owns_tutor_student(tutor_student_id));

CREATE POLICY "Tutors can delete own student payments"
  ON public.tutor_payments FOR DELETE
  USING (owns_tutor_student(tutor_student_id));

-- Триггер для обновления updated_at
CREATE TRIGGER update_tutor_payments_updated_at
  BEFORE UPDATE ON public.tutor_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
```

### Структура таблицы

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID | Первичный ключ |
| tutor_student_id | UUID | Связь с учеником репетитора |
| amount | NUMERIC | Сумма оплаты |
| period | TEXT | Период (например "февраль 2026") |
| status | TEXT | Статус: pending, paid, overdue |
| due_date | DATE | Срок оплаты |
| paid_at | TIMESTAMPTZ | Дата фактической оплаты |
| created_at | TIMESTAMPTZ | Дата создания записи |
| updated_at | TIMESTAMPTZ | Дата обновления |

### Безопасность
- RLS включён
- Используется существующая функция `owns_tutor_student()` для проверки владельца
- Только репетитор может видеть и управлять оплатами своих учеников

### Результат
После выполнения миграции:
- Ошибки сборки исчезнут
- Страница `/tutor/payments` заработает
- Можно будет добавлять, редактировать и удалять записи об оплатах

