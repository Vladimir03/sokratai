/* global React */
// Tutor kit — page templates
// Sample data is inline for preview purposes only.

const { useState } = React;

const SAMPLE_STUDENTS = [
  { id:"s1", name:"Маша Коротаева", grade:10, stream:"ЕГЭ", subjects:["физика","математика"], progress:78, lastSession:"11.03 18:00", statusTone:"success", statusLabel:"активна", tutor:"Владимир Г.", since:"сен. 2024" },
  { id:"s2", name:"Саша Петров",    grade:11, stream:"ЕГЭ", subjects:["математика"],          progress:54, lastSession:"10.03 17:00", statusTone:"warning", statusLabel:"долг по ДЗ" },
  { id:"s3", name:"Лена Иванова",   grade:9,  stream:"ОГЭ", subjects:["математика"],          progress:64, lastSession:"12.03 16:00", statusTone:"success", statusLabel:"активна" },
  { id:"s4", name:"Артём Белов",    grade:11, stream:"ЕГЭ", subjects:["физика"],              progress:41, lastSession:"05.03 19:00", statusTone:"danger",  statusLabel:"просрочено" },
  { id:"s5", name:"Катя Морозова",  grade:10, stream:"ЕГЭ", subjects:["физика","математика"], progress:92, lastSession:"12.03 17:00", statusTone:"success", statusLabel:"активна" },
  { id:"s6", name:"Никита Орлов",   grade:9,  stream:"ОГЭ", subjects:["математика"],          progress:33, lastSession:"07.03 15:00", statusTone:"warning", statusLabel:"на проверке" },
  { id:"s7", name:"Полина Сидорова",grade:11, stream:"ЕГЭ", subjects:["математика"],          progress:71, lastSession:"11.03 20:00", statusTone:"info",    statusLabel:"назначено" },
  { id:"s8", name:"Данил Киселёв",  grade:10, stream:"ЕГЭ", subjects:["физика"],              progress:58, lastSession:"09.03 18:00", statusTone:"success", statusLabel:"активен" },
];

const SAMPLE_HW = [
  { id:"h1", title:"Кинематика 1D",         stream:"ЕГЭ", tasks:8,  assigned:12, total:14, due:"12.03", statusTone:"info",    statusLabel:"идёт" },
  { id:"h2", title:"Квадратные уравнения",  stream:"ОГЭ", tasks:10, assigned:4,  total:9,  due:"14.03", statusTone:"warning", statusLabel:"проверка (3)" },
  { id:"h3", title:"Тригонометрия №2",      stream:"ЕГЭ", tasks:6,  assigned:0,  total:0,  due:"—",     statusTone:"neutral", statusLabel:"черновик" },
  { id:"h4", title:"Динамика · Ньютон",     stream:"ЕГЭ", tasks:12, assigned:8,  total:8,  due:"10.03", statusTone:"success", statusLabel:"завершено" },
  { id:"h5", title:"Дроби и проценты",      stream:"ОГЭ", tasks:14, assigned:6,  total:9,  due:"16.03", statusTone:"info",    statusLabel:"идёт" },
];

const SAMPLE_TASKS = [
  { id:"t1", code:"1.1.4", topic:"Кинематика 1D",       stream:"ЕГЭ", subject:"Физика",     difficulty:2, source:"ФИПИ",      uses:12, updated:"11.03",
    statement:"Тело движется равноускоренно из состояния покоя. За 4 секунды оно проходит 32 м. Найти ускорение тела.",
    formula:"s = \\frac{a t^2}{2}", answer:"4", unit:"м/с²", tolerance:"0.1" },
  { id:"t2", code:"2.3.1", topic:"Теорема Пифагора",    stream:"ОГЭ", subject:"Математика", difficulty:1, source:"Авторская", uses:34, updated:"08.03",
    statement:"В прямоугольном треугольнике катеты равны 5 и 12. Найти гипотенузу.",
    formula:"c = \\sqrt{a^2 + b^2}", answer:"13", unit:"", tolerance:"" },
  { id:"t3", code:"3.2.2", topic:"Квадратные уравнения",stream:"ОГЭ", subject:"Математика", difficulty:2, source:"ФИПИ",      uses:21, updated:"06.03",
    statement:"Решите уравнение x² − 5x + 6 = 0. В ответе укажите сумму корней.",
    formula:"", answer:"5", unit:"", tolerance:"" },
  { id:"t4", code:"1.2.7", topic:"Динамика",            stream:"ЕГЭ", subject:"Физика",     difficulty:3, source:"Стрельцов", uses:7,  updated:"03.03",
    statement:"Брусок массой 2 кг скользит по наклонной плоскости под углом 30°. Коэффициент трения 0.2. Найти ускорение.",
    formula:"a = g(\\sin\\alpha - \\mu\\cos\\alpha)", answer:"3.3", unit:"м/с²", tolerance:"0.1" },
];

const SAMPLE_SESSIONS_TODAY = [
  { time:"10:00", name:"Маша К.",   topic:"Кинематика · разбор ДЗ", stream:"ЕГЭ" },
  { time:"13:00", name:"Лена И.",   topic:"Квадратные уравнения",   stream:"ОГЭ" },
  { time:"16:00", name:"Саша П.",   topic:"Производная, тренажёр",  stream:"ЕГЭ" },
  { time:"19:00", name:"Группа 11А",topic:"Динамика · пробник",     stream:"ЕГЭ" },
];

const SAMPLE_SESSIONS_WEEK = [
  { day:0, hour:10, time:"10:00", name:"Маша К.",    topic:"Кинематика",   stream:"ЕГЭ" },
  { day:0, hour:16, time:"16:00", name:"Саша П.",    topic:"Производная",  stream:"ЕГЭ" },
  { day:1, hour:13, time:"13:00", name:"Лена И.",    topic:"Квадратные",   stream:"ОГЭ" },
  { day:2, hour:19, time:"19:00", name:"Группа 11А", topic:"Динамика",     stream:"ЕГЭ" },
  { day:3, hour:11, time:"11:00", name:"Катя М.",    topic:"Тригонометрия",stream:"ЕГЭ" },
  { day:3, hour:17, time:"17:00", name:"Артём Б.",   topic:"Статика",      stream:"ЕГЭ" },
  { day:4, hour:15, time:"15:00", name:"Никита О.",  topic:"Дроби",        stream:"ОГЭ" },
  { day:5, hour:12, time:"12:00", name:"Полина С.",  topic:"Логарифмы",    stream:"ЕГЭ" },
];

const SAMPLE_SUBMISSIONS = [
  { id:"r1", name:"Маша Коротаева", stream:"ЕГЭ", submittedAt:"11.03 21:14", score:8, total:8, answers:["ok","ok","ok","ok","ok","ok","ok","ok"], aiFlag:"ok" },
  { id:"r2", name:"Саша Петров",    stream:"ЕГЭ", submittedAt:"12.03 09:02", score:5, total:8, answers:["ok","ok","ok","part","ok","ok","miss","miss"], aiFlag:"warn", aiWarnCount:2 },
  { id:"r3", name:"Катя Морозова",  stream:"ЕГЭ", submittedAt:"11.03 22:40", score:7, total:8, answers:["ok","ok","ok","ok","ok","ok","part","ok"], aiFlag:"ok" },
  { id:"r4", name:"Данил Киселёв",  stream:"ЕГЭ", submittedAt:"12.03 11:18", score:6, total:8, answers:["ok","ok","ok","ok","miss","ok","ok","part"], aiFlag:"warn", aiWarnCount:1 },
];

const SAMPLE_PAYMENTS = [
  { id:"p1", name:"Маша Коротаева", plan:"8 занятий / мес",  period:"март 2025", amount:24000, statusTone:"success", statusLabel:"оплачено", action:"Чек" },
  { id:"p2", name:"Саша Петров",    plan:"4 занятия / мес",  period:"март 2025", amount:12000, statusTone:"warning", statusLabel:"ожидает",  action:"Напомнить" },
  { id:"p3", name:"Лена Иванова",   plan:"8 занятий / мес",  period:"март 2025", amount:20000, statusTone:"success", statusLabel:"оплачено", action:"Чек" },
  { id:"p4", name:"Артём Белов",    plan:"4 занятия / мес",  period:"март 2025", amount:12000, statusTone:"danger",  statusLabel:"долг",     action:"Связаться" },
];

// ───────────────────────────────────────────────────────────────
// Dashboard
// ───────────────────────────────────────────────────────────────
function TplDashboard() {
  return (
    <>
      <PageHeader
        title="Главная"
        meta="Вторник, 12 марта · 4 урока сегодня · 4 работы на проверке"
        primary={<Button variant="primary" size="md" icon="plus">Новое ДЗ</Button>}
      />

      <div className="t-stats" style={{marginBottom:16}}>
        <div className="t-stats__cell">
          <div className="t-stats__label">Активных учеников</div>
          <div className="t-stats__value">28</div>
          <div className="t-stats__meta">+2 за неделю</div>
        </div>
        <div className="t-stats__cell">
          <div className="t-stats__label">На проверке</div>
          <div className="t-stats__value">4</div>
          <div className="t-stats__meta">требует внимания</div>
        </div>
        <div className="t-stats__cell">
          <div className="t-stats__label">Ср. балл за неделю</div>
          <div className="t-stats__value">4,6</div>
          <div className="t-stats__meta">+0,2 к прошлой</div>
        </div>
        <div className="t-stats__cell">
          <div className="t-stats__label">Поступления за месяц</div>
          <div className="t-stats__value">148 000 ₽</div>
          <div className="t-stats__meta">11 платежей</div>
        </div>
      </div>

      <div className="t-grid-2" style={{marginBottom:16}}>
        <section className="t-section">
          <div className="t-section__header">
            <h2>Сегодня</h2>
            <span className="t-section__meta">{SAMPLE_SESSIONS_TODAY.length} занятий</span>
            <span style={{marginLeft:"auto"}}><Button variant="ghost" size="sm">Открыть расписание</Button></span>
          </div>
          <hr className="t-divider" />
          <div style={{display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, padding:12}}>
            {SAMPLE_SESSIONS_TODAY.map((s,i) => <SessionBlock key={i} s={s} />)}
          </div>
        </section>

        <section className="t-section">
          <div className="t-section__header">
            <h2>Требует проверки</h2>
            <span className="t-section__meta">{SAMPLE_SUBMISSIONS.length} работ</span>
            <span style={{marginLeft:"auto"}}><Button variant="ghost" size="sm">Открыть все</Button></span>
          </div>
          <hr className="t-divider" />
          <div>
            {SAMPLE_SUBMISSIONS.map(sub => <SubmissionRow key={sub.id} sub={sub} />)}
          </div>
        </section>
      </div>

      <section className="t-section">
        <div className="t-section__header">
          <h2>Активность учеников</h2>
          <span className="t-section__meta">Топ‑8</span>
          <span style={{marginLeft:"auto"}}><Button variant="ghost" size="sm">Все ученики</Button></span>
        </div>
        <hr className="t-divider" />
        <RosterTable students={SAMPLE_STUDENTS} />
      </section>
    </>
  );
}

// ───────────────────────────────────────────────────────────────
// HomeworkList
// ───────────────────────────────────────────────────────────────
function TplHomeworkList() {
  const [tab, setTab] = useState("active");
  const [view, setView] = useState("table");
  const [sel, setSel] = useState(new Set());
  return (
    <>
      <PageHeader
        title="Домашние задания"
        meta="12 активных · 4 на проверке · 38 в архиве"
        primary={<Button variant="primary" size="md" icon="plus">Создать ДЗ</Button>}
      />

      <Toolbar>
        <ToolbarSearch placeholder="Поиск по названию или теме" />
        <Chip variant="filter">Поток</Chip>
        <Chip variant="filter">Предмет</Chip>
        <Chip variant="filter">Срок</Chip>
        <span className="t-toolbar__spacer" />
        <ToolbarViewSwitch value={view} onChange={setView} />
      </Toolbar>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value:"active", label:"Активные", count:12 },
          { value:"review", label:"На проверке", count:4 },
          { value:"archive", label:"Архив", count:38 },
        ]}
      />

      {view === "table" ? (
        <div className="t-table-wrap">
          <table className="t-table">
            <thead>
              <tr>
                <th className="is-check"><input type="checkbox" /></th>
                <th>Название</th>
                <th>Поток</th>
                <th className="is-num">Задач</th>
                <th>Ученики</th>
                <th>Срок</th>
                <th>Статус</th>
                <th className="is-actions"></th>
              </tr>
            </thead>
            <tbody>
              {SAMPLE_HW.map(hw => {
                const selected = sel.has(hw.id);
                return (
                  <tr key={hw.id} aria-selected={selected || undefined}>
                    <td className="is-check">
                      <input type="checkbox" checked={selected} onChange={e => {
                        const n = new Set(sel); e.target.checked ? n.add(hw.id) : n.delete(hw.id); setSel(n);
                      }} />
                    </td>
                    <td className="is-primary">{hw.title}</td>
                    <td><Chip variant={hw.stream === "ЕГЭ" ? "ege" : "oge"}>{hw.stream}</Chip></td>
                    <td className="is-num">{hw.tasks}</td>
                    <td className="t-muted t-num">{hw.assigned}/{hw.total}</td>
                    <td className="t-muted t-num">{hw.due}</td>
                    <td><StatusDot tone={hw.statusTone}>{hw.statusLabel}</StatusDot></td>
                    <td className="is-actions">
                      <div className="row-actions">
                        <Tooltip label="Открыть"><Button variant="ghost" icon="chevron-right" iconOnly aria-label="Открыть" /></Tooltip>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="t-grid-3">{SAMPLE_HW.map(hw => <HomeworkSetCard key={hw.id} hw={hw} />)}</div>
      )}

      <BulkActionBar count={sel.size} onClear={() => setSel(new Set())}>
        <Button variant="outline" size="sm" icon="user-plus">Назначить ученикам</Button>
        <Button variant="outline" size="sm" icon="copy">Дублировать</Button>
        <Button variant="outline" size="sm" icon="archive">В архив</Button>
      </BulkActionBar>
    </>
  );
}

// ───────────────────────────────────────────────────────────────
// HomeworkDetail
// ───────────────────────────────────────────────────────────────
function TplHomeworkDetail() {
  const [tab, setTab] = useState("tasks");
  const [openSub, setOpenSub] = useState("r2");
  return (
    <>
      <PageHeader
        title="Кинематика 1D — ЕГЭ, физика"
        meta="Срок 12.03 · 8 задач · назначено 12 из 14 · 4 работы сдано"
        primary={<Button variant="primary" size="md" icon="user-plus">Назначить ещё</Button>}
      />

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value:"tasks",    label:"Задачи", count:8 },
          { value:"results",  label:"Результаты", count:4 },
          { value:"analytics",label:"Аналитика" },
          { value:"settings", label:"Настройки" },
        ]}
      />

      {tab === "tasks" && (
        <section className="t-section">
          {SAMPLE_TASKS.map((t,i) => <TaskCard key={t.id} index={i+1} task={t} />)}
        </section>
      )}

      {tab === "results" && (
        <section className="t-section">
          {SAMPLE_SUBMISSIONS.map(sub => (
            <React.Fragment key={sub.id}>
              <SubmissionRow sub={sub} expanded={openSub === sub.id} onToggle={() => setOpenSub(openSub === sub.id ? null : sub.id)} />
              {openSub === sub.id && (
                <div style={{padding:"0 16px 16px", background:"var(--sokrat-surface)"}}>
                  <div style={{height:12}} />
                  <SubmissionReview sub={sub} />
                </div>
              )}
            </React.Fragment>
          ))}
        </section>
      )}

      {tab === "analytics" && (
        <section className="t-section">
          <EmptyState title="Аналитика появится после 5 сдач" body="Сейчас сдано 4 из 12. Нужно ещё хотя бы одна работа, чтобы показать распределение ошибок по задачам." cta={<Button variant="outline" size="md">Открыть результаты</Button>} />
        </section>
      )}

      {tab === "settings" && (
        <section className="t-section">
          <div style={{padding:16, display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, maxWidth:720}}>
            <Field label="Название"><Input defaultValue="Кинематика 1D" /></Field>
            <Field label="Срок сдачи"><Input defaultValue="12.03.2025" /></Field>
            <Field label="Поток"><Input defaultValue="ЕГЭ" /></Field>
            <Field label="Предмет"><Input defaultValue="Физика" /></Field>
          </div>
        </section>
      )}
    </>
  );
}

// ───────────────────────────────────────────────────────────────
// StudentProfile
// ───────────────────────────────────────────────────────────────
function TplStudentProfile() {
  const [tab, setTab] = useState("overview");
  const student = { ...SAMPLE_STUDENTS[0], tutor:"Владимир Г.", since:"сен. 2024" };
  const group = {
    name: "Группа 11А · физика",
    stream: "ЕГЭ",
    note: "Готовятся к пробнику 20 марта. Основной фокус — динамика и статика.",
    members: SAMPLE_STUDENTS.slice(0,4),
    sharedHomework: SAMPLE_HW.slice(0,2),
  };
  return (
    <>
      <PageHeader
        title="Маша Коротаева"
        meta="10 класс · ЕГЭ · физика, математика · репетитор Владимир Г."
        primary={<Button variant="primary" size="md" icon="clipboard-plus">Новое ДЗ</Button>}
      />

      <StudentCard student={student} />

      <div style={{height:12}} />

      <div className="t-stats">
        <div className="t-stats__cell"><div className="t-stats__label">Сдано ДЗ</div><div className="t-stats__value">32</div><div className="t-stats__meta">из 36 назначенных</div></div>
        <div className="t-stats__cell"><div className="t-stats__label">Ср. балл</div><div className="t-stats__value">4,7</div><div className="t-stats__meta">+0,3 за месяц</div></div>
        <div className="t-stats__cell"><div className="t-stats__label">Активных ДЗ</div><div className="t-stats__value">3</div><div className="t-stats__meta">1 на проверке</div></div>
        <div className="t-stats__cell"><div className="t-stats__label">Посл. занятие</div><div className="t-stats__value" style={{fontSize:18}}>11.03</div><div className="t-stats__meta">кинематика</div></div>
      </div>

      <div style={{height:16}} />

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value:"overview", label:"Обзор" },
          { value:"homework", label:"Домашние задания", count:3 },
          { value:"sessions", label:"Занятия" },
          { value:"payments", label:"Платежи" },
          { value:"notes",    label:"Заметки" },
        ]}
      />

      {tab === "overview" && (
        <div className="t-grid-2">
          <section className="t-section">
            <div className="t-section__header"><h2>Недавние ДЗ</h2><span style={{marginLeft:"auto"}}><Button variant="ghost" size="sm">Все ДЗ</Button></span></div>
            <hr className="t-divider" />
            {SAMPLE_HW.slice(0,4).map(hw => <HomeworkListRow key={hw.id} hw={hw} />)}
          </section>
          <section className="t-section">
            <div className="t-section__header"><h2>Прогресс по темам</h2></div>
            <hr className="t-divider" />
            <div style={{padding:"10px 16px", display:"flex", flexDirection:"column", gap:10}}>
              {[
                { t:"Кинематика", v:86 },
                { t:"Динамика", v:71 },
                { t:"Статика", v:54 },
                { t:"Термодинамика", v:38 },
                { t:"Электричество", v:12 },
              ].map(r => (
                <div key={r.t} className="t-hstack" style={{gap:12}}>
                  <span style={{width:150, fontSize:13, color:"var(--sokrat-fg1)"}}>{r.t}</span>
                  <Progress value={r.v} label={`${r.v}%`} />
                </div>
              ))}
            </div>
            <hr className="t-divider" />
            <div className="t-group__section-label">Заметки тьютора</div>
            <div className="t-group__inset" style={{marginBottom:12}}>
              Маша уверенно решает кинематику; сильно проседает на термодинамике — вернуться к первому закону на следующем занятии.
            </div>
          </section>
        </div>
      )}

      {tab === "homework" && (
        <section className="t-section">{SAMPLE_HW.slice(0,4).map(hw => <HomeworkListRow key={hw.id} hw={hw} />)}</section>
      )}
      {tab === "sessions" && (
        <section className="t-section"><div style={{padding:12}}><WeekGrid sessions={SAMPLE_SESSIONS_WEEK} /></div></section>
      )}
      {tab === "payments" && (
        <section className="t-section">{SAMPLE_PAYMENTS.slice(0,2).map(p => <PaymentRow key={p.id} p={p} />)}</section>
      )}
      {tab === "notes" && (
        <section className="t-section"><div style={{padding:16}}><GroupPanel group={group} bare /></div></section>
      )}
    </>
  );
}

// ───────────────────────────────────────────────────────────────
// TaskBank
// ───────────────────────────────────────────────────────────────
function TplTaskBank() {
  const [openTask, setOpenTask] = useState(null);
  return (
    <>
      <PageHeader
        title="База задач"
        meta="412 задач · 86 моих · источники: ФИПИ, Стрельцов, авторские"
        primary={<Button variant="primary" size="md" icon="plus">Создать задачу</Button>}
      />

      <Toolbar>
        <ToolbarSearch placeholder="Поиск по условию, формуле или кодификатору" />
        <Chip variant="filter">Поток</Chip>
        <Chip variant="filter">Предмет</Chip>
        <Chip variant="filter">Тема</Chip>
        <Chip variant="filter">Сложность</Chip>
        <span className="t-toolbar__spacer" />
        <ToolbarViewSwitch value="table" onChange={()=>{}} />
      </Toolbar>

      <div className="t-grid-2" style={{gridTemplateColumns:"minmax(0,1fr) minmax(0,380px)"}}>
        <div className="t-table-wrap">
          <table className="t-table">
            <thead>
              <tr>
                <th>Код</th>
                <th>Тема</th>
                <th>Поток</th>
                <th>Предмет</th>
                <th>Сложность</th>
                <th>Источник</th>
                <th className="is-num">Использ.</th>
                <th className="is-num">Обновл.</th>
              </tr>
            </thead>
            <tbody>
              {SAMPLE_TASKS.map(t => <TaskBankRow key={t.id} task={t} onOpen={setOpenTask} />)}
            </tbody>
          </table>
        </div>
        <section className="t-section">
          <div className="t-section__header">
            <h2>{openTask ? openTask.code : "Выберите задачу"}</h2>
            <span style={{marginLeft:"auto"}}>{openTask && <Chip variant={openTask.stream === "ЕГЭ" ? "ege" : "oge"}>{openTask.stream}</Chip>}</span>
          </div>
          <hr className="t-divider" />
          {openTask ? (
            <div style={{padding:"10px 16px 14px"}}>
              <div style={{fontSize:14, lineHeight:1.55, color:"var(--sokrat-fg1)", marginBottom:8}}>{openTask.statement}</div>
              {openTask.formula && <FormulaBlock tex={openTask.formula} />}
              <div style={{marginTop:10, display:"flex", flexWrap:"wrap", gap:"8px 16px", fontSize:12, color:"var(--sokrat-fg3)"}}>
                <span>Ответ: <span className="t-num" style={{color:"var(--sokrat-fg1)", fontWeight:500}}>{openTask.answer}</span>{openTask.unit && <span className="t-unit"> {openTask.unit}</span>}</span>
                {openTask.tolerance && <span>Допуск: <span className="t-num" style={{color:"var(--sokrat-fg1)", fontWeight:500}}>±{openTask.tolerance}</span></span>}
                <span className="t-hstack">Сложность: <Difficulty level={openTask.difficulty} /></span>
              </div>
              <div className="t-hstack" style={{marginTop:12, gap:6}}>
                <Button variant="primary" size="sm" icon="clipboard-plus">Добавить в ДЗ</Button>
                <Button variant="outline" size="sm" icon="pencil">Редактировать</Button>
              </div>
            </div>
          ) : (
            <EmptyState title="Откройте задачу слева" body="Карточка покажет условие, ответ, допуск и кодификатор — и позволит сразу добавить задачу в активное ДЗ." />
          )}
        </section>
      </div>
    </>
  );
}

Object.assign(window, { TplDashboard, TplHomeworkList, TplHomeworkDetail, TplStudentProfile, TplTaskBank });
