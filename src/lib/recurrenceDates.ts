import { addDays, addMonths } from 'date-fns';

/**
 * Периоды повторения серий занятий / личных дел (Волна 1 Расписания).
 * Значения зеркалят CHECK recurrence_rule (миграция 20260806130000):
 * daily / weekly / biweekly / monthly.
 *
 * Генерация — иммутабельная календарная арифметика от СТАРТА (не кумулятивная):
 * addDays/addMonths(start, i×шаг) — время суток сохраняется через DST (как прежний
 * setDate(+7×week)), а monthly с 31-м числом корректно клампится в коротких месяцах
 * и возвращается к 31-му в длинных.
 */
export type RecurrenceRule = 'daily' | 'weekly' | 'biweekly' | 'monthly';

export const RECURRENCE_RULE_OPTIONS: { value: RecurrenceRule; label: string }[] = [
  { value: 'daily', label: 'Каждый день' },
  { value: 'weekly', label: 'Раз в неделю' },
  { value: 'biweekly', label: 'Раз в 2 недели' },
  { value: 'monthly', label: 'Раз в месяц' },
];

export function recurrenceRuleLabel(rule: RecurrenceRule): string {
  return RECURRENCE_RULE_OPTIONS.find((o) => o.value === rule)?.label ?? 'Повторение';
}

/** Кап инстансов серии: недельные/2-недельные/месячные — 60 (≈14 мес еженедельно);
 *  daily — 92 (≈3 месяца ежедневных занятий, дальше это уже не «серия», а спам-инсерт). */
export const SERIES_MAX_INSTANCES = 60;
export const DAILY_MAX_INSTANCES = 92;

export function seriesCapForRule(rule: RecurrenceRule): number {
  return rule === 'daily' ? DAILY_MAX_INSTANCES : SERIES_MAX_INSTANCES;
}

export function generateSeriesDates(start: Date, until: Date, rule: RecurrenceRule): Date[] {
  const cap = seriesCapForRule(rule);
  const dates: Date[] = [];
  for (let i = 0; dates.length < cap; i++) {
    const d =
      rule === 'monthly' ? addMonths(start, i)
      : rule === 'daily' ? addDays(start, i)
      : addDays(start, i * (rule === 'biweekly' ? 14 : 7));
    if (d > until) break;
    dates.push(d);
  }
  return dates;
}

/**
 * Дефолт «Повторять до» = ближайшее 30 июня (конец учебного года, включая июньские
 * пересдачи) — решение владельца 2026-08-06. Июль и позже → 30 июня следующего года.
 */
export function defaultSeriesEndDate(from: Date = new Date()): Date {
  const year = from.getMonth() > 5 ? from.getFullYear() + 1 : from.getFullYear();
  return new Date(year, 5, 30, 23, 59, 59, 999);
}
