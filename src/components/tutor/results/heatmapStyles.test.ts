// Тесты хелперов теплокарты результатов ДЗ (heatmapStyles.ts).
// Зачем: пороги цветов ячеек (spec.md P0-3: <0.3 красный, <0.8 янтарный,
// ≥0.8 изумрудный), «% самостоятельности» (null ≠ 100%! — «неизвестно» нельзя
// показывать как «сделал сам») и колонка «Время» (status — единственный
// источник истины, minutes сам по себе неоднозначен).
import { describe, expect, it } from 'vitest';
import {
  formatIndependence,
  formatScore,
  formatTotalTime,
  getCellStyle,
} from './heatmapStyles';

describe('formatScore', () => {
  it('целое → без дроби, дробное → одна цифра после точки', () => {
    expect(formatScore(5)).toBe('5');
    expect(formatScore(0)).toBe('0');
    expect(formatScore(2.5)).toBe('2.5');
    // toFixed(1) округляет: 2.25 → «2.3». Зафиксировано как есть.
    expect(formatScore(2.25)).toBe('2.3');
  });
});

describe('formatIndependence', () => {
  it('null / undefined / NaN → «—» (данных нет, НЕ «100%»)', () => {
    expect(formatIndependence(null)).toBe('—');
    expect(formatIndependence(undefined)).toBe('—');
    expect(formatIndependence(Number.NaN)).toBe('—');
  });

  it('точный процент → округлённое целое с «%»', () => {
    expect(formatIndependence(73.4)).toBe('73%');
    expect(formatIndependence(73.5)).toBe('74%');
    expect(formatIndependence(100)).toBe('100%');
  });

  it('ноль — валидное значение, не «—»', () => {
    expect(formatIndependence(0)).toBe('0%');
  });

  it('isEstimate (legacy-счётчики) → префикс «≈»', () => {
    expect(formatIndependence(80, true)).toBe('≈80%');
    // null остаётся «—» и в estimate-режиме.
    expect(formatIndependence(null, true)).toBe('—');
  });
});

describe('getCellStyle', () => {
  it('score null → серая заглушка «—»', () => {
    expect(getCellStyle(null, 10)).toEqual({
      className: 'bg-slate-100 text-slate-400',
      text: '—',
    });
  });

  it('ratio < 0.3 → красный', () => {
    expect(getCellStyle(0, 10)).toEqual({
      className: 'bg-red-100 text-red-900',
      text: '0/10',
    });
    expect(getCellStyle(1, 5)).toMatchObject({ className: 'bg-red-100 text-red-900' });
  });

  it('границы порогов: ровно 0.3 → янтарный, ровно 0.8 → изумрудный', () => {
    // Пороги из кода строгие «<»: 3/10 = 0.3 уже НЕ красный.
    expect(getCellStyle(3, 10)).toMatchObject({
      className: 'bg-amber-100 text-amber-900',
    });
    expect(getCellStyle(7.9, 10)).toMatchObject({
      className: 'bg-amber-100 text-amber-900',
    });
    // 8/10 = 0.8 уже НЕ янтарный.
    expect(getCellStyle(8, 10)).toEqual({
      className: 'bg-emerald-100 text-emerald-900',
      text: '8/10',
    });
    expect(getCellStyle(10, 10)).toMatchObject({
      className: 'bg-emerald-100 text-emerald-900',
    });
  });

  it('нулевой maxScore → ratio 0 → красный (деления на ноль нет)', () => {
    // Зафиксировано поведение кода: maxScore <= 0 даёт ratio = 0, ячейка
    // красная с текстом «score/0».
    expect(getCellStyle(3, 0)).toEqual({
      className: 'bg-red-100 text-red-900',
      text: '3/0',
    });
  });

  it('дробные баллы форматируются через formatScore в тексте ячейки', () => {
    expect(getCellStyle(2.5, 5)).toEqual({
      className: 'bg-amber-100 text-amber-900',
      text: '2.5/5',
    });
  });
});

describe('formatTotalTime', () => {
  it('not_started → «—» независимо от minutes', () => {
    expect(formatTotalTime(null, 'not_started')).toBe('—');
    expect(formatTotalTime(15, 'not_started')).toBe('—');
  });

  it('in_progress → «— в процессе» независимо от minutes', () => {
    expect(formatTotalTime(null, 'in_progress')).toBe('— в процессе');
    expect(formatTotalTime(42, 'in_progress')).toBe('— в процессе');
  });

  it('completed: null → «—», N → «N мин» (часы не выделяются — формат из кода)', () => {
    expect(formatTotalTime(null, 'completed')).toBe('—');
    expect(formatTotalTime(42, 'completed')).toBe('42 мин');
    expect(formatTotalTime(0, 'completed')).toBe('0 мин');
    // Минуты НЕ конвертируются в часы даже при больших значениях — как в коде.
    expect(formatTotalTime(125, 'completed')).toBe('125 мин');
  });
});
