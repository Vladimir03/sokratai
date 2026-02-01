

## План: Добавление колонки invite_code в таблицу tutors

### Проблема
Ошибки сборки:
```
src/pages/InviteToTelegram.tsx(34,51): error TS2589: Type instantiation is excessively deep and possibly infinite.
src/pages/InviteToTelegram.tsx(46,18): error TS2345: Argument of type 'SelectQueryError<"column 'invite_code' does not exist on 'tutors'.">' is not assignable...
```

**Причина**: Миграция `20260201140000_tutor_invite_code_c21.sql` существует в коде, но **не была применена** к базе данных. Колонка `invite_code` отсутствует в таблице `tutors`.

### Текущее состояние таблицы tutors
| Колонка | Есть в БД |
|---------|-----------|
| id, user_id, name | ✅ |
| telegram_id, telegram_username | ✅ |
| booking_link, avatar_url | ✅ |
| subjects, bio | ✅ |
| **invite_code** | ❌ **Отсутствует** |

### Решение
Выполнить миграцию для добавления колонки `invite_code`:

```sql
-- 1. Добавить колонку invite_code
ALTER TABLE public.tutors
ADD COLUMN IF NOT EXISTS invite_code TEXT UNIQUE;

-- 2. Создать функцию для генерации случайного кода
CREATE OR REPLACE FUNCTION public.generate_invite_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- 3. Backfill: заполнить invite_code для существующих репетиторов
DO $$
DECLARE
  tutor_record RECORD;
  new_code TEXT;
  code_exists BOOLEAN;
BEGIN
  FOR tutor_record IN SELECT id FROM public.tutors WHERE invite_code IS NULL LOOP
    LOOP
      new_code := public.generate_invite_code();
      SELECT EXISTS(SELECT 1 FROM public.tutors WHERE invite_code = new_code) INTO code_exists;
      EXIT WHEN NOT code_exists;
    END LOOP;
    
    UPDATE public.tutors SET invite_code = new_code WHERE id = tutor_record.id;
  END LOOP;
END $$;

-- 4. Установить default для новых записей
ALTER TABLE public.tutors
ALTER COLUMN invite_code SET DEFAULT public.generate_invite_code();

-- 5. Индекс для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_tutors_invite_code ON public.tutors(invite_code);

-- 6. RLS-политика для публичного доступа
CREATE POLICY "Anyone can view tutor by invite_code"
  ON public.tutors FOR SELECT
  USING (invite_code IS NOT NULL);
```

### Что произойдет после миграции
| Компонент | Результат |
|-----------|-----------|
| `InviteToTelegram.tsx` | Ошибки сборки исчезнут |
| `TutorStudents.tsx` | Модалка "Добавить ученика" заработает |
| Telegram-бот | Сможет обрабатывать `/start tutor_<code>` |
| QR-код | Будет генерироваться корректно |

### Безопасность
- `invite_code` уникален для каждого репетитора
- Публичный доступ только на чтение (для страницы приглашения)
- Код 8 символов из безопасного алфавита (без 0/O/I/1)

