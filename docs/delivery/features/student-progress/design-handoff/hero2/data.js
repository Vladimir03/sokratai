/* ============================================================
   SokratAI hero v2 — data model (→ window.HERO2)
   Score scales are NATIVE per work (score_kind), color = % of max.
   3 student profiles to show the goal-card rebuilding per track:
     ege    — Маша, 11 класс, ЕГЭ физика (mix: ДЗ + пробник ЕГЭ + школьная оценка)
     oge    — Костя, 9 класс, ОГЭ математика
     school — Аня, 8 класс, алгебра
   ============================================================ */
(function () {
  // ── ЕГЭ физика: первичный → тестовый балл (официальная таблица ФИПИ 2026) ──
  // Single source of truth. Index = первичный балл, value = тестовый. No interpolation.
  const EGE_PHYS = {
    scale_year: 2026, max_primary: 45,
    thresholds: { attestat: 36, vuz: 39 }, // тест-баллы: порог аттестата / вуза
    map: [0,5,9,14,18,23,27,32,36,39,40,43,44,46,48,49,51,53,54,56,58,
          59,61,62,64,65,67,68,70,71,73,74,76,77,79,80,82,84,86,88,90,
          92,94,96,98,100],
  };
  // Direct lookup: 21 → 59, 23 → 62.
  function convertEge(raw) {
    const i = Math.max(0, Math.min(EGE_PHYS.map.length - 1, Math.round(raw)));
    return EGE_PHYS.map[i];
  }
  // ОГЭ: первичный → оценка (ratio-based for the mock; swap for official thresholds)
  function ogeMark(raw, max) {
    const r = max > 0 ? raw / max : 0;
    if (r < 0.4) return 2;
    if (r < 0.55) return 3;
    if (r < 0.75) return 4;
    return 5;
  }

  const T = (max, ai, verified) => ({ max, ai, verified: !!verified });

  // ── ЕГЭ profile — Маша ─────────────────────────────────────
  const EGE_WORKS = [
    { id: 'e1', kind: 'hw', unit: 'primary', title: 'Кинематика: графики движения',
      exam: 'ege', date: '12 апр', iso: '2026-04-12', due: 'сдано в срок', overdue: false,
      submitted: true, aiGraded: true, raw: 9, rawMax: 12,
      tasks: [ T(2,2,true), T(2,2,true), T(2,1,false), T(2,2,false), T(2,2,true), T(2,0.5,false) ] },
    { id: 'e2', kind: 'mock', unit: 'ege', title: 'Пробник ЕГЭ — вариант 7',
      exam: 'ege', date: '10 апр', iso: '2026-04-10', due: 'подтверждён 10 апр', overdue: false,
      submitted: true, aiGraded: true, raw: 23, rawMax: 45,
      tasks: [ T(1,1,true), T(1,1,true), T(2,2,true), T(2,1,true), T(2,2,true), T(3,1,true), T(3,2,true), T(4,3,true) ], kimLabels: true },
    { id: 'e3', kind: 'hw', unit: 'primary', title: 'Законы сохранения',
      exam: 'ege', date: '8 апр', iso: '2026-04-08', due: 'просрочено 2 дн', overdue: true,
      submitted: true, aiGraded: true, raw: 6, rawMax: 16,
      tasks: [ T(2,0.5,false), T(2,1,false), T(2,0,false), T(2,1.5,true), T(2,2,true), T(1,0,false), T(2,0.5,false), T(1,1,false) ] },
    { id: 'e4', kind: 'manual', unit: 'mark', title: 'Контрольная в школе: механика',
      exam: 'school', date: '7 апр', iso: '2026-04-07', due: 'внешняя оценка', overdue: false,
      submitted: true, aiGraded: false, holistic: true, verified: true, raw: 4, rawMax: 5 },
    { id: 'e5', kind: 'hw', unit: 'primary', title: 'Динамика: второй закон',
      exam: 'ege', date: '5 апр', iso: '2026-04-05', due: 'сдано в срок', overdue: false,
      submitted: true, aiGraded: true, raw: 8.5, rawMax: 10,
      tasks: [ T(2,2,true), T(2,2,true), T(2,1.5,true), T(2,2,true), T(2,1,true) ] },
    { id: 'e6', kind: 'manual', unit: 'primary', title: 'Устный ответ: вывод 2-го закона Ньютона',
      exam: 'ege', date: '4 апр', iso: '2026-04-04', due: 'на занятии', overdue: false,
      submitted: true, aiGraded: false, holistic: true, verified: false, raw: null, rawMax: 5 },
    { id: 'e7', kind: 'hw', unit: 'primary', title: 'Графическая задача (фото-решение)',
      exam: 'ege', date: '3 апр', iso: '2026-04-03', due: 'сдано в срок', overdue: false,
      submitted: true, aiGraded: false, noAi: true, raw: null, rawMax: 8,
      tasks: [ T(2,null,false), T(2,null,false), T(2,null,false), T(2,null,false) ] },
    { id: 'e8', kind: 'hw', unit: 'primary', title: 'Электростатика: поле и потенциал',
      exam: 'ege', date: '2 апр', iso: '2026-04-02', due: 'дедлайн 14 апр', overdue: false,
      submitted: false, aiGraded: false, notSubmitted: true, raw: null, rawMax: 12,
      tasks: [ T(2,null,false), T(2,null,false), T(2,null,false), T(2,null,false), T(2,null,false), T(2,null,false) ] },
  ];

  // ── ОГЭ profile — Костя ────────────────────────────────────
  const OGE_WORKS = [
    { id: 'o1', kind: 'hw', unit: 'primary', title: 'Квадратные уравнения',
      exam: 'oge', date: '11 апр', iso: '2026-04-11', due: 'сдано в срок', overdue: false,
      submitted: true, aiGraded: true, raw: 7, rawMax: 9,
      tasks: [ T(1,1,true), T(1,1,true), T(2,1,false), T(2,2,false), T(1,1,true), T(2,1.5,false) ] },
    { id: 'o2', kind: 'mock', unit: 'oge', title: 'Пробник ОГЭ — вариант 3',
      exam: 'oge', date: '9 апр', iso: '2026-04-09', due: 'подтверждён 9 апр', overdue: false,
      submitted: true, aiGraded: true, raw: 22, rawMax: 31,
      tasks: [ T(1,1,true), T(1,1,true), T(1,0,true), T(1,1,true), T(2,2,true), T(2,1,true), T(2,2,true), T(2,1,true) ], kimLabels: true },
    { id: 'o3', kind: 'manual', unit: 'mark', title: 'Контрольная в школе: функции',
      exam: 'school', date: '7 апр', iso: '2026-04-07', due: 'внешняя оценка', overdue: false,
      submitted: true, aiGraded: false, holistic: true, verified: true, raw: 4, rawMax: 5 },
    { id: 'o4', kind: 'hw', unit: 'primary', title: 'Геометрия: треугольники',
      exam: 'oge', date: '5 апр', iso: '2026-04-05', due: 'сдано в срок', overdue: false,
      submitted: true, aiGraded: true, raw: 5, rawMax: 8,
      tasks: [ T(2,1,false), T(2,1.5,false), T(2,2,true), T(2,1,false) ] },
  ];

  // ── School profile — Аня ───────────────────────────────────
  const SCHOOL_WORKS = [
    { id: 's1', kind: 'hw', unit: 'primary', title: 'Обыкновенные дроби',
      exam: 'school', date: '12 апр', iso: '2026-04-12', due: 'сдано в срок', overdue: false,
      submitted: true, aiGraded: true, raw: 9, rawMax: 10,
      tasks: [ T(2,2,true), T(2,2,true), T(2,1.5,true), T(2,2,true), T(2,1.5,true) ] },
    { id: 's2', kind: 'manual', unit: 'mark', title: 'Контрольная: действия с дробями',
      exam: 'school', date: '9 апр', iso: '2026-04-09', due: 'школьная оценка', overdue: false,
      submitted: true, aiGraded: false, holistic: true, verified: true, raw: 3, rawMax: 5 },
    { id: 's3', kind: 'hw', unit: 'primary', title: 'Линейные функции',
      exam: 'school', date: '6 апр', iso: '2026-04-06', due: 'сдано в срок', overdue: false,
      submitted: true, aiGraded: true, raw: 6, rawMax: 10,
      tasks: [ T(2,1,false), T(2,1.5,false), T(2,2,true), T(2,1,false), T(2,0.5,false) ] },
  ];

  const PROFILES = {
    ege: {
      key: 'ege', name: 'Маша Короленко', initials: 'МК', grade: '11 класс',
      stream: 'ЕГЭ физика', group: 'Группа «Физика · ср/пт 18:00»',
      goal: { unit: 'ege', label: 'Тестовый балл ЕГЭ', noun: 'балл',
        current: 62, target: 80, floor: 30, ceil: 100, approx: true,
        thresholds: [ { v: 36, label: 'аттестат' }, { v: 39, label: 'вуз' } ],
        spark: [54, 56, 58, 62], sparkLabels: ['фев', 'мар', 'нач. апр', 'сейчас'],
        note: 'по 4 пробникам · до экзамена ~7 недель' },
      works: EGE_WORKS,
    },
    oge: {
      key: 'oge', name: 'Костя Лебедев', initials: 'КЛ', grade: '9 класс',
      stream: 'ОГЭ математика', group: 'Группа «Математика ОГЭ · вт/чт 17:00»',
      goal: { unit: 'mark', label: 'Прогноз оценки ОГЭ', noun: 'оценка',
        current: 4, target: 5, floor: 2, ceil: 5, approx: true,
        spark: [3, 3, 4, 4], sparkLabels: ['фев', 'мар', 'нач. апр', 'сейчас'],
        note: 'по пробникам ОГЭ · нужно стабильно держать «4»' },
      works: OGE_WORKS,
    },
    school: {
      key: 'school', name: 'Аня Орлова', initials: 'АО', grade: '8 класс',
      stream: 'Школа · алгебра', group: 'Индивидуально · пн 16:00',
      goal: { unit: 'mark', label: 'Оценка за четверть', noun: 'оценка',
        current: 3, target: 4, floor: 2, ceil: 5, approx: false,
        spark: [3, 3, 3, 4], sparkLabels: ['I чет.', 'II чет.', 'III чет.', 'сейчас'],
        note: 'подтянуть до «4» к концу четверти' },
      works: SCHOOL_WORKS,
    },
  };

  // ── helpers ───────────────────────────────────────────────
  function cellClass(score, max) {
    if (score === null || score === undefined) return 's';
    const r = max > 0 ? score / max : 0;
    if (r < 0.3) return 'r';
    if (r < 0.8) return 'a';
    return 'e';
  }
  function fmt(n) {
    if (n === null || n === undefined) return '—';
    return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
  }
  function cellText(score) { return (score === null || score === undefined) ? '—' : fmt(score); }
  function taskScore(t) { return (t.override !== undefined && t.override !== null) ? t.override : t.ai; }

  function workState(w) {
    if (w.notSubmitted) return { kind: 'none', n: 0 };
    if (w.holistic) return w.verified ? { kind: 'verified', n: 0 } : { kind: 'manual', n: 1 };
    if (w.noAi) {
      const open = w.tasks.filter(t => !t.verified).length;
      return open > 0 ? { kind: 'manual', n: open } : { kind: 'verified', n: 0 };
    }
    const pending = w.tasks.filter(t => t.ai !== null && !t.verified).length;
    return pending > 0 ? { kind: 'review', n: pending } : { kind: 'verified', n: 0 };
  }
  function bulkCount(works) {
    return works.reduce((s, w) => {
      if (w.notSubmitted || w.noAi || w.holistic) return s;
      return s + w.tasks.filter(t => t.ai !== null && !t.verified).length;
    }, 0);
  }

  // Native-unit rollup. Returns { main, suf, sub, ratio, markTag }
  function rollup(w) {
    if (w.notSubmitted || w.raw === null || w.raw === undefined) return { main: '—', ratio: null };
    switch (w.unit) {
      case 'ege':
        return { main: `${w.raw}/${w.rawMax}`, sub: `≈${convertEge(w.raw)} ЕГЭ`, ratio: w.raw / w.rawMax };
      case 'oge':
        return { main: `${w.raw}/${w.rawMax}`, sub: `оценка ${ogeMark(w.raw, w.rawMax)}`, ratio: w.raw / w.rawMax };
      case 'mark':
        return { main: `${w.raw}`, markTag: true, ratio: w.raw / 5 };
      default: // primary
        return { main: `${fmt(w.raw)}/${w.rawMax}`, suf: 'б', ratio: w.raw / w.rawMax };
    }
  }

  // exam chip {label, icon} — neutral, icon differentiates (no color, per rule 90)
  const EXAM = {
    ege:    { label: 'ЕГЭ',   icon: 'graduation-cap' },
    oge:    { label: 'ОГЭ',   icon: 'graduation-cap' },
    school: { label: 'Школа', icon: 'school' },
  };

  window.HERO2 = {
    PROFILES, EXAM, EGE_PHYS,
    convertEge, ogeMark, cellClass, cellText, fmt, taskScore, workState, bulkCount, rollup,
  };
})();
