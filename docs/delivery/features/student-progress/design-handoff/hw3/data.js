/* ============================================================
   SokratAI · №3 «Проверка работы» — галочка-паритет (→ window.HW3)
   Open one homework → tasks with AI verdicts. Per-task confirm,
   bulk «Подтвердить всё, что AI проверил (N)», EditScore, reopen.
   States: на проверке (active) → подтверждено (completed).
   Anti-leak: confirming shows the student ONLY the score + «проверено»;
   the AI rubric/comment, hints and full thread stay tutor-only.
   ============================================================ */
(function () {
  // task: n, max, ai (raw AI score or null=no verdict), aiComment (tutor-only
  // rubric note), hints, verified, override, overrideComment
  const TASKS_LAW = [
    { n: 1, max: 2, ai: 0.5, hints: 2, verified: false,
      aiComment: 'Импульс системы записан верно, но потерян знак скорости тела после удара — итог занижен. Снято за 2 подсказки.' },
    { n: 2, max: 2, ai: 1, hints: 1, verified: false,
      aiComment: 'Закон сохранения энергии применён правильно, арифметическая ошибка при подсчёте кинетической энергии.' },
    { n: 3, max: 2, ai: 0, hints: 3, verified: false,
      aiComment: 'Решение не доведено: нужная формула так и не применена даже после 3 подсказок.' },
    { n: 4, max: 2, ai: 1.5, hints: 0, verified: true,
      aiComment: 'Полное решение, мелкая неточность в единицах измерения.' },
    { n: 5, max: 2, ai: 2, hints: 0, verified: true,
      aiComment: 'Верно и аккуратно, без подсказок.' },
    { n: 6, max: 1, ai: 0, hints: 1, verified: false,
      aiComment: 'Ответ не записан.' },
    { n: 7, max: 2, ai: 0.5, hints: 2, verified: false,
      aiComment: 'Частично: импульс системы записан, но не учтена внешняя сила трения.' },
    { n: 8, max: 1, ai: 1, hints: 0, verified: false,
      aiComment: 'Верно, краткое корректное решение.' },
  ];

  const TASKS_MOCK = [
    { n: 1, max: 1, ai: 1, hints: 0, verified: true, kim: true, aiComment: 'Верный ответ.' },
    { n: 2, max: 1, ai: 1, hints: 0, verified: true, kim: true, aiComment: 'Верный ответ.' },
    { n: 3, max: 2, ai: 2, hints: 0, verified: true, kim: true, aiComment: 'Полное решение.' },
    { n: 4, max: 2, ai: 1, hints: 1, verified: true, kim: true, aiComment: 'Частично: верный подход, ошибка в расчёте.' },
    { n: 5, max: 2, ai: 2, hints: 0, verified: true, kim: true, aiComment: 'Верно.' },
    { n: 6, max: 3, ai: 1, hints: 2, verified: true, kim: true, aiComment: 'Записаны уравнения, не доведено до числа.' },
    { n: 7, max: 3, ai: 2, hints: 0, verified: true, kim: true, aiComment: 'Почти полное, потеряна одна проекция.' },
    { n: 8, max: 4, ai: 3, hints: 0, verified: true, kim: true, aiComment: 'Сильное решение, мелкий недочёт в обосновании.' },
  ];

  // No-AI work: фото-решение, AI не распознал → ручная проверка (ai=null)
  const TASKS_NOAI = [
    { n: 1, max: 2, ai: null, hints: 0, verified: false, aiComment: null },
    { n: 2, max: 2, ai: null, hints: 0, verified: false, aiComment: null },
    { n: 3, max: 2, ai: null, hints: 0, verified: false, aiComment: null },
    { n: 4, max: 2, ai: null, hints: 0, verified: false, aiComment: null },
  ];

  const WORKS = {
    law: {
      id: 'law', kind: 'hw', exam: 'ege', title: 'Законы сохранения',
      student: 'Маша Короленко', studentInitials: 'МК', group: 'Физика ЕГЭ · ср/пт 18:00',
      date: '8 апр', due: 'просрочено 2 дн', overdue: true,
      unit: 'primary', aiGraded: true, kimLabels: false,
      tasks: TASKS_LAW,
    },
    mock: {
      id: 'mock', kind: 'mock', exam: 'ege', title: 'Пробник ЕГЭ — вариант 7',
      student: 'Маша Короленко', studentInitials: 'МК', group: 'Физика ЕГЭ · ср/пт 18:00',
      date: '10 апр', due: 'выполнен', overdue: false,
      unit: 'ege', aiGraded: true, kimLabels: true,
      tasks: TASKS_MOCK,
    },
    noai: {
      id: 'noai', kind: 'hw', exam: 'ege', title: 'Графическая задача (фото-решение)',
      student: 'Маша Короленко', studentInitials: 'МК', group: 'Физика ЕГЭ · ср/пт 18:00',
      date: '3 апр', due: 'сдано в срок', overdue: false,
      unit: 'primary', aiGraded: false, kimLabels: false, noAi: true,
      tasks: TASKS_NOAI,
    },
  };

  // ── helpers ───────────────────────────────────────────────
  function fmt(n) {
    if (n === null || n === undefined) return '—';
    return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
  }
  function taskScore(t) { return (t.override !== undefined && t.override !== null) ? t.override : t.ai; }
  function cellClass(score, max) {
    if (score === null || score === undefined) return 's';
    const r = max > 0 ? score / max : 0;
    if (r < 0.3) return 'r';
    if (r < 0.8) return 'a';
    return 'e';
  }
  // task status: 'verified' | 'review' (ai present, unconfirmed) | 'manual' (no ai)
  function taskStatus(t) {
    if (t.verified) return 'verified';
    if (t.ai === null) return 'manual';
    return 'review';
  }
  function pendingCount(tasks) { return tasks.filter(t => t.ai !== null && !t.verified).length; }
  function manualCount(tasks) { return tasks.filter(t => t.ai === null && !t.verified).length; }
  function verifiedCount(tasks) { return tasks.filter(t => t.verified).length; }

  // native-unit rollup for the whole work (mirrors hero2)
  function rollup(w, tasks) {
    const raw = tasks.reduce((s, t) => { const v = taskScore(t); return s + (v || 0); }, 0);
    const rawMax = tasks.reduce((s, t) => s + t.max, 0);
    if (w.unit === 'ege') {
      // tiny ЕГЭ map proxy (full table lives in hero2/data.js)
      const test = Math.round((raw / rawMax) * 100);
      return { main: `${fmt(raw)}/${rawMax}`, sub: `≈${test} ЕГЭ`, raw, rawMax };
    }
    return { main: `${fmt(raw)}/${rawMax}`, suf: 'б', raw, rawMax };
  }

  window.HW3 = { WORKS, fmt, taskScore, cellClass, taskStatus, pendingCount, manualCount, verifiedCount, rollup };
})();
