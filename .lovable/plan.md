
# План: Календарь в стиле Google Calendar

## Обзор текущей реализации

Сейчас календарь использует **фиксированную сетку** по часам (08:00, 09:00...21:00), где каждое занятие занимает ровно одну ячейку высотой `h-14` независимо от реальной длительности. Это не позволяет корректно отображать занятия длительностью 45, 90 или 120 минут.

---

## Требуемые изменения

### 1. Отображение занятий с точной длительностью (Google-style)

**Текущая проблема**: 
- Сетка привязана к часам (константа `HOURS`)
- Ячейка `ScheduleCell` имеет фиксированную высоту `h-14`
- Занятия длительностью 45 или 90 минут визуально не отличаются от 60-минутных

**Решение**:
- Перейти на **пиксельную сетку**, где 1 минута = 1px (или коэффициент, например 1.2px)
- Занятия рендерятся как **абсолютно позиционированные** блоки с высотой `duration_min * pixelsPerMinute`
- Вертикальная позиция вычисляется от начала рабочего дня: `(startMinutes - workDayStart) * pixelsPerMinute`

**Новая структура компонента WeekCalendar**:
```
┌─────────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┐
│  Время  │  Пн  │  Вт  │  Ср  │  Чт  │  Пт  │  Сб  │  Вс  │
├─────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
│  09:00  │      │      │      │      │ ░░░░ │      │      │
│         │      │      │      │      │ ░░░░ │      │      │
│  10:00  │ ████ │      │      │      │ ░░░░ │      │      │  
│         │ ████ │      │      │      │      │      │      │
│  10:30  │ ████ │      │      │      │      │      │      │
│         │ ████ │      │      │      │      │      │      │
│  11:00  │      │      │      │      │      │      │      │
└─────────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┘

████ = 90-минутное занятие (занимает 1.5 строки)
░░░░ = 45-минутное занятие (занимает 0.75 строки)
```

**Ключевые изменения в TutorSchedule.tsx**:

```typescript
// Константы для пиксельной сетки
const PIXELS_PER_HOUR = 60; // 60px на час = 1px на минуту
const HOUR_LINE_HEIGHT = 60; // Высота часовой линии

// Компонент LessonBlock (абсолютное позиционирование)
function LessonBlock({ lesson, workDayStart }) {
  const startDate = new Date(lesson.start_at);
  const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
  
  const top = (startMinutes - workDayStart * 60) * (PIXELS_PER_HOUR / 60);
  const height = lesson.duration_min * (PIXELS_PER_HOUR / 60);
  
  return (
    <div 
      className="absolute left-0 right-0 mx-1 bg-primary text-primary-foreground rounded px-1"
      style={{ top: `${top}px`, height: `${height}px` }}
    >
      <span className="text-xs truncate">
        {studentName}
      </span>
      <span className="text-xs opacity-80">
        {formatTime} - {formatEndTime}
      </span>
    </div>
  );
}
```

---

### 2. Настройка рабочих часов (слева в расписании)

**Текущая проблема**:
- Жёстко заданы часы `8:00 - 21:00` в константе `HOURS`
- Нет UI для изменения диапазона

**Решение**:
Добавить **карточку настроек** в левую часть страницы:

```
┌─────────────────────────────────┐
│ ⚙️ Настройки                    │
├─────────────────────────────────┤
│ Рабочие часы                    │
│ От: [09:00 ▾]  До: [21:00 ▾]   │
│                                 │
│ ☑ Понедельник                   │
│ ☑ Вторник                       │
│ ☑ Среда                         │
│ ☑ Четверг                       │
│ ☑ Пятница                       │
│ ☐ Суббота                       │
│ ☐ Воскресенье                   │
└─────────────────────────────────┘
```

**Реализация**:

1. **Состояние настроек** (localStorage или база данных):
```typescript
interface ScheduleSettings {
  workDayStart: number; // 0-23
  workDayEnd: number;   // 1-24
  workDays: number[];   // [0,1,2,3,4] = Пн-Пт
}

const [settings, setSettings] = useState<ScheduleSettings>({
  workDayStart: 9,
  workDayEnd: 21,
  workDays: [0, 1, 2, 3, 4] // Пн-Пт по умолчанию
});
```

2. **Компонент WorkHoursSettings**:
```typescript
function WorkHoursSettings({ settings, onChange }) {
  const hours = Array.from({ length: 25 }, (_, i) => i); // 0-24
  
  return (
    <Card className="w-64">
      <CardHeader>
        <CardTitle className="text-sm">Рабочие часы</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Label>От:</Label>
          <Select value={settings.workDayStart.toString()} onValueChange={...}>
            {hours.slice(0, 24).map(h => (
              <SelectItem key={h} value={h.toString()}>
                {h.toString().padStart(2, '0')}:00
              </SelectItem>
            ))}
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label>До:</Label>
          <Select value={settings.workDayEnd.toString()} onValueChange={...}>
            {hours.slice(1).map(h => (...))}
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
```

3. **Динамический расчёт сетки**:
```typescript
const visibleHours = useMemo(() => {
  return Array.from(
    { length: settings.workDayEnd - settings.workDayStart },
    (_, i) => settings.workDayStart + i
  );
}, [settings]);

const gridHeight = visibleHours.length * PIXELS_PER_HOUR;
```

---

### 3. Диалог "Добавить занятие" с выбором даты и времени

**Текущая проблема**:
- Дата и время берутся из клика по ячейке (`selectedDate`, `selectedHour`)
- При нажатии кнопки "Добавить занятие" используется текущая дата/час
- Нет возможности вручную указать произвольную дату и время

**Решение**:
Расширить `AddLessonDialog` с полями для выбора даты и времени:

```
┌─────────────────────────────────────┐
│ Добавить занятие                 ✕ │
├─────────────────────────────────────┤
│ Дата и время *                      │
│ ┌─────────────┐ ┌─────────────────┐ │
│ │ 📅 02.02.26 │ │ 🕐 19:00 ▾     │ │
│ └─────────────┘ └─────────────────┘ │
│                                     │
│ Ученик *                            │
│ ┌─────────────────────────────────┐ │
│ │ Выберите ученика            ▾  │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Длительность                        │
│ ┌─────────────────────────────────┐ │
│ │ 60 минут                     ▾  │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Заметка (опц.)                      │
│ ┌─────────────────────────────────┐ │
│ │ Примечание к занятию...         │ │
│ └─────────────────────────────────┘ │
│                                     │
│              [Отмена] [Создать]     │
└─────────────────────────────────────┘
```

**Изменения в AddLessonDialog**:

```typescript
function AddLessonDialog({ 
  open, 
  onOpenChange, 
  students, 
  initialDate,      // Может быть null при ручном создании
  initialHour,      // Может быть null при ручном создании
  onSuccess 
}: AddLessonDialogProps) {
  // Состояние для даты и времени
  const [date, setDate] = useState<Date | undefined>(initialDate || new Date());
  const [hour, setHour] = useState(initialHour?.toString() || '10');
  const [minute, setMinute] = useState('00');
  
  // Обновлять при открытии диалога
  useEffect(() => {
    if (open) {
      setDate(initialDate || new Date());
      setHour(initialHour?.toString() || new Date().getHours().toString());
      setMinute('00');
    }
  }, [open, initialDate, initialHour]);

  return (
    <Dialog>
      <DialogContent>
        {/* Новое: Выбор даты */}
        <div className="space-y-2">
          <Label>Дата и время *</Label>
          <div className="flex gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-[180px] justify-start">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, 'dd.MM.yyyy') : 'Выберите дату'}
                </Button>
              </PopoverTrigger>
              <PopoverContent>
                <Calendar 
                  mode="single" 
                  selected={date} 
                  onSelect={setDate}
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
            
            {/* Выбор времени */}
            <div className="flex gap-1">
              <Select value={hour} onValueChange={setHour}>
                <SelectTrigger className="w-[80px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({length: 24}, (_, i) => (
                    <SelectItem key={i} value={i.toString()}>
                      {i.toString().padStart(2, '0')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="flex items-center">:</span>
              <Select value={minute} onValueChange={setMinute}>
                <SelectTrigger className="w-[80px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['00', '15', '30', '45'].map(m => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        
        {/* Существующие поля... */}
      </DialogContent>
    </Dialog>
  );
}
```

---

## Файлы для изменения

| Файл | Изменения |
|------|-----------|
| `src/pages/tutor/TutorSchedule.tsx` | Полная переработка компонента календаря |

### Новые компоненты внутри файла:

1. **WeekCalendar** — основная сетка с пиксельным позиционированием
2. **LessonBlock** — блок занятия с динамической высотой
3. **TimeColumn** — колонка времени слева
4. **DayColumn** — колонка дня с relative позиционированием для занятий
5. **WorkHoursSettings** — настройки рабочих часов (сайдбар)
6. **AddLessonDialog** (обновлённый) — с DatePicker и TimePicker

---

## Структура Layout страницы

```
┌──────────────────────────────────────────────────────────────┐
│ 📅 Расписание                    [Ссылка] [🔔]              │
├──────────────────────────────────────────────────────────────┤
│ ┌──────────┐  ┌──────────────────────────────────────────┐  │
│ │ Настройки │  │           Календарь недели               │  │
│ │           │  │                                          │  │
│ │ Рабочие   │  │ ← Пн 3 фев    ...    Вс 9 фев →         │  │
│ │ часы:     │  │                                          │  │
│ │ 09-21     │  │  09:00 │    │    │ ██ │    │    │    │  │  │
│ │           │  │        │    │    │ ██ │    │    │    │  │  │
│ │ Рабочие   │  │  10:00 │    │    │    │    │    │    │  │  │
│ │ дни:      │  │        │ ░░ │    │    │    │    │    │  │  │
│ │ ☑ Пн-Пт   │  │  11:00 │ ░░ │    │    │    │    │    │  │  │
│ │ ☐ Сб-Вс   │  │        │    │    │    │    │    │    │  │  │
│ │           │  │  ...                                     │  │
│ └──────────┘  └──────────────────────────────────────────┘  │
│                                                              │
│                    [+ Добавить занятие]                      │
└──────────────────────────────────────────────────────────────┘
```

---

## Технические детали

### Пиксельная сетка

```typescript
const PIXELS_PER_MINUTE = 1; // 1px = 1 минута
const HOUR_HEIGHT = 60; // 60px на час

function calculateLessonPosition(lesson: TutorLesson, workDayStartHour: number) {
  const startDate = new Date(lesson.start_at);
  const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
  const offsetMinutes = startMinutes - (workDayStartHour * 60);
  
  return {
    top: offsetMinutes * PIXELS_PER_MINUTE,
    height: lesson.duration_min * PIXELS_PER_MINUTE,
  };
}
```

### Сохранение настроек

Для простоты используем localStorage:
```typescript
const SETTINGS_KEY = 'tutor-schedule-settings';

function loadSettings(): ScheduleSettings {
  const saved = localStorage.getItem(SETTINGS_KEY);
  return saved ? JSON.parse(saved) : defaultSettings;
}

function saveSettings(settings: ScheduleSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
```

---

## Порядок выполнения

1. **Рефакторинг календаря**: Переделать сетку на пиксельное позиционирование
2. **LessonBlock**: Создать компонент для занятий с динамической высотой
3. **WorkHoursSettings**: Добавить настройки рабочих часов
4. **AddLessonDialog**: Расширить диалог с DatePicker и TimePicker
5. **Layout**: Переработать layout с сайдбаром настроек

---

## Ожидаемый результат

| Функция | До | После |
|---------|-----|-------|
| Отображение 45-мин занятия | Полная ячейка (как 60 мин) | 3/4 высоты ячейки |
| Отображение 90-мин занятия | Полная ячейка (как 60 мин) | 1.5 высоты, перекрывает 2 строки |
| Рабочие часы | Фиксировано 8-21 | Настраивается 0-24 |
| Добавление занятия | Только по клику на ячейку | Свободный выбор даты/времени |
