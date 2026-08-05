import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDeadline, getDeadlineUrgency, URGENCY_CONFIG } from './homeworkDeadline';

/**
 * Тесты на срочность дедлайна ДЗ.
 *
 * Зачем: `getDeadlineUrgency` — time-dependent (isPast/isToday/differenceInDays
 * считают от «сейчас»), и её регресс не падает, а молча красит карточку не тем
 * цветом: «Просрочено» на сегодняшнем дедлайне пугает ученика зря, а пропавший
 * янтарный «Сегодня» прячет реальный дедлайн. Часы фиксируем fake timers —
 * иначе тест зелёный в полдень и красный в 23:59.
 *
 * Даты подаём ISO-строками: весь проект парсит их через parseISO (rule 80 —
 * `new Date("2024-01-15 10:30:00")` ломается в Safari, поэтому нативный парсинг
 * здесь вообще не участвует).
 */

describe('getDeadlineUrgency — границы от фиксированного «сейчас»', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Полдень локального времени — обе стороны суток достижимы без смены даты.
    vi.setSystemTime(new Date('2026-08-05T12:00:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('null и невалидная строка → none, не исключение', () => {
    expect(getDeadlineUrgency(null)).toBe('none');
    expect(getDeadlineUrgency('не дата')).toBe('none');
    expect(getDeadlineUrgency('')).toBe('none');
  });

  it('вчера → overdue', () => {
    expect(getDeadlineUrgency('2026-08-04T18:00:00')).toBe('overdue');
    expect(getDeadlineUrgency('2026-07-01')).toBe('overdue');
  });

  it('сегодня, даже если время уже прошло → today, НЕ overdue (гейт isPast && !isToday)', () => {
    // 00:00 сегодняшнего дня «в прошлом» относительно полудня — именно этот
    // случай ловит `!isToday`: дедлайн дня не должен краснеть до конца дня.
    expect(getDeadlineUrgency('2026-08-05T00:00:00')).toBe('today');
    expect(getDeadlineUrgency('2026-08-05T23:59:00')).toBe('today');
  });

  it('завтра → soon', () => {
    expect(getDeadlineUrgency('2026-08-06T00:00:00')).toBe('soon');
    expect(getDeadlineUrgency('2026-08-06T23:00:00')).toBe('soon');
  });

  it('≤ 2 полных суток вперёд → soon, ровно 3 суток → normal', () => {
    // differenceInDays считает ПОЛНЫЕ сутки: 2д11ч → 2 → soon; ровно 72ч → 3.
    expect(getDeadlineUrgency('2026-08-07T23:00:00')).toBe('soon');
    expect(getDeadlineUrgency('2026-08-08T12:00:00')).toBe('normal');
  });

  it('далёкий дедлайн → normal', () => {
    expect(getDeadlineUrgency('2026-09-01')).toBe('normal');
  });

  it('у каждой срочности есть конфиг стилей; label только у overdue/today', () => {
    // Косвенный контракт с UI: новый вариант DeadlineUrgency без записи в
    // URGENCY_CONFIG уронил бы рендер обращением к undefined.
    for (const urgency of ['overdue', 'today', 'soon', 'normal', 'none'] as const) {
      expect(URGENCY_CONFIG[urgency]).toBeDefined();
    }
    expect(URGENCY_CONFIG.overdue.label).toBe('Просрочено');
    expect(URGENCY_CONFIG.today.label).toBe('Сегодня');
    expect(URGENCY_CONFIG.soon.label).toBeUndefined();
  });
});

describe('formatDeadline — короткая русская дата', () => {
  it('ISO-строка → «5 авг.» (день + короткий месяц, ru-RU)', () => {
    // Точная строка из Node full-ICU; разделитель — обычный пробел U+0020.
    expect(formatDeadline('2026-08-05T12:00:00')).toBe('5 авг.');
    expect(formatDeadline('2026-01-15')).toBe('15 янв.');
  });

  it('null и мусор → null, не «Invalid Date»', () => {
    expect(formatDeadline(null)).toBeNull();
    expect(formatDeadline('мусор')).toBeNull();
  });
});
