/* global React, SIcon */
// Student homework list — 3 variants (compact list, rich cards, timeline)

const TUTORS = {
  smirnova: { name: "Анна Смирнова", short: "А.С.", subject: "Физика" },
  kovalev:  { name: "Илья Ковалёв",  short: "И.К.", subject: "Математика" },
  petrova:  { name: "Мария Петрова", short: "М.П.", subject: "Информатика" },
};

const SUBJECT_THEME = {
  "Физика":      { bg: "#EEEFFE", fg: "#5B5FC7", icon: "atom" },
  "Математика":  { bg: "#E8F5EE", fg: "#1B6B4A", icon: "function-square" },
  "Информатика": { bg: "#FFEDD5", fg: "#B45309", icon: "code-2" },
};

const HOMEWORK_DATA = [
  {
    id: "hw1", title: "Изменение энергии и начало колебаний",
    topic: "Колебания и волны · ЕГЭ № 28",
    subject: "Физика", tutor: TUTORS.smirnova,
    deadline: "today", deadlineLabel: "Сегодня до 21:00", deadlineHour: "21:00",
    progress: { done: 2, total: 9 }, est: 35, state: "in-progress", urgent: true,
  },
  {
    id: "hw2", title: "Производная сложной функции",
    topic: "Производные · профильная математика",
    subject: "Математика", tutor: TUTORS.kovalev,
    deadline: "today", deadlineLabel: "Сегодня до 23:59", deadlineHour: "23:59",
    progress: { done: 0, total: 6 }, est: 25, state: "not-started", urgent: true,
  },
  {
    id: "hw3", title: "Алгоритмы сортировки: пузырёк и быстрая",
    topic: "Алгоритмы · ЕГЭ № 25",
    subject: "Информатика", tutor: TUTORS.petrova,
    deadline: "tomorrow", deadlineLabel: "Завтра до 19:00", deadlineHour: "19:00",
    progress: { done: 1, total: 5 }, est: 40, state: "in-progress",
  },
  {
    id: "hw4", title: "Закон сохранения импульса",
    topic: "Механика · повторение",
    subject: "Физика", tutor: TUTORS.smirnova,
    deadline: "week", deadlineLabel: "Чт, 14 ноя", deadlineHour: "Чт",
    progress: { done: 0, total: 8 }, est: 50, state: "not-started",
  },
  {
    id: "hw5", title: "Степени и корни — разминка",
    topic: "Базовая алгебра",
    subject: "Математика", tutor: TUTORS.kovalev,
    deadline: "week", deadlineLabel: "Пт, 15 ноя", deadlineHour: "Пт",
    progress: { done: 0, total: 4 }, est: 15, state: "not-started",
  },
  {
    id: "hw6", title: "Оптимизация цикла while",
    topic: "Программирование на Python",
    subject: "Информатика", tutor: TUTORS.petrova,
    deadline: "review", deadlineLabel: "На проверке", deadlineHour: "—",
    progress: { done: 7, total: 7 }, est: 30, state: "submitted",
  },
  {
    id: "hw7", title: "Электростатика: задачи на конденсаторы",
    topic: "Электричество · ЕГЭ № 23",
    subject: "Физика", tutor: TUTORS.smirnova,
    deadline: "graded", deadlineLabel: "5 / 5", deadlineHour: "5 / 5",
    progress: { done: 6, total: 6 }, est: 40, state: "graded", grade: 5,
  },
  {
    id: "hw8", title: "Тригонометрические уравнения",
    topic: "Тригонометрия · повторение",
    subject: "Математика", tutor: TUTORS.kovalev,
    deadline: "overdue", deadlineLabel: "Просрочено · 2 дня", deadlineHour: "−2д",
    progress: { done: 3, total: 7 }, est: 45, state: "overdue",
  },
];

const PILL_BY_DEADLINE = {
  today:    { cls: "hw-pill--today",    label: "Сегодня", icon: "alarm-clock" },
  tomorrow: { cls: "hw-pill--tomorrow", label: "Завтра",  icon: "calendar" },
  week:     { cls: "hw-pill--week",     label: "На неделе", icon: "calendar-days" },
  review:   { cls: "hw-pill--review",   label: "На проверке", icon: "hourglass" },
  graded:   { cls: "hw-pill--graded",   label: "Оценено", icon: "check-circle-2" },
  overdue:  { cls: "hw-pill--overdue",  label: "Просрочено", icon: "alert-triangle" },
};

function Initials({ name, theme }) {
  const parts = name.split(" ");
  const initials = (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
  return (
    <span className="hw-init" style={{
      width: 26, height: 26, borderRadius: "50%",
      background: theme?.bg || "var(--sokrat-border-light)",
      color: theme?.fg || "var(--sokrat-fg2)",
      fontSize: 11, fontWeight: 700,
      display: "inline-grid", placeItems: "center", flex: "none",
    }}>{initials}</span>
  );
}

// ─── V1: Compact list ───────────────────────────────────────
function HomeworkListV1({ desktop }) {
  const today = HOMEWORK_DATA.filter(h => h.deadline === "today");
  const tomorrow = HOMEWORK_DATA.filter(h => h.deadline === "tomorrow");
  const week = HOMEWORK_DATA.filter(h => h.deadline === "week");
  const review = HOMEWORK_DATA.filter(h => h.deadline === "review");
  const overdue = HOMEWORK_DATA.filter(h => h.deadline === "overdue");
  const graded = HOMEWORK_DATA.filter(h => h.deadline === "graded");

  const Section = ({ title, items, mod }) => items.length > 0 && (
    <div className="hw-v1__section">
      <div className={"hw-v1__sect-head hw-v1__sect-head--" + mod}>
        <span className="hw-v1__sect-title">{title}</span>
        <span className="hw-v1__sect-count">{items.length}</span>
      </div>
      <div className="hw-v1__rows">
        {items.map(hw => <HomeworkRowV1 key={hw.id} hw={hw}/>)}
      </div>
    </div>
  );

  return (
    <div className={"hw-v1" + (desktop ? " hw-v1--desktop" : "")}>
      <Section title="Просрочено" items={overdue} mod="overdue"/>
      <Section title="Сегодня" items={today} mod="today"/>
      <Section title="Завтра" items={tomorrow} mod="tomorrow"/>
      <Section title="На этой неделе" items={week} mod="week"/>
      <Section title="На проверке у репетитора" items={review} mod="review"/>
      <Section title="Оценено" items={graded} mod="graded"/>
    </div>
  );
}

function HomeworkRowV1({ hw }) {
  const theme = SUBJECT_THEME[hw.subject];
  const pill = PILL_BY_DEADLINE[hw.deadline];
  return (
    <div className="hw-row-v1">
      <div className="hw-row-v1__icon" style={{ background: theme.bg, color: theme.fg }}>
        <SIcon name={theme.icon} size={20} strokeWidth={2}/>
      </div>
      <div className="hw-row-v1__main">
        <div className="hw-row-v1__title-line">
          <span className="hw-row-v1__title">{hw.title}</span>
        </div>
        <div className="hw-row-v1__meta">
          <span className="hw-row-v1__subject">{hw.subject}</span>
          <span className="hw-row-v1__sep">·</span>
          <span className="hw-row-v1__tutor">{hw.tutor.name}</span>
          <span className="hw-row-v1__sep">·</span>
          <SIcon name="clock-3" size={12} strokeWidth={2}/>
          <span>≈ {hw.est} мин</span>
        </div>
      </div>
      <div className="hw-row-v1__trail">
        {hw.state !== "graded" && hw.state !== "submitted" && (
          <div className="hw-row-v1__progress">
            <div className="hw-row-v1__progress-num">{hw.progress.done}/{hw.progress.total}</div>
            <div className="hw-row-v1__bar">
              <div className="hw-row-v1__bar-fill" style={{ width: `${hw.progress.done/hw.progress.total*100}%` }}/>
            </div>
          </div>
        )}
        {hw.state === "graded" && (
          <span className="hw-pill hw-pill--graded">{hw.deadlineLabel}</span>
        )}
        {hw.state !== "graded" && (
          <span className={"hw-pill " + pill.cls}>
            <SIcon name={pill.icon} size={12} strokeWidth={2}/>
            {hw.deadlineHour}
          </span>
        )}
        <SIcon name="chevron-right" size={18} strokeWidth={2}/>
      </div>
    </div>
  );
}

// ─── V2: Rich cards ─────────────────────────────────────────
function HomeworkListV2({ desktop }) {
  const items = HOMEWORK_DATA.filter(h => ["today","tomorrow","week","overdue","review"].includes(h.deadline));
  return (
    <div className={"hw-v2" + (desktop ? " hw-v2--desktop" : "")}>
      <div className="hw-v2__filters">
        <button className="hw-v2__filter hw-v2__filter--active">Все · {HOMEWORK_DATA.length}</button>
        <button className="hw-v2__filter">К сдаче · 5</button>
        <button className="hw-v2__filter">Физика · 3</button>
        <button className="hw-v2__filter">Математика · 3</button>
        <button className="hw-v2__filter">Информатика · 2</button>
        <span className="hw-v2__filter-sep"/>
        <button className="hw-v2__filter-icon" aria-label="Сортировать">
          <SIcon name="arrow-up-down" size={16} strokeWidth={2}/>
        </button>
      </div>
      <div className="hw-v2__grid">
        {items.map(hw => <HomeworkCardV2 key={hw.id} hw={hw}/>)}
      </div>
    </div>
  );
}

function HomeworkCardV2({ hw }) {
  const theme = SUBJECT_THEME[hw.subject];
  const pill = PILL_BY_DEADLINE[hw.deadline];
  const ctaText = hw.progress.done === 0 ? "Начать решать" :
                  hw.progress.done === hw.progress.total ? "На проверке" :
                  "Продолжить";
  return (
    <div className={"hw-card-v2" + (hw.urgent ? " hw-card-v2--urgent" : "")}>
      <div className="hw-card-v2__top">
        <span className="hw-card-v2__subject" style={{ background: theme.bg, color: theme.fg }}>
          <SIcon name={theme.icon} size={14} strokeWidth={2}/>
          {hw.subject}
        </span>
        <span className={"hw-pill " + pill.cls}>
          <SIcon name={pill.icon} size={12} strokeWidth={2}/>
          {hw.deadlineLabel}
        </span>
      </div>
      <div>
        <div className="hw-card-v2__title">{hw.title}</div>
        <div className="hw-card-v2__topic">
          <SIcon name="book-marked" size={12} strokeWidth={2}/>
          {hw.topic}
        </div>
      </div>
      <div className="hw-card-v2__progress">
        <div className="hw-card-v2__progress-row">
          <span className="hw-card-v2__progress-label">Прогресс</span>
          <span><span className="hw-card-v2__progress-num">{hw.progress.done}</span><span className="hw-card-v2__progress-of"> / {hw.progress.total} задач</span></span>
        </div>
        <div className="hw-card-v2__bar">
          <div className="hw-card-v2__bar-fill" style={{ width: `${hw.progress.done/hw.progress.total*100}%` }}/>
        </div>
      </div>
      <div className="hw-card-v2__foot">
        <span className="hw-card-v2__tutor">
          <Initials name={hw.tutor.name} theme={theme}/>
          <span className="hw-card-v2__tutor-name">{hw.tutor.name}</span>
        </span>
        <span className="hw-card-v2__est">
          <SIcon name="clock-3" size={12} strokeWidth={2}/>≈ {hw.est} мин
        </span>
      </div>
      <button className="hw-card-v2__cta">
        {ctaText}
        <SIcon name="arrow-right" size={16} strokeWidth={2}/>
      </button>
    </div>
  );
}

// ─── V3: Timeline by deadline ───────────────────────────────
function HomeworkListV3({ desktop }) {
  const overdue = HOMEWORK_DATA.filter(h => h.deadline === "overdue");
  const today = HOMEWORK_DATA.filter(h => h.deadline === "today");
  const tomorrow = HOMEWORK_DATA.filter(h => h.deadline === "tomorrow");
  const week = HOMEWORK_DATA.filter(h => h.deadline === "week");

  return (
    <div className={"hw-v3" + (desktop ? " hw-v3--desktop" : "")}>
      <div className="hw-v3__rail"/>
      <Bucket title="Просрочено · 1" mod="overdue" items={overdue}/>
      <Bucket title="Сегодня · 9 ноября" mod="today" items={today}/>
      <Bucket title="Завтра · 10 ноября" mod="tomorrow" items={tomorrow}/>
      <Bucket title="На этой неделе" mod="week" items={week}/>
      <div className="hw-v3__bucket">
        <div className="hw-v3__marker hw-v3__marker--done">
          <span className="hw-v3__marker-dot"/>
          <span className="hw-v3__marker-label">Завершено на этой неделе · 4</span>
        </div>
        <div className="hw-v3__done-summary">
          <SIcon name="trophy" size={16} strokeWidth={2}/>
          <span><b>Молодец, Артём.</b> Сдано 4 ДЗ, средний балл 4.7 — на 0.3 выше прошлой недели.</span>
        </div>
      </div>
    </div>
  );
}

function Bucket({ title, mod, items }) {
  if (items.length === 0) return null;
  return (
    <div className="hw-v3__bucket">
      <div className={"hw-v3__marker hw-v3__marker--" + mod}>
        <span className="hw-v3__marker-dot"/>
        <span className="hw-v3__marker-label">{title}</span>
      </div>
      <div className="hw-v3__items">
        {items.map(hw => <HomeworkCardV3 key={hw.id} hw={hw} mod={mod}/>)}
      </div>
    </div>
  );
}

function HomeworkCardV3({ hw, mod }) {
  const theme = SUBJECT_THEME[hw.subject];
  return (
    <div className={"hw-card-v3 hw-card-v3--" + mod}>
      <div className="hw-card-v3__hour">{hw.deadlineHour}</div>
      <div className="hw-card-v3__card">
        <div className="hw-card-v3__head">
          <span className="hw-card-v3__subject" style={{ background: theme.bg, color: theme.fg }}>
            <SIcon name={theme.icon} size={12} strokeWidth={2}/>
            {hw.subject}
          </span>
          <span className="hw-card-v3__est">
            <SIcon name="clock-3" size={12} strokeWidth={2}/>≈ {hw.est} мин · {hw.progress.done}/{hw.progress.total}
          </span>
        </div>
        <div className="hw-card-v3__title">{hw.title}</div>
        <div className="hw-card-v3__row">
          <span className="hw-card-v3__tutor">
            <Initials name={hw.tutor.name} theme={theme}/>
            {hw.tutor.name}
          </span>
        </div>
        <button className="hw-card-v3__cta">
          <span>{hw.progress.done === 0 ? "Начать решать" : "Продолжить"}</span>
          <SIcon name="arrow-right" size={14} strokeWidth={2}/>
        </button>
      </div>
    </div>
  );
}

Object.assign(window, {
  HomeworkListV1, HomeworkListV2, HomeworkListV3,
  HOMEWORK_DATA, SUBJECT_THEME, TUTORS,
});
