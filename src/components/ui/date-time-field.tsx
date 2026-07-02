import * as React from 'react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { CalendarClock } from 'lucide-react';

import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// -----------------------------------------------------------------------------
// DateTimeField — единый пикер даты/времени, drop-in замена <input
// type="datetime-local">. Публичный контракт значения = локальная строка
// "YYYY-MM-DDTHH:mm" (пустая строка = не задано), чтобы существующие конвертеры
// (parseISO/toISOString) остались нетронутыми. Время шагом 15 минут (решение
// владельца). RU-локаль, iOS-safe (16px, touch-action), без нативного type=time
// (тот же спиннер-баг) и без new Date("строка") (rule 80).
// -----------------------------------------------------------------------------

const TIME_STEP_MIN = 15;

const pad = (n: number) => n.toString().padStart(2, '0');

/** Слоты времени 00:00…23:45 с шагом 15 минут (строятся один раз). */
const TIME_SLOTS: { hour: number; minute: number; label: string }[] = [];
for (let h = 0; h < 24; h += 1) {
  for (let m = 0; m < 60; m += TIME_STEP_MIN) {
    TIME_SLOTS.push({ hour: h, minute: m, label: `${pad(h)}:${pad(m)}` });
  }
}

interface ParsedValue {
  date: Date | undefined;
  hour: number;
  minute: number;
}

/** Разбор "YYYY-MM-DDTHH:mm" вручную (без new Date(string), rule 80). */
function parseLocalValue(value: string | null): ParsedValue {
  if (value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
    if (m) {
      const [, y, mo, d, h, mi] = m;
      return {
        date: new Date(Number(y), Number(mo) - 1, Number(d)),
        hour: Number(h),
        minute: Number(mi),
      };
    }
  }
  return { date: undefined, hour: 18, minute: 0 };
}

function composeLocalValue(date: Date, hour: number, minute: number): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(hour)}:${pad(minute)}`;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Гибкий разбор ручного ввода: "1900" / "19:0" / "19:00" → {h, m} или null. */
function parseTimeText(raw: string): { hour: number; minute: number } | null {
  const trimmed = raw.trim();
  const m = /^(\d{1,2}):?(\d{0,2})$/.exec(trimmed);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = m[2] === '' ? 0 : Number(m[2]);
  if (Number.isNaN(hour) || Number.isNaN(minute) || hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** Прижать минуту к ближайшему шагу 15 (0/15/30/45). */
function snapMinute(minute: number): number {
  return Math.min(45, Math.round(minute / TIME_STEP_MIN) * TIME_STEP_MIN);
}

export interface DateTimeFieldProps {
  /** Локальная строка "YYYY-MM-DDTHH:mm" или null/'' если не задано. */
  value: string | null;
  /** Возвращает ту же локальную строку; '' при очистке. */
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Запретить дни раньше этой даты (для дедлайнов в будущем). */
  minDate?: Date;
  /** Показать кнопку «Очистить» (для необязательных полей — дедлайны). */
  clearable?: boolean;
  id?: string;
  placeholder?: string;
  align?: 'start' | 'center' | 'end';
  /** Класс на кнопку-триггер (ширина и т.п.). */
  className?: string;
}

export function DateTimeField({
  value,
  onChange,
  disabled = false,
  minDate,
  clearable = false,
  id,
  placeholder = 'Выберите дату и время',
  align = 'start',
  className,
}: DateTimeFieldProps) {
  const [open, setOpen] = React.useState(false);
  const { date, hour, minute } = parseLocalValue(value);

  // Текстовый буфер ручного ввода времени. Синк по примитиву timeStr (без петли).
  const timeStr = value ? `${pad(hour)}:${pad(minute)}` : '';
  const [timeText, setTimeText] = React.useState(timeStr);
  React.useEffect(() => {
    setTimeText(timeStr);
  }, [timeStr]);

  const selectedSlotRef = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    if (open) {
      // Прокрутить выбранный слот в центр при открытии.
      const t = window.setTimeout(() => {
        selectedSlotRef.current?.scrollIntoView({ block: 'nearest' });
      }, 0);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  const commit = (nextDate: Date | undefined, nextHour: number, nextMinute: number) => {
    const d = nextDate ?? date ?? new Date();
    onChange(composeLocalValue(d, nextHour, nextMinute));
  };

  const handleDateSelect = (d: Date | undefined) => {
    if (!d) return;
    // Если время ещё не выбрано (пустое значение) — дефолт 18:00.
    commit(d, value ? hour : 18, value ? minute : 0);
  };

  const handleSlotClick = (slotHour: number, slotMinute: number) => {
    commit(date, slotHour, slotMinute);
  };

  const handleTimeTextChange = (raw: string) => {
    setTimeText(raw);
    // Живой коммит только на полном валидном "HH:MM".
    const full = /^(\d{2}):(\d{2})$/.exec(raw.trim());
    if (full) {
      const parsed = parseTimeText(raw);
      if (parsed) commit(date, parsed.hour, parsed.minute);
    }
  };

  const handleTimeTextBlur = () => {
    const parsed = parseTimeText(timeText);
    if (!parsed) {
      setTimeText(timeStr); // откат к текущему
      return;
    }
    const snapped = snapMinute(parsed.minute);
    commit(date, parsed.hour, snapped);
    setTimeText(`${pad(parsed.hour)}:${pad(snapped)}`);
  };

  const displayLabel =
    value && date
      ? format(
          new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute),
          'd MMMM yyyy, HH:mm',
          { locale: ru },
        )
      : '';

  const calendarDisabled = minDate
    ? (d: Date) => d < startOfLocalDay(minDate)
    : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            'w-full justify-start text-left font-normal tabular-nums',
            !value && 'text-muted-foreground',
            className,
          )}
          style={{ touchAction: 'manipulation' }}
        >
          <CalendarClock className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{displayLabel || placeholder}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align}>
        <div className="flex flex-col sm:flex-row">
          <Calendar
            mode="single"
            selected={date}
            onSelect={handleDateSelect}
            defaultMonth={date}
            locale={ru}
            disabled={calendarDisabled}
            className="pointer-events-auto"
          />
          <div className="flex w-full flex-col border-t p-3 sm:w-[132px] sm:border-l sm:border-t-0">
            <div className="mb-2 text-xs font-medium text-muted-foreground">Время</div>
            <input
              type="text"
              inputMode="numeric"
              value={timeText}
              placeholder="--:--"
              aria-label="Время (часы:минуты)"
              onChange={(e) => handleTimeTextChange(e.target.value)}
              onBlur={handleTimeTextBlur}
              className="mb-2 h-9 w-full rounded-md border border-input bg-background px-2 text-base tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
              style={{ touchAction: 'manipulation' }}
            />
            <div className="max-h-[190px] overflow-y-auto pr-1" role="listbox" aria-label="Выбор времени">
              {TIME_SLOTS.map((slot) => {
                const isSelected = Boolean(value) && slot.hour === hour && slot.minute === minute;
                return (
                  <button
                    key={slot.label}
                    ref={isSelected ? selectedSlotRef : undefined}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSlotClick(slot.hour, slot.minute)}
                    className={cn(
                      'w-full rounded px-2 py-1.5 text-left text-sm tabular-nums transition-colors',
                      isSelected
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-accent hover:text-accent-foreground',
                    )}
                    style={{ touchAction: 'manipulation' }}
                  >
                    {slot.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t p-2">
          {clearable ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!value}
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
            >
              Очистить
            </Button>
          ) : (
            <span />
          )}
          <Button type="button" size="sm" onClick={() => setOpen(false)}>
            Готово
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
