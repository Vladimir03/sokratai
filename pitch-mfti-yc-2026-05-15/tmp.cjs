// Сократ AI — питч-дек для Pizza Pitch МФТИ × Yandex Cloud, 15 мая 2026
// Запуск: NODE_PATH=/sessions/pensive-confident-faraday/mnt/outputs/node_modules node build-deck.js
const pptxgen = require("pptxgenjs");

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.333 × 7.5"
pres.author = "Vladimir Kamchatkin / SokratAI";
pres.title = "Сократ AI — AI-агент для репетиторов физики ЕГЭ";
pres.company = "SokratAI";

// ─────────── Design tokens ───────────
const C = {
  green: "1B6B4A",
  greenDark: "0F3D2C",
  greenLight: "DCFCE7",
  ochre: "E8913A",
  ochreDark: "C76F1F",
  cream: "F7F6F3",
  white: "FFFFFF",
  text: "0F172A",
  textMuted: "64748B",
  textLight: "94A3B8",
  border: "E2E8F0",
  bgLight: "F8FAFC",
  red: "DC2626",
  amber: "F59E0B",
};

const F = { head: "Calibri", body: "Calibri" };

const W = 13.333;
const H = 7.5;

// Fresh shadow factory (don't reuse objects — pptxgenjs mutates them)
const softShadow = () => ({
  type: "outer", color: "000000", blur: 10, offset: 3, angle: 135, opacity: 0.08,
});
const strongShadow = () => ({
  type: "outer", color: "000000", blur: 14, offset: 4, angle: 135, opacity: 0.15,
});

function addEyebrow(slide, text, x, y, color = C.green) {
  slide.addText(text, {
    x, y, w: 6, h: 0.3,
    fontSize: 11, fontFace: F.head, bold: true,
    color, charSpacing: 6, margin: 0,
  });
}

function addTitle(slide, text, x, y, w = 12.3, color = C.text, size = 36) {
  slide.addText(text, {
    x, y, w, h: 0.9,
    fontSize: size, fontFace: F.head, bold: true,
    color, margin: 0, valign: "top",
  });
}

function addSubtitle(slide, text, x, y, w = 12.3, color = C.textMuted, size = 15) {
  slide.addText(text, {
    x, y, w, h: 0.6,
    fontSize: size, fontFace: F.body, color, margin: 0, valign: "top",
  });
}

function addSlideNumber(slide, n, total = 12) {
  slide.addText(`${n} / ${total}`, {
    x: W - 1.0, y: H - 0.45, w: 0.7, h: 0.3,
    fontSize: 9, fontFace: F.body, color: C.textLight,
    align: "right", margin: 0,
  });
  slide.addText("sokratai.ru", {
    x: 0.5, y: H - 0.45, w: 2.0, h: 0.3,
    fontSize: 9, fontFace: F.body, color: C.green, bold: true,
    align: "left", margin: 0,
  });
}

// ═══════════════════════════════════════════
// SLIDE 1 — TITLE
// ═══════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.greenDark };

  s.addText("sokratai.ru", {
    x: W - 2.0, y: 0.4, w: 1.5, h: 0.3,
    fontSize: 12, fontFace: F.body, color: C.ochre, bold: true,
    align: "right", margin: 0,
  });

  s.addText("AI-АГЕНТ ДЛЯ РЕПЕТИТОРОВ", {
    x: 0.8, y: 2.2, w: 8, h: 0.4,
    fontSize: 14, fontFace: F.head, bold: true,
    color: C.ochre, charSpacing: 8, margin: 0,
  });

  s.addText("Сократ AI", {
    x: 0.8, y: 2.7, w: 10, h: 1.5,
    fontSize: 88, fontFace: F.head, bold: true, color: C.white, margin: 0,
  });

  s.addText("Проверяет рукописные ДЗ. Ведёт ученика. Собирает базу задач.", {
    x: 0.8, y: 4.4, w: 11.5, h: 0.8,
    fontSize: 26, fontFace: F.head, color: C.white, margin: 0, valign: "top",
  });

  s.addText("Физика, Математика · ЕГЭ, ОГЭ. Сегодня — 3 платящих репетитора. Завтра — 1 000.", {
    x: 0.8, y: 5.2, w: 11.5, h: 0.6,
    fontSize: 18, fontFace: F.body, italic: true, color: "B8E0CD", margin: 0,
  });

  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.8, y: 6.6, w: 0.06, h: 0.4, fill: { color: C.ochre }, line: { color: C.ochre },
  });
  s.addText([
    { text: "Pizza Pitch МФТИ × Yandex Cloud", options: { bold: true, color: C.white, breakLine: true } },
    { text: "15 мая 2026 · Владимир Камчаткин, CEO", options: { color: "B8E0CD" } },
  ], {
    x: 1.0, y: 6.6, w: 11, h: 0.6, fontSize: 12, fontFace: F.body, margin: 0,
  });
}

// ═══════════════════════════════════════════
// SLIDE 2 — PROBLEM
// ═══════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };

  addEyebrow(s, "ПРОБЛЕМА", 0.6, 0.5);
  addTitle(s, "Проверка ДЗ съедает рабочее время репетитора", 0.6, 0.85);
  addSubtitle(s, "Три боли, которые держат рынок частного репетиторства в технологическом средневековье.", 0.6, 1.65);

  const cards = [
    { num: "3+ часа", label: "В НЕДЕЛЮ", body: "ручной проверки ДЗ группы из 10 учеников. Репетитор теряет оплачиваемые часы — 4 500–6 000 ₽ прямого недополученного дохода в неделю." },
    { num: "ChatGPT", label: "= СПИСЫВАНИЕ", body: "ученики используют LLM как ГДЗ. Решения «правильные», но метод не запоминают. Балл ЕГЭ не растёт — репетитор виноват." },
    { num: "Выгорание", label: "И ОТТОК", body: "репетитор не может масштабироваться. Больше учеников → падает качество → уходят. Меньше → не дотягивает по доходу." },
  ];

  const cardW = 3.9, cardH = 3.4, cardY = 2.5, gap = 0.25;
  const startX = (W - (cardW * 3 + gap * 2)) / 2;

  cards.forEach((c, i) => {
    const x = startX + i * (cardW + gap);
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: cardY, w: cardW, h: cardH,
      fill: { color: C.cream }, line: { color: C.border, width: 1 },
      shadow: softShadow(),
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: cardY, w: 0.08, h: cardH, fill: { color: C.red }, line: { color: C.red },
    });
    s.addText(c.num, {
      x: x + 0.35, y: cardY + 0.4, w: cardW - 0.5, h: 0.9,
      fontSize: 40, fontFace: F.head, bold: true, color: C.text, margin: 0,
    });
    s.addText(c.label, {
      x: x + 0.35, y: cardY + 1.35, w: cardW - 0.5, h: 0.4,
      fontSize: 14, fontFace: F.head, bold: true, color: C.red, charSpacing: 3, margin: 0,
    });
    s.addText(c.body, {
      x: x + 0.35, y: cardY + 1.85, w: cardW - 0.6, h: cardH - 2.0,
      fontSize: 13, fontFace: F.body, color: C.text, margin: 0, valign: "top",
    });
  });

  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.6, y: 6.4, w: W - 1.2, h: 0.55,
    fill: { color: C.greenLight }, line: { color: C.greenLight },
  });
  s.addText([
    { text: "Каждая вторая ", options: { bold: true } },
    { text: "российская семья школьника платит репетитору. Конкуренция за репетиторов " },
    { text: "+63% YoY", options: { bold: true } },
    { text: " (Q1 2026). Траты на репетиторов выросли на " },
    { text: "+80% за 5 лет", options: { bold: true } },
    { text: "." },
  ], {
    x: 0.8, y: 6.4, w: W - 1.6, h: 0.55,
    fontSize: 13, fontFace: F.body, color: C.greenDark, valign: "middle", margin: 0,
  });

  addSlideNumber(s, 2);
}

// ═══════════════════════════════════════════
// SLIDE 3 — SOLUTION
// ═══════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };

  addEyebrow(s, "РЕШЕНИЕ", 0.6, 0.5);
  addTitle(s, "Три AI-агента в одном рабочем процессе репетитора", 0.6, 0.85);
  addSubtitle(s, "Сократ AI делает работу, за которую репетитору не платят, — чтобы он зарабатывал на той, за которую платят.", 0.6, 1.65);

  const agents = [
    { tag: "АГЕНТ 1", name: "AI-проверка рукописных ДЗ", stat: "3 ч → 40 мин",
      body: "Ученик присылает фото решения в Сократе AI. AI распознаёт формулы, дроби, векторы, графики. Точность OCR ~92%. Классификация ошибок: вычислительные vs концептуальные, с привязкой к кодификатору ФИПИ." },
    { tag: "АГЕНТ 2", name: "Сократовский диалог", stat: "Наводит, не подсказывает",
      body: "Управляемый чат по конкретной задаче. AI ведёт ученика наводящими вопросами вместо готовых ответов. Защита от утечки эталонного решения — Сократ AI принципиально не даёт списать." },
    { tag: "АГЕНТ 3", name: "Конструктор ДЗ", stat: "5 минут вместо часа",
      body: "База задач (Демидова, ФИПИ-демоверсии) + личный архив репетитора + AI-генерация похожих задач одним кликом. Шаблоны, шеринг, аналитика по ученикам." },
  ];

  const cardW = 3.95, cardH = 4.0, cardY = 2.4, gap = 0.22;
  const startX = (W - (cardW * 3 + gap * 2)) / 2;

  agents.forEach((a, i) => {
    const x = startX + i * (cardW + gap);
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: cardY, w: cardW, h: cardH,
      fill: { color: C.white }, line: { color: C.border, width: 1 },
      shadow: softShadow(),
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: cardY, w: cardW, h: 0.08, fill: { color: C.green }, line: { color: C.green },
    });
    s.addText(a.tag, {
      x: x + 0.35, y: cardY + 0.3, w: cardW - 0.5, h: 0.3,
      fontSize: 10, fontFace: F.head, bold: true, color: C.ochre, charSpacing: 6, margin: 0,
    });
    s.addText(a.name, {
      x: x + 0.35, y: cardY + 0.65, w: cardW - 0.5, h: 0.9,
      fontSize: 20, fontFace: F.head, bold: true, color: C.text, margin: 0, valign: "top",
    });
    s.addText(a.stat, {
      x: x + 0.35, y: cardY + 1.3, w: cardW - 0.5, h: 0.5,
      fontSize: 17, fontFace: F.head, bold: true, color: C.green, margin: 0,
    });
    s.addText(a.body, {
      x: x + 0.35, y: cardY + 1.9, w: cardW - 0.6, h: cardH - 2.1,
      fontSize: 12, fontFace: F.body, color: C.text, margin: 0, valign: "top",
    });
  });

  s.addText("Репетитор продаёт работу. Сократ AI её делает.", {
    x: 0.6, y: 6.7, w: W - 1.2, h: 0.45,
    fontSize: 16, fontFace: F.head, italic: true, bold: true,
    color: C.ochre, align: "center", margin: 0,
  });

  addSlideNumber(s, 3);
}

// ═══════════════════════════════════════════
// SLIDE 4 — HOW IT WORKS
// ═══════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };

  addEyebrow(s, "КАК РАБОТАЕТ", 0.6, 0.5);
  addTitle(s, "От задачи в базе до балла ЕГЭ — 4 шага", 0.6, 0.85);
  addSubtitle(s, "Замкнутый процесс между репетитором и учеником. AI везде, где раньше уходило время вручную.", 0.6, 1.65);

  const steps = [
    { n: "01", title: "Репетитор собирает ДЗ", body: "Из общей базы Демидова, личного архива или AI-генерация похожих задач. 5 минут." },
    { n: "02", title: "Ученик решает", body: "Веб-приложение или Telegram-бот. Присылает фото рукописного решения." },
    { n: "03", title: "AI ведёт диалог", body: "Сократовский разбор по шагам. AI читает фото, проверяет, задаёт наводящие вопросы." },
    { n: "04", title: "Репетитор получает аналитику", body: "Карта ошибок по кодификатору ФИПИ. Видит, где ученик буксует." },
  ];

  const cardW = 2.95, cardH = 4.2, cardY = 2.4, gap = 0.15;
  const startX = (W - (cardW * 4 + gap * 3)) / 2;

  steps.forEach((step, i) => {
    const x = startX + i * (cardW + gap);
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: cardY, w: cardW, h: cardH,
      fill: { color: C.bgLight }, line: { color: C.border, width: 1 },
      shadow: softShadow(),
    });
    s.addText(step.n, {
      x: x + 0.3, y: cardY + 0.4, w: cardW - 0.5, h: 1.5,
      fontSize: 60, fontFace: F.head, bold: true, color: C.green, margin: 0,
    });
    s.addText(step.title, {
      x: x + 0.3, y: cardY + 1.65, w: cardW - 0.6, h: 0.8,
      fontSize: 16, fontFace: F.head, bold: true, color: C.text, margin: 0, valign: "top",
    });
    s.addText(step.body, {
      x: x + 0.3, y: cardY + 2.5, w: cardW - 0.6, h: cardH - 2.65,
      fontSize: 12, fontFace: F.body, color: C.textMuted, margin: 0, valign: "top",
    });

    if (i < steps.length - 1) {
      const arrowX = x + cardW + 0.02;
      s.addText("→", {
        x: arrowX, y: cardY + 1.6, w: 0.15, h: 0.5,
        fontSize: 24, fontFace: F.head, bold: true, color: C.ochre,
        align: "center", valign: "middle", margin: 0,
      });
    }
  });

  addSlideNumber(s, 4);
}

// ═══════════════════════════════════════════
// SLIDE 5 — TRACTION
// ═══════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };

  addEyebrow(s, "TRACTION", 0.6, 0.5);
  addTitle(s, "Из бесплатного апрельского пилота — к платным в мае", 0.6, 0.85);
  addSubtitle(s, "MVP в марте, бесплатный пилот в апреле, первая выручка в мае. Каждый платящий — органический референс от Егора Блинова.", 0.6, 1.65);

  const stats = [
    { num: "3 + 6 + 4", unit: "PAID · TRIAL · FREE", label: "13 активных репетиторов · 0 churn" },
    { num: "4 000 ₽", unit: "MRR", label: "май 2026 · первая выручка" },
    { num: "1 886", unit: "AI-СООБЩЕНИЙ", label: "из них 1 310 за последние 30 дней" },
    { num: "542", unit: "ЗАДАЧ РЕШЕНО", label: "3.5 AI-сообщений на задачу · глубокий разбор" },
  ];

  const statW = 3.0, statH = 2.1, statY = 2.4, sgap = 0.13;
  const sStartX = (W - (statW * 4 + sgap * 3)) / 2;

  stats.forEach((stat, i) => {
    const x = sStartX + i * (statW + sgap);
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: statY, w: statW, h: statH,
      fill: { color: C.greenDark }, line: { color: C.greenDark },
      shadow: strongShadow(),
    });
    s.addText(stat.num, {
      x: x + 0.2, y: statY + 0.25, w: statW - 0.4, h: 0.95,
      fontSize: 44, fontFace: F.head, bold: true, color: C.white, margin: 0,
    });
    s.addText(stat.unit, {
      x: x + 0.2, y: statY + 1.15, w: statW - 0.4, h: 0.35,
      fontSize: 12, fontFace: F.head, bold: true, color: C.ochre, charSpacing: 3, margin: 0,
    });
    s.addText(stat.label, {
      x: x + 0.2, y: statY + 1.5, w: statW - 0.4, h: 0.55,
      fontSize: 11, fontFace: F.body, color: "B8E0CD", margin: 0, valign: "top",
    });
  });

  s.addText("ROADMAP — ОТ MVP К ПЛАТНОМУ ПИЛОТУ", {
    x: 0.6, y: 4.95, w: W - 1.2, h: 0.3,
    fontSize: 11, fontFace: F.head, bold: true, color: C.green,
    charSpacing: 4, margin: 0,
  });

  const milestones = [
    { mo: "МАРТ 2026", title: "MVP", body: "Запустили базовый конструктор ДЗ + Telegram-бот." },
    { mo: "АПРЕЛЬ 2026", title: "Бесплатный пилот", body: "Подключили репетиторов в режиме тестирования." },
    { mo: "МАЙ 2026", title: "Первая выручка", body: "3 репетитора на платном тарифе. 4 000 ₽ MRR." },
    { mo: "ИЮНЬ–СЕНТЯБРЬ 2026", title: "Цель: 30 платящих", body: "Подготовка к учебному году 2026/27. ×10 рост платящей базы." },
  ];

  const mW = 3.0, mH = 1.7, mY = 5.35, mgap = 0.13;
  const mStartX = (W - (mW * 4 + mgap * 3)) / 2;

  milestones.forEach((m, i) => {
    const x = mStartX + i * (mW + mgap);
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: mY, w: mW, h: mH,
      fill: { color: C.cream }, line: { color: C.border, width: 1 },
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: mY, w: 0.06, h: mH, fill: { color: C.ochre }, line: { color: C.ochre },
    });
    s.addText(m.mo, {
      x: x + 0.25, y: mY + 0.15, w: mW - 0.4, h: 0.3,
      fontSize: 10, fontFace: F.head, bold: true, color: C.ochre, charSpacing: 3, margin: 0,
    });
    s.addText(m.title, {
      x: x + 0.25, y: mY + 0.45, w: mW - 0.4, h: 0.4,
      fontSize: 14, fontFace: F.head, bold: true, color: C.text, margin: 0,
    });
    s.addText(m.body, {
      x: x + 0.25, y: mY + 0.9, w: mW - 0.4, h: 0.75,
      fontSize: 11, fontFace: F.body, color: C.textMuted, margin: 0, valign: "top",
    });
  });

  s.addText("33 MAU · 14 WAU · 40 уникальных активных учеников · 0 churn среди платящих с момента запуска", {
    x: 0.6, y: 7.2, w: W - 1.2, h: 0.25,
    fontSize: 10, fontFace: F.body, italic: true, color: C.textMuted,
    align: "center", margin: 0,
  });

  addSlideNumber(s, 5);
}

// ═══════════════════════════════════════════
// SLIDE 6 — VOICE OF CUSTOMER
// ═══════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };

  addEyebrow(s, "ГОЛОС РЫНКА", 0.6, 0.5);
  addTitle(s, "Что говорят пилотные репетиторы", 0.6, 0.85);
  addSubtitle(s, "Не сценарии. Не CRM. Реальные сообщения из чата за апрель–май 2026.", 0.6, 1.65);

  // Quote 1 (Elena) — left big card
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.6, y: 2.4, w: 8.0, h: 4.6,
    fill: { color: C.cream }, line: { color: C.border, width: 1 },
    shadow: softShadow(),
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.6, y: 2.4, w: 0.1, h: 4.6, fill: { color: C.green }, line: { color: C.green },
  });
  s.addText("«", {
    x: 0.8, y: 2.5, w: 0.8, h: 0.9,
    fontSize: 60, fontFace: F.head, bold: true, color: C.green, margin: 0,
  });
  s.addText("Главная фишка — помощь ИИ в проверке ДЗ. Для меня это эталон того, как новые инструменты нужно применять для пользы себе и ученикам, а не бояться их или запрещать.", {
    x: 1.6, y: 2.6, w: 6.8, h: 1.5,
    fontSize: 17, fontFace: F.head, italic: true, bold: true, color: C.text,
    margin: 0, valign: "top",
  });
  s.addText("Ученики, кстати, тоже говорят, что это круто, и с удовольствием обсуждают с Сократом свои задачи. Думаю, что за подобным подходом будущее, и хочу активно быть в нём.", {
    x: 1.6, y: 4.2, w: 6.8, h: 1.4,
    fontSize: 13, fontFace: F.body, italic: true, color: C.textMuted,
    margin: 0, valign: "top",
  });
  s.addText("— ЕЛЕНА", {
    x: 1.6, y: 5.7, w: 6.8, h: 0.35,
    fontSize: 11, fontFace: F.head, bold: true, color: C.green,
    charSpacing: 4, margin: 0,
  });
  s.addText("репетитор физики ЕГЭ и ОГЭ · платящий пилот с мая 2026", {
    x: 1.6, y: 6.05, w: 6.8, h: 0.3,
    fontSize: 11, fontFace: F.body, italic: true, color: C.textMuted, margin: 0,
  });

  // Quote 2 (Egor) — top right
  s.addShape(pres.shapes.RECTANGLE, {
    x: 8.8, y: 2.4, w: 3.95, h: 2.2,
    fill: { color: C.greenDark }, line: { color: C.greenDark },
    shadow: softShadow(),
  });
  s.addText("«Собираю ДЗ за 5 минут из базы. AI-проверка экономит 2 часа на группу школьников каждую неделю.»", {
    x: 9.0, y: 2.6, w: 3.65, h: 1.3,
    fontSize: 14, fontFace: F.head, italic: true, bold: true, color: C.white,
    margin: 0, valign: "top",
  });
  s.addText("— ЕГОР БЛИНОВ", {
    x: 9.0, y: 3.95, w: 3.65, h: 0.3,
    fontSize: 10, fontFace: F.head, bold: true, color: C.ochre, charSpacing: 3, margin: 0,
  });
  s.addText("МФТИ · 2×100 ЕГЭ · 10 лет репетиторства", {
    x: 9.0, y: 4.25, w: 3.65, h: 0.3,
    fontSize: 10, fontFace: F.body, color: "B8E0CD", italic: true, margin: 0,
  });

  // Quote 3 (Student) — bottom right
  s.addShape(pres.shapes.RECTANGLE, {
    x: 8.8, y: 4.8, w: 3.95, h: 2.2,
    fill: { color: C.white }, line: { color: C.border, width: 1 },
    shadow: softShadow(),
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 8.8, y: 4.8, w: 3.95, h: 0.08, fill: { color: C.ochre }, line: { color: C.ochre },
  });
  s.addText("«Очень нравится, как вы преподносите материал, какие плюшки в виде сайтов, ИИ вы делаете…»", {
    x: 9.0, y: 5.0, w: 3.65, h: 1.4,
    fontSize: 13, fontFace: F.body, italic: true, color: C.text,
    margin: 0, valign: "top",
  });
  s.addText("— УЧЕНИК ЕГОРА · МАЙ 2026", {
    x: 9.0, y: 6.4, w: 3.65, h: 0.3,
    fontSize: 10, fontFace: F.head, bold: true, color: C.ochre, charSpacing: 3, margin: 0,
  });
  s.addText("сообщение пришло само, без просьбы об отзыве", {
    x: 9.0, y: 6.7, w: 3.65, h: 0.3,
    fontSize: 10, fontFace: F.body, italic: true, color: C.textMuted, margin: 0,
  });

  addSlideNumber(s, 6);
}

// ═══════════════════════════════════════════
// SLIDE 7 — MARKET
// ═══════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };

  addEyebrow(s, "РЫНОК", 0.6, 0.5);
  addTitle(s, "Каждая 2-я российская семья платит репетитору", 0.6, 0.85);
  addSubtitle(s, "Рынок растёт быстрее зарплат. Конкуренция за репетиторов удваивается. Технологий, которые делают репетитора эффективнее, в РФ нет.", 0.6, 1.65);

  const fY = 2.5, fX = 0.6, fW = 6.2;

  s.addShape(pres.shapes.RECTANGLE, {
    x: fX, y: fY, w: fW, h: 1.3,
    fill: { color: C.greenDark }, line: { color: C.greenDark },
    shadow: softShadow(),
  });
  s.addText("TAM", {
    x: fX + 0.3, y: fY + 0.15, w: 0.8, h: 0.35,
    fontSize: 11, fontFace: F.head, bold: true, color: C.ochre, charSpacing: 4, margin: 0,
  });
  s.addText("180–240 млрд ₽ / год", {
    x: fX + 0.3, y: fY + 0.45, w: fW - 0.6, h: 0.55,
    fontSize: 28, fontFace: F.head, bold: true, color: C.white, margin: 0,
  });
  s.addText("Рынок частного репетиторства в РФ. ≈300–400 тыс. репетиторов × ср. чек 50 тыс ₽/мес.", {
    x: fX + 0.3, y: fY + 0.95, w: fW - 0.6, h: 0.3,
    fontSize: 11, fontFace: F.body, color: "B8E0CD", italic: true, margin: 0,
  });

  const samW = fW * 0.78;
  s.addShape(pres.shapes.RECTANGLE, {
    x: fX, y: fY + 1.5, w: samW, h: 1.3,
    fill: { color: C.green }, line: { color: C.green },
    shadow: softShadow(),
  });
  s.addText("SAM — НАШ WEDGE", {
    x: fX + 0.3, y: fY + 1.65, w: 2.5, h: 0.35,
    fontSize: 11, fontFace: F.head, bold: true, color: C.ochre, charSpacing: 4, margin: 0,
  });
  s.addText("7–10 млрд ₽ / год", {
    x: fX + 0.3, y: fY + 1.95, w: samW - 0.6, h: 0.55,
    fontSize: 26, fontFace: F.head, bold: true, color: C.white, margin: 0,
  });
  s.addText("Физика ЕГЭ/ОГЭ. 38% выпускников ЕГЭ берут репетитора по физике.", {
    x: fX + 0.3, y: fY + 2.45, w: samW - 0.6, h: 0.3,
    fontSize: 11, fontFace: F.body, color: "DCFCE7", italic: true, margin: 0,
  });

  const somW = fW * 0.5;
  s.addShape(pres.shapes.RECTANGLE, {
    x: fX, y: fY + 3.0, w: somW, h: 1.3,
    fill: { color: C.ochre }, line: { color: C.ochre },
    shadow: softShadow(),
  });
  s.addText("SOM — ЦЕЛЬ Y1", {
    x: fX + 0.3, y: fY + 3.15, w: 2.5, h: 0.35,
    fontSize: 11, fontFace: F.head, bold: true, color: C.greenDark, charSpacing: 4, margin: 0,
  });
  s.addText("12 млн ₽ ARR", {
    x: fX + 0.3, y: fY + 3.45, w: somW - 0.6, h: 0.55,
    fontSize: 26, fontFace: F.head, bold: true, color: C.white, margin: 0,
  });
  s.addText("1 000 платящих репетиторов × 1 000 ₽/мес.", {
    x: fX + 0.3, y: fY + 3.95, w: somW - 0.6, h: 0.3,
    fontSize: 11, fontFace: F.body, color: "FFE8D1", italic: true, margin: 0,
  });

  const rX = 7.2, rY = 2.5, rW = 5.6, rH = 1.5;
  const tailwinds = [
    { stat: "+63%", label: "YoY", body: "рост числа желающих стать репетитором в Q1 2026 (МК)" },
    { stat: "+80%", label: "ЗА 5 ЛЕТ", body: "выросли траты семей на репетиторов. В 1.6× опережает инфляцию" },
    { stat: "≈ 0", label: "КОНКУРЕНТОВ", body: "AI-проверки рукописных ДЗ для репетиторов в РФ нет. CloudText, кураторы-студенты (15-20к ₽/мес) — без AI" },
  ];

  tailwinds.forEach((t, i) => {
    const y = rY + i * (rH + 0.2);
    s.addShape(pres.shapes.RECTANGLE, {
      x: rX, y, w: rW, h: rH,
      fill: { color: C.cream }, line: { color: C.border, width: 1 },
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: rX, y, w: 0.08, h: rH, fill: { color: C.green }, line: { color: C.green },
    });
    s.addText(t.stat, {
      x: rX + 0.3, y: y + 0.15, w: 2.5, h: 0.7,
      fontSize: 36, fontFace: F.head, bold: true, color: C.green, margin: 0,
    });
    s.addText(t.label, {
      x: rX + 0.3, y: y + 0.85, w: 2.5, h: 0.3,
      fontSize: 11, fontFace: F.head, bold: true, color: C.ochre, charSpacing: 3, margin: 0,
    });
    s.addText(t.body, {
      x: rX + 2.85, y: y + 0.25, w: rW - 3.05, h: rH - 0.4,
      fontSize: 12, fontFace: F.body, color: C.text, valign: "middle", margin: 0,
    });
  });

  s.addText("Источники: finance.mail.ru, Накануне.RU, МК, Sberbank.Investments (Q1 2026)", {
    x: 0.6, y: 7.15, w: W - 1.2, h: 0.25,
    fontSize: 9, fontFace: F.body, italic: true, color: C.textLight,
    align: "left", margin: 0,
  });

  addSlideNumber(s, 7);
}

// ═══════════════════════════════════════════
// SLIDE 8 — COMPETITION
// ═══════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };

  addEyebrow(s, "КОНКУРЕНЦИЯ", 0.6, 0.5);
  addTitle(s, "Пустой квадрант на пересечении AI × «для репетитора»", 0.6, 0.85);
  addSubtitle(s, "Российские CRM-платформы не делают AI. Онлайн-школы конкурируют за ученика. AI-тьюторы (Khanmigo, Brilliant) — не в РФ. 100balnik (топ-5 школа) тестирует AI только внутри школы.", 0.6, 1.65);

  const mX = 1.5, mY = 2.5, mW = 8.0, mH = 4.3;

  s.addShape(pres.shapes.RECTANGLE, {
    x: mX, y: mY, w: mW, h: mH,
    fill: { color: C.bgLight }, line: { color: C.border, width: 1 },
  });
  s.addShape(pres.shapes.LINE, {
    x: mX + mW / 2, y: mY, w: 0, h: mH,
    line: { color: C.textLight, width: 1, dashType: "dash" },
  });
  s.addShape(pres.shapes.LINE, {
    x: mX, y: mY + mH / 2, w: mW, h: 0,
    line: { color: C.textLight, width: 1, dashType: "dash" },
  });

  s.addText("Глубина AI →", {
    x: mX, y: mY + mH + 0.05, w: mW, h: 0.3,
    fontSize: 11, fontFace: F.head, bold: true, color: C.textMuted,
    align: "center", margin: 0,
  });
  s.addText("Для репетитора ↑", {
    x: mX - 1.55, y: mY + mH / 2 - 1.0, w: 1.45, h: 0.3,
    fontSize: 11, fontFace: F.head, bold: true, color: C.textMuted,
    align: "right", margin: 0,
  });
  s.addText("Для ученика ↓", {
    x: mX - 1.55, y: mY + mH / 2 + 0.6, w: 1.45, h: 0.3,
    fontSize: 11, fontFace: F.head, bold: true, color: C.textMuted,
    align: "right", margin: 0,
  });

  // TL: CRM for tutors
  s.addText([
    { text: "CRM для репетиторов", options: { bold: true, color: C.text, breakLine: true } },
    { text: "Skillspace · GetCourse · ProgressMe · AnyLeson", options: { color: C.textMuted, fontSize: 11 } },
  ], {
    x: mX + 0.3, y: mY + 0.4, w: mW / 2 - 0.6, h: 1.0,
    fontSize: 13, fontFace: F.body, margin: 0, valign: "top",
  });

  // BL: Online schools
  s.addText([
    { text: "Онлайн-школы", options: { bold: true, color: C.text, breakLine: true } },
    { text: "Умскул · Фоксфорд · 100balnik · Сотка · Maximum", options: { color: C.textMuted, fontSize: 11 } },
  ], {
    x: mX + 0.3, y: mY + mH / 2 + 0.4, w: mW / 2 - 0.6, h: 1.0,
    fontSize: 13, fontFace: F.body, margin: 0, valign: "top",
  });

  // TR: SOKRAT AI
  s.addShape(pres.shapes.RECTANGLE, {
    x: mX + mW / 2 + 0.15, y: mY + 0.15, w: mW / 2 - 0.3, h: mH / 2 - 0.3,
    fill: { color: C.green }, line: { color: C.green },
    shadow: strongShadow(),
  });
  s.addText("СОКРАТ AI", {
    x: mX + mW / 2 + 0.4, y: mY + 0.4, w: mW / 2 - 0.6, h: 0.5,
    fontSize: 22, fontFace: F.head, bold: true, color: C.white, charSpacing: 4, margin: 0,
  });
  s.addText("AI-агент для репетиторов физики ЕГЭ", {
    x: mX + mW / 2 + 0.4, y: mY + 0.95, w: mW / 2 - 0.6, h: 0.4,
    fontSize: 13, fontFace: F.body, italic: true, color: C.ochre, margin: 0,
  });
  s.addText("Узкий AI · Покупатель — репетитор · B2B2C-канал", {
    x: mX + mW / 2 + 0.4, y: mY + 1.35, w: mW / 2 - 0.6, h: 0.4,
    fontSize: 11, fontFace: F.body, color: "DCFCE7", margin: 0,
  });

  // BR: AI tutors (not in RU)
  s.addText([
    { text: "AI-тьюторы (не в РФ)", options: { bold: true, color: C.text, breakLine: true } },
    { text: "Khanmigo · Brilliant · Duolingo Max", options: { color: C.textMuted, fontSize: 11, breakLine: true } },
    { text: "→ ChatGPT-as-tutor — учит списывать", options: { color: C.red, fontSize: 11, italic: true } },
  ], {
    x: mX + mW / 2 + 0.3, y: mY + mH / 2 + 0.4, w: mW / 2 - 0.6, h: 1.5,
    fontSize: 13, fontFace: F.body, margin: 0, valign: "top",
  });

  s.addText("100balnik (топ-5 онлайн-школа) запустила AI-проверку ДЗ — но только для своих учеников внутри школы. Для рынка частных репетиторов AI-продукта в РФ нет.", {
    x: 0.6, y: 7.15, w: W - 1.2, h: 0.3,
    fontSize: 12, fontFace: F.head, italic: true, bold: true, color: C.greenDark,
    align: "center", margin: 0,
  });

  addSlideNumber(s, 8);
}

// ═══════════════════════════════════════════
// SLIDE 9 — WHY NOW / AI MOAT
// ═══════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };

  addEyebrow(s, "ПОЧЕМУ СЕЙЧАС · ЗАЩИТА", 0.6, 0.5);
  addTitle(s, "Почему сейчас и почему мы защищены", 0.6, 0.85);
  addSubtitle(s, "LLM сегодня — массовый товар. Конкуренцию выигрывает тот, кто построит петлю данных в узкой нише раньше других.", 0.6, 1.65);

  const moats = [
    { tag: "01 — ВРЕМЯ", title: "Узкий AI > универсальный",
      body: "Sequoia AI Ascent 2026: «модели, заточенные под экспертные ниши, где точность важнее размера, выигрывают». В 2026 рынок забирает тот, кто строит доменную экспертизу поверх LLM, а не пытается заменить LLM." },
    { tag: "02 — ЗАЩИТА", title: "Петля данных в управляемом чате",
      body: "Каждое прорешанное ДЗ улучшает наши Сократовские промпты под физику ЕГЭ. Эталонные решения от репетиторов + ошибки учеников по кодификатору ФИПИ = собственные данные для обучения, которых нет ни у кого." },
    { tag: "03 — ДИСТРИБУЦИЯ", title: "Репетитор как канал (B2B2C)",
      body: "1 платящий репетитор = 10–30 учеников на платформе. Органический рост через рекомендации от репетитора к репетитору в своих профессиональных кругах. Самый низкий CAC в EdTech." },
  ];

  const cardW = 3.95, cardH = 4.3, cardY = 2.35, gap = 0.22;
  const startX = (W - (cardW * 3 + gap * 2)) / 2;

  moats.forEach((m, i) => {
    const x = startX + i * (cardW + gap);
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: cardY, w: cardW, h: cardH,
      fill: { color: C.white }, line: { color: C.border, width: 1 },
      shadow: softShadow(),
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: cardY, w: 0.08, h: cardH, fill: { color: C.ochre }, line: { color: C.ochre },
    });
    s.addText(m.tag, {
      x: x + 0.35, y: cardY + 0.3, w: cardW - 0.5, h: 0.3,
      fontSize: 10, fontFace: F.head, bold: true, color: C.ochre, charSpacing: 4, margin: 0,
    });
    s.addText(m.title, {
      x: x + 0.35, y: cardY + 0.65, w: cardW - 0.5, h: 1.0,
      fontSize: 20, fontFace: F.head, bold: true, color: C.text, margin: 0, valign: "top",
    });
    s.addText(m.body, {
      x: x + 0.35, y: cardY + 1.75, w: cardW - 0.6, h: cardH - 1.9,
      fontSize: 12, fontFace: F.body, color: C.text, margin: 0, valign: "top",
    });
  });

  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.6, y: 6.4, w: W - 1.2, h: 0.5,
    fill: { color: C.greenLight }, line: { color: C.greenLight },
  });
  s.addText([
    { text: "Окно открыто 12–18 месяцев. " },
    { text: "Российских EdTech-игроков, способных собрать AI-агента для репетиторов под ЕГЭ, всего 3–4 (Умскул, Фоксфорд, 100balnik, Skyeng). ", options: { bold: true } },
    { text: "Кто первый пройдёт через 100 платящих репетиторов — заберёт нишу." },
  ], {
    x: 0.8, y: 6.4, w: W - 1.6, h: 0.5,
    fontSize: 13, fontFace: F.body, color: C.greenDark, valign: "middle", margin: 0,
  });

  addSlideNumber(s, 9);
}

// ═══════════════════════════════════════════
// SLIDE 10 — BUSINESS MODEL
// ═══════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };

  addEyebrow(s, "БИЗНЕС-МОДЕЛЬ", 0.6, 0.5);
  addTitle(s, "B2B SaaS по числу учеников", 0.6, 0.85);
  addSubtitle(s, "Подписка для репетитора. Цена растёт с размером его аудитории. ROI — окупаемость за первую неделю использования.", 0.6, 1.65);

  const tiers = [
    { name: "БЕСПЛАТНО", price: "0 ₽", tagline: "навсегда",
      bullets: ["Оплаты `/pay` в Telegram", "Расписание и профили учеников", "Без ограничений", "Без AI"],
      featured: false },
    { name: "AI-СТАРТ", price: "от 1 000 ₽", tagline: "/ мес",
      bullets: ["AI-проверка рукописных ДЗ", "Сократовский диалог", "50 AI-сообщений / день / ученика", "До 10 учеников — 1 000 ₽", "До 20 — 2 000 ₽"],
      featured: true },
    { name: "AI-КОМАНДА", price: "от 3 000 ₽", tagline: "/ мес",
      bullets: ["20+ учеников", "Командная база задач", "Онбординг и поддержка", "White-label (по запросу)", "Приоритет в дорожной карте"],
      featured: false },
  ];

  const cardW = 3.8, cardH = 4.4, cardY = 2.4, gap = 0.3;
  const startX = (W - (cardW * 3 + gap * 2)) / 2;

  tiers.forEach((t, i) => {
    const x = startX + i * (cardW + gap);
    const bg = t.featured ? C.greenDark : C.cream;
    const txt = t.featured ? C.white : C.text;
    const muted = t.featured ? "B8E0CD" : C.textMuted;

    s.addShape(pres.shapes.RECTANGLE, {
      x, y: cardY, w: cardW, h: cardH,
      fill: { color: bg }, line: { color: t.featured ? C.greenDark : C.border, width: 1 },
      shadow: t.featured ? strongShadow() : softShadow(),
    });

    // (no badge — dark green bg already differentiates the featured tier)

    s.addText(t.name, {
      x: x + 0.3, y: cardY + 0.3, w: cardW - 0.5, h: 0.35,
      fontSize: 12, fontFace: F.head, bold: true,
      color: t.featured ? C.ochre : C.green, charSpacing: 4, margin: 0,
    });
    s.addText(t.price, {
      x: x + 0.3, y: cardY + 0.7, w: cardW - 0.5, h: 0.9,
      fontSize: 36, fontFace: F.head, bold: true, color: txt, margin: 0,
    });
    s.addText(t.tagline, {
      x: x + 0.3, y: cardY + 1.55, w: cardW - 0.5, h: 0.35,
      fontSize: 13, fontFace: F.body, color: muted, margin: 0,
    });

    const bulletArr = t.bullets.map((b, idx) => ({
      text: b,
      options: { bullet: { code: "25CF" }, breakLine: idx < t.bullets.length - 1 },
    }));
    s.addText(bulletArr, {
      x: x + 0.3, y: cardY + 2.05, w: cardW - 0.5, h: cardH - 2.2,
      fontSize: 12, fontFace: F.body, color: txt,
      paraSpaceAfter: 4, margin: 0, valign: "top",
    });
  });

  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.6, y: 6.5, w: W - 1.2, h: 0.45,
    fill: { color: C.ochre }, line: { color: C.ochre },
  });
  s.addText([
    { text: "ROI:  " },
    { text: "час репетитора — 1.5–2 тыс ₽", options: { bold: true } },
    { text: "  →  AI экономит  " },
    { text: "3+ часа в неделю", options: { bold: true } },
    { text: "  →  подписка отбивается  " },
    { text: "первой неделей.", options: { bold: true } },
  ], {
    x: 0.6, y: 6.5, w: W - 1.2, h: 0.45,
    fontSize: 13, fontFace: F.body, color: C.greenDark,
    align: "center", valign: "middle", margin: 0,
  });

  addSlideNumber(s, 10);
}

// ═══════════════════════════════════════════
// SLIDE 11 — TEAM
// ═══════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };

  addEyebrow(s, "КОМАНДА", 0.6, 0.5);
  addTitle(s, "Физтех × EdTech × 10 лет репетиторства физики", 0.6, 0.85);
  addSubtitle(s, "Один основатель ведёт продукт, AI-стек и инфру. Co-founder — топ-репетитор физики ЕГЭ из МФТИ. Профильная команда без лишних расходов.", 0.6, 1.65);

  const team = [
    { name: "Владимир Камчаткин", role: "CEO · CPO · FOUNDER",
      bio: "МФТИ. Экс-Фоксфорд (продакт виртуального класса для репетиторов). Экс-Т-Образование (продуктовый аналитик). Знает EdTech-стек изнутри: что покупают репетиторы, что покупают родители, и почему ChatGPT-as-tutor — зло для школьников.",
      contact: "t.me/datanewgold", initial: "В" },
    { name: "Егор Блинов", role: "CO-FOUNDER · TUTOR EXPERT",
      bio: "МФТИ, преподаватель. Дважды 100-балльник ЕГЭ. 10 лет репетиторства по физике ОГЭ / ЕГЭ / олимпиадам. Основатель онлайн-школы Razveday.ru. Lead-репетитор пилота. Привлекает других репетиторов в продукт через профессиональное сообщество.",
      contact: "t.me/sokrat_rep", initial: "Е" },
  ];

  const cardW = 5.8, cardH = 4.6, cardY = 2.35, gap = 0.4;
  const startX = (W - (cardW * 2 + gap)) / 2;

  team.forEach((t, i) => {
    const x = startX + i * (cardW + gap);
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: cardY, w: cardW, h: cardH,
      fill: { color: C.cream }, line: { color: C.border, width: 1 },
      shadow: softShadow(),
    });

    s.addShape(pres.shapes.OVAL, {
      x: x + 0.35, y: cardY + 0.35, w: 0.9, h: 0.9,
      fill: { color: C.green }, line: { color: C.green },
    });
    s.addText(t.initial, {
      x: x + 0.35, y: cardY + 0.35, w: 0.9, h: 0.9,
      fontSize: 36, fontFace: F.head, bold: true, color: C.white,
      align: "center", valign: "middle", margin: 0,
    });

    s.addText(t.name, {
      x: x + 1.4, y: cardY + 0.4, w: cardW - 1.6, h: 0.45,
      fontSize: 17, fontFace: F.head, bold: true, color: C.text, margin: 0, valign: "top",
    });
    s.addText(t.role, {
      x: x + 1.4, y: cardY + 0.85, w: cardW - 1.6, h: 0.35,
      fontSize: 11, fontFace: F.head, bold: true, color: C.ochre, charSpacing: 3, margin: 0,
    });

    s.addText(t.bio, {
      x: x + 0.35, y: cardY + 1.5, w: cardW - 0.6, h: cardH - 2.1,
      fontSize: 12, fontFace: F.body, color: C.text, margin: 0, valign: "top",
    });

    s.addShape(pres.shapes.RECTANGLE, {
      x, y: cardY + cardH - 0.5, w: cardW, h: 0.5,
      fill: { color: C.greenDark }, line: { color: C.greenDark },
    });
    s.addText(t.contact, {
      x: x + 0.3, y: cardY + cardH - 0.5, w: cardW - 0.5, h: 0.5,
      fontSize: 11, fontFace: F.body, color: "B8E0CD", valign: "middle", margin: 0,
    });
  });

  addSlideNumber(s, 11);
}

// ═══════════════════════════════════════════
// SLIDE 12 — ASK
// ═══════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.greenDark };

  s.addText("ASK · YANDEX CLOUD", {
    x: 0.8, y: 0.5, w: 8, h: 0.4,
    fontSize: 12, fontFace: F.head, bold: true, color: C.ochre, charSpacing: 6, margin: 0,
  });

  s.addText("Что нам нужно от Yandex Cloud", {
    x: 0.8, y: 0.95, w: 12, h: 1.0,
    fontSize: 42, fontFace: F.head, bold: true, color: C.white, margin: 0,
  });

  s.addText("Грант + дистрибуция через экосистему Яндекса. Взамен — кейс узкого AI-агента в экспертной нише и собственные русскоязычные данные для YandexGPT.", {
    x: 0.8, y: 1.95, w: 12, h: 0.6,
    fontSize: 14, fontFace: F.body, italic: true, color: "B8E0CD", margin: 0,
  });

  const askW = 6.0, askH = 3.2, askY = 2.9, askGap = 0.4;
  const askStartX = (W - (askW * 2 + askGap)) / 2;

  // Ask 1
  const x1 = askStartX;
  s.addShape(pres.shapes.RECTANGLE, {
    x: x1, y: askY, w: askW, h: askH,
    fill: { color: C.white }, line: { color: C.white },
    shadow: strongShadow(),
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: x1, y: askY, w: askW, h: 0.1, fill: { color: C.ochre }, line: { color: C.ochre },
  });
  s.addText("01", {
    x: x1 + 0.4, y: askY + 0.3, w: 1, h: 0.5,
    fontSize: 26, fontFace: F.head, bold: true, color: C.ochre, margin: 0,
  });
  s.addText("Грант 1 млн ₽ на Yandex AI Studio", {
    x: x1 + 0.4, y: askY + 0.85, w: askW - 0.7, h: 0.9,
    fontSize: 22, fontFace: F.head, bold: true, color: C.text, margin: 0, valign: "top",
  });
  s.addText("Доступ к топовым моделям в Yandex AI Studio: YandexGPT + Yandex Cloud. Мультимодальность для рукописных решений учеников. Соответствие требованиям российской юрисдикции.", {
    x: x1 + 0.4, y: askY + 1.85, w: askW - 0.7, h: askH - 2.0,
    fontSize: 13, fontFace: F.body, color: C.text, margin: 0, valign: "top",
  });

  // Ask 2
  const x2 = askStartX + askW + askGap;
  s.addShape(pres.shapes.RECTANGLE, {
    x: x2, y: askY, w: askW, h: askH,
    fill: { color: C.white }, line: { color: C.white },
    shadow: strongShadow(),
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: x2, y: askY, w: askW, h: 0.1, fill: { color: C.ochre }, line: { color: C.ochre },
  });
  s.addText("02", {
    x: x2 + 0.4, y: askY + 0.3, w: 1, h: 0.5,
    fontSize: 26, fontFace: F.head, bold: true, color: C.ochre, margin: 0,
  });
  s.addText("Дистрибуция через экосистему Яндекса", {
    x: x2 + 0.4, y: askY + 0.85, w: askW - 0.7, h: 0.9,
    fontSize: 22, fontFace: F.head, bold: true, color: C.text, margin: 0, valign: "top",
  });
  s.addText("Попадание в Yandex Cloud Marketplace как B2B-решение для EdTech-сегмента. Партнёрский канал к репетиторам через Яндекс.Учебник и связанные продукты.", {
    x: x2 + 0.4, y: askY + 1.85, w: askW - 0.7, h: askH - 2.0,
    fontSize: 13, fontFace: F.body, color: C.text, margin: 0, valign: "top",
  });


  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.8, y: 6.5, w: 0.1, h: 0.5, fill: { color: C.ochre }, line: { color: C.ochre },
  });
  s.addText([
    { text: "Владимир Камчаткин — CEO", options: { bold: true, color: C.white, breakLine: true } },
    { text: "sokratai.ru  ·  t.me/sokrat_rep  ·  t.me/datanewgold", options: { color: "B8E0CD" } },
  ], {
    x: 1.05, y: 6.5, w: 12, h: 0.7,
    fontSize: 14, fontFace: F.body, margin: 0,
  });
}

// ═══════════════════════════════════════════
// SLIDE 13 — APPENDIX 1: TOP TUTORS
// ═══════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };

  addEyebrow(s, "ПРИЛОЖЕНИЕ 1", 0.6, 0.5, C.ochre);
  addTitle(s, "Топ-репетиторы платформы по AI-нагрузке", 0.6, 0.85);
  addSubtitle(s, "10 активных репетиторов · данные за всё время до 12 мая 2026 · upper-bound органического роста", 0.6, 1.65);

  const tutors = [
    { name: "Егор Блинов",             students: 29, hw: 50, ai: 899 },
    { name: "Елена",                   students: 18, hw: 14, ai: 518 },
    { name: "Евгений",                 students: 3,  hw: 6,  ai: 114 },
    { name: "Полина Николаевна",       students: 6,  hw: 4,  ai: 78  },
    { name: "Владимир (test-аккаунт)", students: 3,  hw: 8,  ai: 44  },
    { name: "Вадим",                   students: 3,  hw: 2,  ai: 40  },
    { name: "Эмилия",                  students: 4,  hw: 2,  ai: 39  },
    { name: "Андрей",                  students: 2,  hw: 3,  ai: 19  },
    { name: "Татьяна Анатольевна",     students: 1,  hw: 1,  ai: 10  },
    { name: "Мария",                   students: 2,  hw: 2,  ai: 9   },
  ];

  const tX = 0.8;
  const tY = 2.3;
  const colW = [4.5, 2.2, 2.2, 3.0];
  const rowH = 0.42;

  const headerRow = ["РЕПЕТИТОР", "УЧЕНИКОВ", "ДЗ СОЗДАНО", "AI-СООБЩЕНИЙ"];
  let curX = tX;
  headerRow.forEach((h, i) => {
    s.addShape(pres.shapes.RECTANGLE, {
      x: curX, y: tY, w: colW[i], h: rowH,
      fill: { color: C.greenDark }, line: { color: C.greenDark },
    });
    s.addText(h, {
      x: curX + 0.2, y: tY, w: colW[i] - 0.3, h: rowH,
      fontSize: 11, fontFace: F.head, bold: true,
      color: C.ochre, charSpacing: 3, valign: "middle",
      align: i === 0 ? "left" : "right", margin: 0,
    });
    curX += colW[i];
  });

  tutors.forEach((t, i) => {
    const rY = tY + rowH + i * rowH;
    const bg = i % 2 === 0 ? C.cream : C.white;
    let cX = tX;
    const cells = [t.name, t.students.toLocaleString("ru"), t.hw.toLocaleString("ru"), t.ai.toLocaleString("ru")];
    cells.forEach((c, j) => {
      s.addShape(pres.shapes.RECTANGLE, {
        x: cX, y: rY, w: colW[j], h: rowH,
        fill: { color: bg }, line: { color: C.border, width: 0.5 },
      });
      s.addText(c, {
        x: cX + 0.2, y: rY, w: colW[j] - 0.3, h: rowH,
        fontSize: 12, fontFace: F.body,
        bold: j === 3 || i === 0,
        color: j === 3 ? C.green : C.text,
        valign: "middle",
        align: j === 0 ? "left" : "right", margin: 0,
      });
      cX += colW[j];
    });
  });

  s.addText("Источник: запрос к homework_tutor_thread_messages × homework_tutor_assignments × profiles · group by tutor · order by AI-сообщений DESC", {
    x: 0.8, y: 7.1, w: W - 1.6, h: 0.3,
    fontSize: 9, fontFace: F.body, italic: true, color: C.textLight,
    align: "left", margin: 0,
  });

  s.addText("ПРИЛОЖЕНИЕ 1 / 2", {
    x: W - 2.5, y: H - 0.45, w: 2.0, h: 0.3,
    fontSize: 9, fontFace: F.body, color: C.ochre, bold: true, charSpacing: 3,
    align: "right", margin: 0,
  });
  s.addText("sokratai.ru", {
    x: 0.5, y: H - 0.45, w: 2.0, h: 0.3,
    fontSize: 9, fontFace: F.body, color: C.green, bold: true,
    align: "left", margin: 0,
  });
}

// ═══════════════════════════════════════════
// SLIDE 14 — APPENDIX 2: WEEKLY GROWTH CHART
// ═══════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };

  addEyebrow(s, "ПРИЛОЖЕНИЕ 2", 0.6, 0.5, C.ochre);
  addTitle(s, "Рост AI-нагрузки по неделям · март–май 2026", 0.6, 0.85);
  addSubtitle(s, "Кратный рост к майским праздникам. Каждый новый платящий репетитор приводит 10–30 учеников за 1–2 недели.", 0.6, 1.65);

  const labels = [
    "09 мар", "16 мар", "23 мар", "30 мар",
    "06 апр", "13 апр", "20 апр", "27 апр",
    "04 май", "11 май*",
  ];
  const aiMsg = [18, 33, 114, 139, 278, 516, 97, 298, 362, 31];

  s.addChart(pres.charts.BAR, [
    { name: "AI-сообщения за неделю", labels, values: aiMsg },
  ], {
    x: 0.6, y: 2.4, w: W - 1.2, h: 4.0, barDir: "col",
    chartColors: [C.green],
    chartArea: { fill: { color: C.white }, roundedCorners: false },
    catAxisLabelColor: C.textMuted, catAxisLabelFontSize: 10,
    valAxisLabelColor: C.textMuted, valAxisLabelFontSize: 10,
    valGridLine: { color: C.border, size: 0.5 },
    catGridLine: { style: "none" },
    showValue: true, dataLabelPosition: "outEnd",
    dataLabelColor: C.text, dataLabelFontSize: 10,
    showLegend: false,
    showTitle: true, title: "AI-сообщений в управляемом чате за неделю", titleFontSize: 12, titleColor: C.text, titleFontFace: F.head,
  });

  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.6, y: 6.55, w: W - 1.2, h: 0.55,
    fill: { color: C.greenLight }, line: { color: C.greenLight },
  });
  s.addText([
    { text: "1 310 / 1 886 ≈ 70% AI-нагрузки", options: { bold: true } },
    { text: " — за последние 30 дней. Пиковая неделя 13 апреля (516 сообщений) — момент онбординга платящих репетиторов. * 11 мая — неполная неделя (1 день данных)." },
  ], {
    x: 0.8, y: 6.55, w: W - 1.6, h: 0.55,
    fontSize: 12, fontFace: F.body, color: C.greenDark, valign: "middle", margin: 0,
  });

  s.addText("ПРИЛОЖЕНИЕ 2 / 2", {
    x: W - 2.5, y: H - 0.45, w: 2.0, h: 0.3,
    fontSize: 9, fontFace: F.body, color: C.ochre, bold: true, charSpacing: 3,
    align: "right", margin: 0,
  });
  s.addText("sokratai.ru", {
    x: 0.5, y: H - 0.45, w: 2.0, h: 0.3,
    fontSize: 9, fontFace: F.body, color: C.green, bold: true,
    align: "left", margin: 0,
  });
}

pres.writeFile({ fileName: __dirname + "/02-sokrat-ai-pitch.pptx" })
  .then((p) => console.log("OK:", p))
  .catch((e) => { console.e