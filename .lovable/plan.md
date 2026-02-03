

# План: Исправление кнопки "Ссылка для записи"

## Диагностика

### Найденная проблема
Кнопка "Ссылка для записи" не работает, потому что у текущего репетитора (Владимир) поле `booking_link` в базе данных равно `null`:

```
tutors:
  id: 70ff3df8-f081-4ed1-83bb-4d1a1f80f795
  booking_link: null  ← Проблема!
  invite_code: JPYRPYCN
```

Функция `getBookingLink()` в `src/lib/tutors.ts` проверяет наличие `booking_link` и возвращает `null` если оно не установлено:

```typescript
export async function getBookingLink(): Promise<string | null> {
  const tutor = await getCurrentTutor();
  if (!tutor?.booking_link) return null;  // ← Возвращает null
  return `${window.location.origin}/book/${tutor.booking_link}`;
}
```

### Что работает
- Weekly slots создаются успешно (в БД есть 91 слот для дней 0-6, часы 08:00-20:00)
- Страница `/book/:bookingLink` существует и роутинг настроен
- RPC функции `get_available_booking_slots` и `book_lesson_slot` существуют

---

## Решение

### 1. Автогенерация booking_link

При нажатии на кнопку "Ссылка для записи", если `booking_link` не установлен, автоматически создать его:

**Файл `src/lib/tutors.ts`:**

```typescript
/**
 * Генерирует уникальный booking_link для репетитора
 */
function generateBookingLink(tutorId: string): string {
  // Формат: "tutor-" + первые 8 символов UUID
  return `tutor-${tutorId.substring(0, 8)}`;
}

/**
 * Получить или создать ссылку для записи
 */
export async function getBookingLink(): Promise<string | null> {
  let tutor = await getCurrentTutor();
  if (!tutor) return null;
  
  // Если booking_link не установлен - создаём
  if (!tutor.booking_link) {
    const newBookingLink = generateBookingLink(tutor.id);
    
    const { data, error } = await supabase
      .from('tutors')
      .update({ booking_link: newBookingLink })
      .eq('id', tutor.id)
      .select()
      .single();
    
    if (error) {
      console.error('Error creating booking link:', error);
      return null;
    }
    
    // Обновляем кэш
    tutor = data as Tutor;
    clearTutorCache(); // Сбросить кэш чтобы получить новые данные
  }
  
  return `${window.location.origin}/book/${tutor.booking_link}`;
}
```

### 2. Альтернатива: Триггер в БД

Можно также добавить триггер, который автоматически генерирует `booking_link` при создании репетитора (аналогично `invite_code`):

```sql
-- Добавить DEFAULT значение для booking_link
ALTER TABLE public.tutors 
ALTER COLUMN booking_link SET DEFAULT 'tutor-' || substr(gen_random_uuid()::text, 1, 8);

-- Заполнить существующие NULL значения
UPDATE public.tutors 
SET booking_link = 'tutor-' || substr(id::text, 1, 8) 
WHERE booking_link IS NULL;
```

---

## Рекомендуемый подход

Комбинация обоих методов:

1. **Миграция БД** - заполнить `booking_link` для существующих репетиторов
2. **Обновить `getBookingLink()`** - на случай если в будущем появятся репетиторы без `booking_link`

---

## Изменения в файлах

| Файл | Изменение |
|------|-----------|
| `src/lib/tutors.ts` | Обновить `getBookingLink()` для автогенерации |
| База данных | Миграция: заполнить NULL booking_link |

---

## Тестирование полного сценария

После исправления проверить:

1. Открыть `/tutor/schedule` как репетитор
2. Нажать "Ссылка для записи" - должна скопироваться ссылка вида `/book/tutor-70ff3df8`
3. Открыть эту ссылку в инкогнито как ученик
4. Выбрать дату с зелёной точкой (дни с доступными слотами)
5. Выбрать время - подтвердить запись

