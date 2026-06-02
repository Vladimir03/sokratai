/* ============================================================
   SokratAI · «Успеваемость» — cross-student data (→ window.USP)
   Scale-agnostic list: NO raw score. Comparable columns only.
   TWO distinct signals, not one «внимание»:
     · backlog  — требует МОЕЙ проверки (на проверке / просрочки)
     · risk     — УЧЕНИК отстаёт (далеко от цели и/или падает динамика)
   ~62 students across groups → proves it doesn't lag at 50+ (Эмилия).
   ============================================================ */
(function () {
  // gendered pools so surname agrees with given name (no «Платон Белова»)
  const MALE_FIRST = ['Дима','Илья','Пётр','Никита','Артём','Глеб','Тимур','Егор','Кирилл','Миша','Лёша','Рома','Денис','Гриша','Захар','Фёдор','Лев','Марк','Ян','Богдан','Влад','Семён','Гордей','Тихон','Матвей','Демид','Платон','Савва','Серафим'];
  const FEMALE_FIRST = ['Маша','Аня','Катя','Вика','Лиза','Соня','Рита','Полина','Даша','Настя','Юля','Оля','Вера','Алиса','Майя','Нина','Зоя','Ася','Камилла','Стеша','Ева','Таня','Аля','Варя','Лада','Уля','Злата','Аделина'];
  const MALE_LAST = ['Волков','Мартынов','Петров','Гурьев','Левин','Соколов','Рахманов','Фомин','Морозов','Тихонов','Балин','Сухов','Панин','Ершов','Гущин','Розов','Шилов','Юдин','Орехов','Котов','Назаров','Лавров','Беляков','Седов'];
  const FEMALE_LAST = ['Волкова','Лисицына','Крылова','Яковлева','Зайцева','Белова','Громова','Седова','Власова','Нечаева','Орехова','Котова','Лаврова','Назарова','Соколова','Морозова','Громыко','Седых'];

  const GROUPS = [
    { id: 'g1', name: 'Физика ЕГЭ · ср/пт 18:00', stream: 'ЕГЭ' },
    { id: 'g2', name: 'Математика ОГЭ · вт/чт 17:00', stream: 'ОГЭ' },
    { id: 'g3', name: 'Информатика ЕГЭ · пн/чт 19:00', stream: 'ЕГЭ' },
    { id: 'g4', name: 'Физика ЕГЭ · сб 11:00', stream: 'ЕГЭ' },
    { id: 'g5', name: 'Математика ОГЭ · сб 13:00', stream: 'ОГЭ' },
    { id: null, name: 'Без группы', stream: 'Школа' },
  ];

  // deterministic PRNG → stable list across reloads
  let seed = 20260601;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

  const GRADE = { 'ЕГЭ': ['11 класс', '11 класс', '10 класс'], 'ОГЭ': ['9 класс'], 'Школа': ['8 класс', '7 класс', '9 класс'] };
  // exam-track students face a hard external deadline → being behind is a real risk
  const examTrack = (stream) => stream === 'ЕГЭ' || stream === 'ОГЭ';
  const BEHIND = 50; // % к цели below this = отстаёт

  function compute(s) {
    s.behind = s.goalPct < BEHIND;
    // risk (retention): behind, OR mildly-behind with a falling trend. Exam track amplifies.
    s.risk = s.behind || (s.goalPct < 62 && s.trend < 0 && examTrack(s.stream));
    s.backlog = s.reviewN > 0 || s.overdue;
    // risk reason
    if (s.risk) {
      const bits = [s.behind ? 'отстаёт от цели' : 'близко к срыву цели'];
      if (s.trend < 0) bits.push('динамика ↓');
      s.riskReason = bits.join(' · ');
    } else s.riskReason = null;
    // backlog reason
    if (s.reviewN > 0 && s.overdue) s.backlogReason = `${s.reviewN} на проверке · просрочка`;
    else if (s.reviewN > 0) s.backlogReason = `${s.reviewN} ${plural(s.reviewN, 'работа', 'работы', 'работ')} на проверке`;
    else if (s.overdue) s.backlogReason = 'есть просрочка';
    else s.backlogReason = null;
    // composite priority: risk dominates backlog (Elena's retention lens)
    s.attnScore = (s.risk ? 10000 + (100 - s.goalPct) * 10 + (s.trend < 0 ? 300 : 0) : 0)
                + (s.backlog ? s.reviewN * 10 + (s.overdue ? 25 : 0) : 0);
    return s;
  }

  const STUDENTS = [];
  let n = 0;
  const perGroup = [14, 12, 11, 9, 8, 8];
  GROUPS.forEach((g, gi) => {
    for (let k = 0; k < perGroup[gi]; k++) {
      const stream = g.stream;
      const male = (n * 5 + gi) % 2 === 0;
      const first = male ? MALE_FIRST[(n * 7) % MALE_FIRST.length] : FEMALE_FIRST[(n * 7) % FEMALE_FIRST.length];
      const last = male ? MALE_LAST[(n * 11) % MALE_LAST.length] : FEMALE_LAST[(n * 11) % FEMALE_LAST.length];
      const goalPct = ri(28, 99);
      const checkedPct = ri(45, 100);
      const reviewN = rnd() < 0.40 ? ri(1, 6) : 0;
      const overdue = rnd() < 0.24;
      const trend = (() => { const r = rnd(); return r < 0.24 ? -1 : r < 0.58 ? 0 : 1; })();
      STUDENTS.push(compute({
        id: 's' + n, name: first + ' ' + last, stream, grade: GRADE[stream][(n) % GRADE[stream].length],
        groupId: g.id, groupName: g.name, goalPct, checkedPct, reviewN, overdue, trend,
      }));
      n++;
    }
  });

  // pin known hero students + Тимур (disciplined but far behind — the Elena scenario)
  const put = (idx, obj) => { STUDENTS[idx] = compute({ ...STUDENTS[idx], ...obj }); };
  put(0, { id: 'ege', name: 'Маша Короленко', stream: 'ЕГЭ', grade: '11 класс', groupId: 'g1', groupName: 'Физика ЕГЭ · ср/пт 18:00', goalPct: 64, checkedPct: 71, reviewN: 3, overdue: true, trend: 1, track: 'ege' });
  // Тимур: 31% к цели, 68% проверено — дисциплинирован, но сильно отстаёт → должен гореть как risk
  put(3, { id: 'timur', name: 'Тимур Гурьев', stream: 'ЕГЭ', grade: '11 класс', groupId: 'g1', groupName: 'Физика ЕГЭ · ср/пт 18:00', goalPct: 31, checkedPct: 68, reviewN: 0, overdue: false, trend: -1 });
  const og = STUDENTS.findIndex(s => s.groupId === 'g2');
  put(og, { id: 'oge', name: 'Костя Лебедев', stream: 'ОГЭ', grade: '9 класс', groupId: 'g2', groupName: 'Математика ОГЭ · вт/чт 17:00', goalPct: 78, checkedPct: 88, reviewN: 1, overdue: false, trend: 1, track: 'oge' });
  const scIdx = STUDENTS.findIndex(s => s.groupId === null);
  put(scIdx, { id: 'school', name: 'Аня Орлова', stream: 'Школа', grade: '8 класс', groupId: null, groupName: 'Без группы', goalPct: 55, checkedPct: 100, reviewN: 0, overdue: false, trend: 1, track: 'school' });

  function plural(num, one, few, many) {
    const a = num % 10, b = num % 100;
    if (a === 1 && b !== 11) return one;
    if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return few;
    return many;
  }

  window.USP = { STUDENTS, GROUPS, plural, BEHIND };
})();
