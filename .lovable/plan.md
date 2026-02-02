
# План: Скрытие настроек календаря за кнопку

## Проблемы

### 1. Build-ошибки
Таблицы `tutor_calendar_settings` и `tutor_availability_exceptions` используются в коде, но отсутствуют в базе данных. Необходимо:
- Либо добавить миграцию для создания этих таблиц
- Либо временно удалить код, который их использует (хуки и функции)

### 2. UI настроек
Сейчас панель "Настройки" (`WorkHoursSettings`) занимает ~256px слева от календаря и всегда видна. Пользователь хочет скрыть её под кнопку.

---

## Решение

### Расположение кнопки "Настройки"

Лучшее место для кнопки настроек в header страницы, рядом с другими кнопками действий:

```
┌───────────────────────────────────────────────────────────────────┐
│ 📅 Расписание                                                      │
│ Нажмите на сетку, чтобы добавить занятие                          │
│                                                                    │
│                    [Ссылка] [⚙️] [🔔] [📅]                        │
│                            ↑                                       │
│                    Кнопка настроек                                 │
└───────────────────────────────────────────────────────────────────┘
```

### Реализация

**Файл**: `src/pages/tutor/TutorSchedule.tsx`

#### 1. Добавить Popover для настроек

Заменить боковую карточку `WorkHoursSettings` на Popover, который открывается по клику на кнопку:

```typescript
// В header, рядом с другими кнопками
<Popover>
  <PopoverTrigger asChild>
    <Button variant="outline" size="icon" title="Настройки расписания">
      <Settings className="h-4 w-4" />
    </Button>
  </PopoverTrigger>
  <PopoverContent className="w-64" align="end">
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground font-medium">
          Рабочие часы
        </Label>
        <div className="flex items-center gap-2">
          <Select value={...} onValueChange={...}>
            ...
          </Select>
          <span>—</span>
          <Select value={...} onValueChange={...}>
            ...
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground font-medium">
          Рабочие дни
        </Label>
        <div className="space-y-1">
          {DAYS_OF_WEEK.map((day, i) => (
            <div className="flex items-center gap-2">
              <Checkbox ... />
              <label>{day}</label>
            </div>
          ))}
        </div>
      </div>
    </div>
  </PopoverContent>
</Popover>
```

#### 2. Обновить layout

Убрать боковую панель настроек из основного layout:

**Было**:
```typescript
<div className="flex flex-col lg:flex-row gap-4">
  <WorkHoursSettings settings={...} onChange={...} />
  <Card className="flex-1">
    {/* Calendar */}
  </Card>
</div>
```

**Станет**:
```typescript
<Card className="overflow-hidden">
  {/* Calendar - теперь занимает всю ширину */}
</Card>
```

#### 3. Порядок кнопок в header

```
[Ссылка для записи] [⚙️ Настройки] [🔔 Напоминания] [📅 Календарь]
```

Логика группировки:
- **Ссылка для записи** — основное действие, отдельно
- **Настройки (⚙️)** — настройки отображения календаря (рабочие часы, дни)
- **Напоминания (🔔)** — настройки уведомлений
- **Календарь (📅)** — расширенные настройки записи

---

## Исправление Build-ошибок

Нужно создать миграцию для таблиц `tutor_calendar_settings` и `tutor_availability_exceptions`:

```sql
-- tutor_calendar_settings
CREATE TABLE IF NOT EXISTS public.tutor_calendar_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id UUID NOT NULL REFERENCES public.tutors(id) ON DELETE CASCADE UNIQUE,
  default_duration SMALLINT NOT NULL DEFAULT 60,
  buffer_minutes SMALLINT NOT NULL DEFAULT 15,
  min_notice_hours SMALLINT NOT NULL DEFAULT 24,
  max_advance_days SMALLINT NOT NULL DEFAULT 30,
  auto_confirm BOOLEAN NOT NULL DEFAULT true,
  allow_student_cancel BOOLEAN NOT NULL DEFAULT true,
  cancel_notice_hours SMALLINT NOT NULL DEFAULT 24,
  timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- tutor_availability_exceptions
CREATE TABLE IF NOT EXISTS public.tutor_availability_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id UUID NOT NULL REFERENCES public.tutors(id) ON DELETE CASCADE,
  exception_date DATE NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT tutor_availability_exceptions_unique UNIQUE (tutor_id, exception_date)
);

-- RLS и триггеры аналогично другим таблицам
```

---

## Изменения в файлах

| Файл | Изменение |
|------|-----------|
| `src/pages/tutor/TutorSchedule.tsx` | Заменить `WorkHoursSettings` на Popover с кнопкой |
| База данных | Миграция для `tutor_calendar_settings` и `tutor_availability_exceptions` |

---

## Визуальный результат

**До**:
```
┌────────────┬─────────────────────────────────────────┐
│ Настройки  │              Календарь                  │
│ ─────────  │  ← Пн 3   Вт 4   Ср 5   Чт 6   Пт 7 → │
│ 09:00-21:00│                                         │
│            │  09:00 │    │    │    │    │    │    │ │
│ ☑ Пн       │  10:00 │    │    │    │    │    │    │ │
│ ☑ Вт       │  ...                                   │
│ ...        │                                         │
└────────────┴─────────────────────────────────────────┘
```

**После**:
```
┌─────────────────────────────────────────────────────┐
│ 📅 Расписание        [Ссылка] [⚙️] [🔔] [📅]       │
├─────────────────────────────────────────────────────┤
│              Календарь (полная ширина)              │
│  ← Пн 3 фев    Вт 4    Ср 5    Чт 6    Пт 7 фев → │
│                                                     │
│  09:00 │      │      │  ██  │      │      │      │ │
│  10:00 │      │      │  ██  │      │      │      │ │
│  ...                                                │
└─────────────────────────────────────────────────────┘

При клике на ⚙️:
┌────────────────────┐
│ Рабочие часы       │
│ [09:00] — [21:00]  │
│                    │
│ Рабочие дни        │
│ ☑ Пн  ☑ Вт  ☑ Ср  │
│ ☑ Чт  ☑ Пт  ☐ Сб  │
│ ☐ Вс               │
└────────────────────┘
```

---

## Порядок выполнения

1. Создать миграцию для недостающих таблиц (исправит build-ошибки)
2. Преобразовать `WorkHoursSettings` в Popover
3. Добавить кнопку настроек в header рядом с другими кнопками
4. Убрать sidebar layout, календарь займёт всю ширину
