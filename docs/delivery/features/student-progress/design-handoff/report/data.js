/* ============================================================
   SokratAI · №4 «Отчёт родителю» /p/:slug  (→ window.RPT)
   Built ON the landing «Еженедельный отчёт родителю» concept:
   карта тем (зелёная/жёлтая/красная) · динамика балла · прогноз · последние ДЗ.
   Adapted to product:
     · track-aware native scale (ЕГЭ test-балл / ОГЭ·школа оценка)
     · ONLY confirmed works carry a number; «на проверке» = status, no score
     · forecast = deterministic linear tempo, marked «≈»
     · anti-leak: no solutions / rubrics / hints / AI verdicts
   ============================================================ */
(function () {
  // ── deterministic linear forecast from the trend series ──
  // slope per period × weeksLeft, with a conservative low bound (×0.65).
  function forecastBand(series, weeksLeft, lo, hi) {
    const n = series.length;
    const slope = (series[n - 1] - series[0]) / (n - 1);
    let a = series[n - 1] + slope * weeksLeft * 0.65;
    let b = series[n - 1] + slope * weeksLeft;
    const clamp = (x) => Math.max(lo, Math.min(hi, x));
    return [clamp(a), clamp(b)];
  }
  // ЕГЭ band → rounded ints; оценка band → rounded 2..5, deduped.
  function forecastText(track) {
    const t = track.trend;
    const [a, b] = forecastBand(t.series, track.weeksLeft, t.axisLo, t.axisHi);
    if (track.unit === 'ege') {
      const lo = Math.round(a), hi = Math.round(b);
      return lo === hi ? `≈${hi}` : `≈${lo}–${hi}`;
    }
    const lo = Math.max(2, Math.min(5, Math.round(a)));
    const hi = Math.max(2, Math.min(5, Math.round(b)));
    return lo === hi ? `≈${hi}` : `≈${lo}–${hi}`;
  }
  // delta over a period window (in periods back): 1=неделя, 4=4 недели, full=произвольный
  function deltaOver(series, back) {
    const n = series.length;
    const from = back === 'full' ? 0 : Math.max(0, n - 1 - back);
    return +(series[n - 1] - series[from]).toFixed(1);
  }

  const TUTOR = 'Елена Волкова';

  const TRACKS = {
    ege: {
      slug: 'maria-korolenko-apr', student: 'Маша Короленко', initials: 'МК',
      grade: '11 класс', subject: 'физика ЕГЭ', tutor: TUTOR, unit: 'ege',
      curLabel: 'Текущий балл', curUnit: 'из 100', current: 62, goalTarget: 80,
      forecastLabel: 'Прогноз ЕГЭ', weeksLeft: 10,
      trend: { series: [54, 56, 58, 60, 61, 62], axisLo: 0, axisHi: 100, goalBand: 80, unitWord: 'балл', tickLabels: ['9 мар', '16', '23', '30', '6 апр', 'сейчас'] },
      zones: {
        green: ['Кинематика', 'Статика', 'Механические колебания', 'Гидростатика'],
        yellow: ['Динамика — З. Ньютона', 'Электростатика', 'Постоянный ток'],
        red: ['Магнитное поле', 'Оптика — линзы'],
      },
      recent: [
        { title: 'Кинематика — №18 ЕГЭ', sub: 'Сдал · 4 задачи', confirmed: true, pct: 85 },
        { title: 'Динамика: второй закон', sub: 'Сдал · 5 задач', confirmed: true, pct: 92 },
        { title: 'Законы сохранения', sub: 'На проверке · 6 из 8 задач', confirmed: false, status: 'На проверке' },
        { title: 'Электростатика — поле и потенциал', sub: 'Дедлайн 14 апр', confirmed: false, status: 'Не сдано' },
      ],
      comment: 'Маша заметно подтянула кинематику и динамику — решает увереннее, меньше опирается на подсказки. На ближайшие две недели берём магнитное поле и оптику: это сейчас главный резерв к цели 80. Дома достаточно поддержки и спокойного режима — темп хороший.',
    },
    oge: {
      slug: 'kostya-lebedev-apr', student: 'Костя Лебедев', initials: 'КЛ',
      grade: '9 класс', subject: 'математика ОГЭ', tutor: TUTOR, unit: 'mark',
      curLabel: 'Прогноз оценки', curUnit: 'из 5', current: 4, goalTarget: 5,
      forecastLabel: 'Прогноз ОГЭ', weeksLeft: 8,
      trend: { series: [3, 3, 4, 4, 4, 4], axisLo: 2, axisHi: 5, goalBand: 5, unitWord: 'оценка', tickLabels: ['9 мар', '16', '23', '30', '6 апр', 'сейчас'] },
      zones: {
        green: ['Квадратные уравнения', 'Обыкновенные дроби', 'Проценты'],
        yellow: ['Функции и графики', 'Геометрия: треугольники'],
        red: ['Теория вероятностей'],
      },
      recent: [
        { title: 'Квадратные уравнения', sub: 'Сдал · 6 задач', confirmed: true, pct: 78 },
        { title: 'Пробник ОГЭ — вариант 3', sub: 'Подтверждён · 22 из 31', confirmed: true, pct: 71 },
        { title: 'Геометрия: треугольники', sub: 'На проверке · 3 из 4 задач', confirmed: false, status: 'На проверке' },
      ],
      comment: 'Костя стабильно вышел на «4» по пробникам — уравнения и дроби больше не проседают. Чтобы закрепить «5», работаем над геометрией и теорией вероятностей. Просьба проследить, чтобы ДЗ сдавались до занятия — пару раз сдавал впритык.',
    },
    school: {
      slug: 'anya-orlova-apr', student: 'Аня Орлова', initials: 'АО',
      grade: '8 класс', subject: 'алгебра', tutor: TUTOR, unit: 'mark',
      curLabel: 'Текущая оценка', curUnit: 'из 5', current: 4, goalTarget: 4,
      forecastLabel: 'Прогноз за четверть', weeksLeft: 3,
      trend: { series: [3, 3, 3, 3, 3, 4], axisLo: 2, axisHi: 5, goalBand: 4, unitWord: 'оценка', tickLabels: ['I чет.', '', 'II', '', 'III', 'сейчас'] },
      zones: {
        green: ['Обыкновенные дроби'],
        yellow: ['Линейные функции'],
        red: ['Координатная плоскость'],
      },
      recent: [
        { title: 'Обыкновенные дроби', sub: 'Сдал · 5 задач', confirmed: true, pct: 90 },
        { title: 'Контрольная: действия с дробями', sub: 'Школьная оценка', confirmed: true, pct: 60, markNote: '3' },
        { title: 'Линейные функции', sub: 'На проверке', confirmed: false, status: 'На проверке' },
      ],
      comment: 'Аня вышла на «4» — дроби даются хорошо. Осталась координатная плоскость, на ней и сосредоточимся до конца четверти. Дома важно не давить за оценки: уверенность сейчас растёт, и это главное.',
    },
  };

  // period presets → window length in periods + date label
  const PERIODS = {
    week:  { id: 'week',  label: 'Неделя',     back: 1,      range: '6 — 12 апр 2026' },
    month: { id: 'month', label: '4 недели',   back: 4,      range: '15 мар — 12 апр 2026' },
    custom:{ id: 'custom',label: 'Произвольный',back: 'full', range: '12 фев — 12 апр 2026' },
  };

  window.RPT = { TRACKS, PERIODS, forecastText, deltaOver };
})();
