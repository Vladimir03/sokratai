// Тесты шкал баллов «Прогресса ученика» (scoreScales.ts) + parity с Deno-зеркалом
// supabase/functions/_shared/score-scales.ts. Зачем: дрейф зеркал — реальный
// класс багов проекта («превью говорит верно, финал даёт 0», rule 45); шкалы
// ЕГЭ/ОГЭ — официальные таблицы ФИПИ, любое расхождение врёт ученику про
// тестовый балл и оценку.
import { describe, expect, it } from 'vitest';
import {
  EGE_PHYS_2026,
  egePrimaryToScaled,
  ogeMark,
  rollupByScoreKind,
} from './scoreScales';
import {
  EGE_PHYS_2026 as EGE_DENO,
  egePrimaryToScaled as egePrimaryToScaledDeno,
  ogeMark as ogeMarkDeno,
} from '../../supabase/functions/_shared/score-scales';

describe('ogeMark', () => {
  it('границы полос ФИПИ: 0–9 → «2», 10–19 → «3», 20–29 → «4», 30–39 → «5»', () => {
    expect(ogeMark(0, 39)).toBe(2);
    expect(ogeMark(9, 39)).toBe(2);
    expect(ogeMark(10, 39)).toBe(3);
    expect(ogeMark(19, 39)).toBe(3);
    expect(ogeMark(20, 39)).toBe(4);
    expect(ogeMark(29, 39)).toBe(4);
    expect(ogeMark(30, 39)).toBe(5);
    expect(ogeMark(39, 39)).toBe(5);
  });

  it('дробный балл округляется до полосы: 9.5 → «3», 9.4 → «2»', () => {
    expect(ogeMark(9.5, 39)).toBe(3);
    expect(ogeMark(9.4, 39)).toBe(2);
  });

  it('null / NaN / max <= 0 → null; отрицательный балл клампится в «2»', () => {
    expect(ogeMark(null, 39)).toBeNull();
    expect(ogeMark(undefined, 39)).toBeNull();
    expect(ogeMark(Number.NaN, 39)).toBeNull();
    expect(ogeMark(15, 0)).toBeNull();
    expect(ogeMark(-3, 39)).toBe(2);
  });
});

describe('egePrimaryToScaled', () => {
  it('прямой lookup по таблице ФИПИ 2026: 0 → 0, 21 → 59, 23 → 62, 45 → 100', () => {
    expect(egePrimaryToScaled(0)).toBe(0);
    expect(egePrimaryToScaled(21)).toBe(59);
    expect(egePrimaryToScaled(23)).toBe(62);
    expect(egePrimaryToScaled(45)).toBe(100);
  });

  it('клампится в границы таблицы и округляет дробный первичный', () => {
    expect(egePrimaryToScaled(50)).toBe(100);
    expect(egePrimaryToScaled(-3)).toBe(0);
    expect(egePrimaryToScaled(20.6)).toBe(59); // round → 21
  });

  it('null / NaN → null', () => {
    expect(egePrimaryToScaled(null)).toBeNull();
    expect(egePrimaryToScaled(undefined)).toBeNull();
    expect(egePrimaryToScaled(Number.NaN)).toBeNull();
  });
});

describe('rollupByScoreKind', () => {
  it('null raw → пустой роллап «—» с ratio null для любого score_kind', () => {
    expect(rollupByScoreKind('primary', null, 45)).toEqual({
      main: '—',
      sub: null,
      suffix: null,
      ratio: null,
      markTag: false,
    });
  });

  it('primary: «raw/max» + суффикс «б», дробь через запятую (RU)', () => {
    expect(rollupByScoreKind('primary', 23, 45)).toEqual({
      main: '23/45',
      sub: null,
      suffix: 'б',
      ratio: 23 / 45,
      markTag: false,
    });
    expect(rollupByScoreKind('primary', 2.5, 5).main).toBe('2,5/5');
  });

  it('ege_scaled: sub «≈N ЕГЭ» из таблицы', () => {
    expect(rollupByScoreKind('ege_scaled', 21, 45)).toEqual({
      main: '21/45',
      sub: '≈59 ЕГЭ',
      suffix: null,
      ratio: 21 / 45,
      markTag: false,
    });
  });

  it('oge_grade: sub «оценка N» по полосам ФИПИ', () => {
    expect(rollupByScoreKind('oge_grade', 30, 39)).toEqual({
      main: '30/39',
      sub: 'оценка 5',
      suffix: null,
      ratio: 30 / 39,
      markTag: false,
    });
    expect(rollupByScoreKind('oge_grade', 9, 39).sub).toBe('оценка 2');
  });

  it('school_grade: цельная оценка без «/max», markTag, фолбэк ratio по 5-балльной', () => {
    expect(rollupByScoreKind('school_grade', 4, 5)).toEqual({
      main: '4',
      sub: null,
      suffix: null,
      ratio: 4 / 5,
      markTag: true,
    });
    // rawMax <= 0 → ratio считается от 5-балльной шкалы (ветка raw / 5 в коде).
    expect(rollupByScoreKind('school_grade', 4, 0).ratio).toBe(4 / 5);
  });

  it('rawMax <= 0 у дробных шкал → ratio null (цвета нет), main всё равно рисуется', () => {
    expect(rollupByScoreKind('primary', 3, 0)).toMatchObject({
      main: '3/0',
      ratio: null,
    });
  });
});

// Дрейф ловим на данных, не на diff'е исходников: логическая идентичность —
// это одинаковые ВЫХОДЫ. rollupByScoreKind в зеркале отсутствует НАМЕРЕННО
// (заголовок зеркала: «Native-unit rollup FORMATTING lives frontend-only») —
// parity сравнивает то, что живёт в обоих файлах: таблицу, lookup и ogeMark.
describe('parity с Deno-зеркалом (_shared/score-scales.ts)', () => {
  it('таблица EGE_PHYS_2026 идентична (map, max_primary, thresholds, scale_year)', () => {
    expect(EGE_DENO.map).toEqual([...EGE_PHYS_2026.map]);
    expect(EGE_DENO.max_primary).toBe(EGE_PHYS_2026.max_primary);
    expect(EGE_DENO.thresholds).toEqual(EGE_PHYS_2026.thresholds);
    expect(EGE_DENO.scale_year).toBe(EGE_PHYS_2026.scale_year);
  });

  it('egePrimaryToScaled совпадает на каждом первичном балле 0..45 и краях', () => {
    const vectors = [null, undefined, Number.NaN, -3, 20.6, 50];
    for (let p = 0; p <= 45; p++) {
      expect(egePrimaryToScaledDeno(p)).toBe(egePrimaryToScaled(p));
    }
    for (const v of vectors) {
      expect(egePrimaryToScaledDeno(v)).toBe(egePrimaryToScaled(v));
    }
  });

  it('ogeMark совпадает на границах всех полос и edge-входах', () => {
    const raws = [0, 9, 9.4, 9.5, 10, 19, 20, 29, 30, 39, -3, null, Number.NaN];
    for (const r of raws) {
      expect(ogeMarkDeno(r, 39)).toBe(ogeMark(r, 39));
    }
    expect(ogeMarkDeno(15, 0)).toBe(ogeMark(15, 0));
  });
});
