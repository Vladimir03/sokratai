/* global React, STUDENTS_DATA */
// Tutor Dashboard (Главная) v2 — redesigned per UX brief:
// 1. Primary CTA: only "Добавить ученика" on header. Payments CTA demoted.
// 2. Activity block: per-student weekly dynamics + attention signal.
// Reuses primitives from primitives.jsx, chrome.jsx, workplace.jsx, students-split.jsx (Sparkline).

const { useState: _dhUseState } = React;

// Extend each student with a 5-week activity strip (пн-вс blocks)
// status codes: ok / late / part / miss / none  (none = не назначалось)
const ACTIVITY_BY_STUDENT = {
  s1: { weekly:["ok","ok","ok","late","ok"], hwTrend:[4.2,4.4,4.5,4.6,4.6,4.8] },
  s2: { weekly:["ok","late","miss","miss","miss"], hwTrend:[4.0,3.9,3.8,3.6,3.5,3.6] },
  s3: { weekly:["ok","ok","ok","ok","ok"], hwTrend:[4.1,4.2,4.2,4.3,4.3,4.3] },
  s4: { weekly:["late","miss","miss","miss","miss"], hwTrend:[3.8,3.6,3.5,3.4,3.2,3.2] },
  s5: { weekly:["ok","ok","ok","ok","ok"], hwTrend:[4.7,4.8,4.8,4.9,4.9,4.9] },
  s6: { weekly:["ok","ok","late","miss","part"], hwTrend:[4.0,3.9,3.9,3.8,3.7,3.8] },
  s7: { weekly:["ok","ok","ok","ok","late"], hwTrend:[4.2,4.3,4.2,4.4,4.4,4.4] },
  s8: { weekly:["ok","ok","ok","late","ok"], hwTrend:[4.1,4.0,4.1,4.1,4.1,4.1] },
};

// Tone color per weekly cell
const CELL_COLOR = {
  ok: "var(--sokrat-state-success-fg)",
  late: "var(--sokrat-state-warning-fg)",
  part: "var(--sokrat-state-warning-fg)",
  miss: "var(--sokrat-state-danger-fg)",
  none: "var(--sokrat-border-light)",
};
const CELL_LABEL = { ok:"вовремя", late:"позже", part:"частично", miss:"не сдано", none:"—" };

function WeeklyStrip({ cells }) {
  // Last 5 weeks; latest on the right
  return (
    <div style={{display:"flex", gap:3, alignItems:"center"}} aria-label="Сдачи по неделям">
      {cells.map((c,i)=>(
        <Tooltip key={i} label={`Неделя −${cells.length-1-i}: ${CELL_LABEL[c]}`}>
          <span style={{
            width:14, height:20, borderRadius:3,
            background: CELL_COLOR[c],
            opacity: c==="none" ? 1 : 1,
            display:"inline-block",
          }}/>
        </Tooltip>
      ))}
    </div>
  );
}

// CTA row: primary + secondary hairline cards
function HomeCTAs({ onAddStudent, onAddPayment, onOpenStudents }) {
  return (
    <div className="home-ctas">
      <button className="home-cta home-cta--primary" onClick={onAddStudent}>
        <span className="home-cta__icon"><Icon name="user-plus" size={18} /></span>
        <span className="home-cta__body">
          <span className="home-cta__title">Добавить ученика</span>
          <span className="home-cta__sub">Ссылка-приглашение в Telegram</span>
        </span>
        <Icon name="arrow-right" size={16} />
      </button>
      <button className="home-cta" onClick={onOpenStudents}>
        <span className="home-cta__icon"><Icon name="clipboard-plus" size={18} /></span>
        <span className="home-cta__body">
          <span className="home-cta__title">Назначить ДЗ</span>
          <span className="home-cta__sub">Из базы или по теме</span>
        </span>
        <Icon name="arrow-right" size={16} />
      </button>
      <button className="home-cta" onClick={onAddPayment}>
        <span className="home-cta__icon"><Icon name="wallet" size={18} /></span>
        <span className="home-cta__body">
          <span className="home-cta__title">Выставить счёт</span>
          <span className="home-cta__sub">1 ждёт оплаты · 1 долг</span>
        </span>
        <Icon name="arrow-right" size={16} />
      </button>
    </div>
  );
}

function StudentsActivityCard({ students, onOpen }) {
  const [sort, setSort] = _dhUseState("attention"); // attention | delta | name
  const enriched = students.slice(0,12).map(s => {
    const a = ACTIVITY_BY_STUDENT[s.id] || { weekly:["none","none","none","none","none"], hwTrend:s.hwTrend||[] };
    return { ...s, weekly:a.weekly, hwTrend:a.hwTrend };
  });
  const sorted = [...enriched].sort((a,b) => {
    if (sort === "attention") {
      const aw = a.attention ? 0 : 1, bw = b.attention ? 0 : 1;
      if (aw !== bw) return aw - bw;
      return (b.hwAvgDelta||0) - (a.hwAvgDelta||0) * -1;
    }
    if (sort === "delta") return (a.hwAvgDelta||0) - (b.hwAvgDelta||0);
    return a.name.localeCompare(b.name, "ru");
  });
  const attentionCount = students.filter(s=>s.attention).length;

  return (
    <section className="t-section">
      <div className="t-section__header">
        <h2>Активность учеников</h2>
        <span className="t-section__meta">за 5 недель · {students.length} учеников</span>
        <div style={{marginLeft:"auto", display:"flex", alignItems:"center", gap:10}}>
          <Segment
            value={sort}
            onChange={setSort}
            items={[
              { value:"attention", label:`⚠ ${attentionCount}` },
              { value:"delta", label:"По тренду" },
              { value:"name", label:"А→Я" },
            ]}
          />
          <Button variant="ghost" size="sm" onClick={onOpen}>Все ученики</Button>
        </div>
      </div>
      <hr className="t-divider"/>
      <div className="t-table-wrap" style={{border:0, borderRadius:0}}>
        <table className="t-table home-activity-table">
          <thead>
            <tr>
              <th>Ученик</th>
              <th>Последние 5 недель</th>
              <th className="is-num">Ø балл ДЗ</th>
              <th>Тренд</th>
              <th className="is-num">Пробник</th>
              <th>Сигнал</th>
              <th className="is-actions"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(s => (
              <tr key={s.id} onClick={()=>onOpen(s.id)} style={{cursor:"pointer"}}>
                <td className="is-primary">
                  <span style={{display:"inline-flex", alignItems:"center", gap:8}}>
                    {s.attention
                      ? <span title={s.attentionReason} style={{width:6,height:6,borderRadius:"50%",background:"var(--sokrat-state-warning-fg)",flex:"none"}}/>
                      : <span style={{width:6,height:6,flex:"none"}}/>}
                    {s.name}
                    <Chip variant={s.stream==="ЕГЭ" ? "ege" : "oge"}>{s.stream}</Chip>
                  </span>
                </td>
                <td><WeeklyStrip cells={s.weekly}/></td>
                <td className="is-num">{s.hwAvg != null ? s.hwAvg.toFixed(1) : "—"}</td>
                <td style={{padding:"0 12px"}}>
                  {s.hwTrend && s.hwTrend.length > 1
                    ? <Sparkline values={s.hwTrend}
                        stroke={(s.hwAvgDelta||0) < 0 ? "var(--sokrat-state-danger-fg)" :
                                (s.hwAvgDelta||0) > 0 ? "var(--sokrat-state-success-fg)" :
                                "var(--sokrat-fg2)"} />
                    : <span className="t-muted" style={{fontSize:12}}>—</span>}
                </td>
                <td className="is-num">
                  {s.mockLast != null ? s.mockLast : "—"} <DeltaPill value={s.mockDelta}/>
                </td>
                <td style={{fontSize:12}}>
                  {s.attention
                    ? <span style={{color:"var(--sokrat-state-warning-fg)", fontWeight:600}}>{s.attentionReason}</span>
                    : <span className="t-muted">всё хорошо</span>}
                </td>
                <td className="is-actions">
                  <div className="row-actions">
                    <Tooltip label="Открыть статистику">
                      <Button variant="ghost" icon="chevron-right" iconOnly aria-label="Открыть"
                        onClick={(e)=>{e.stopPropagation(); onOpen(s.id);}}/>
                    </Tooltip>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <hr className="t-divider"/>
      <div style={{display:"flex", alignItems:"center", gap:16, padding:"10px 16px", fontSize:12, color:"var(--sokrat-fg3)"}}>
        <span>Условные обозначения:</span>
        <span style={{display:"inline-flex", alignItems:"center", gap:6}}><span style={{width:10,height:10,borderRadius:2,background:CELL_COLOR.ok}}/> вовремя</span>
        <span style={{display:"inline-flex", alignItems:"center", gap:6}}><span style={{width:10,height:10,borderRadius:2,background:CELL_COLOR.late}}/> позже / частично</span>
        <span style={{display:"inline-flex", alignItems:"center", gap:6}}><span style={{width:10,height:10,borderRadius:2,background:CELL_COLOR.miss}}/> не сдано</span>
        <span style={{marginLeft:"auto"}}>Клик по строке открывает статистику.</span>
      </div>
    </section>
  );
}

// Recent chats with students
// Sorted by last message timestamp desc.
const RECENT_CHATS = [
  { studentId:"s2", name:"Саша Петров",    stream:"ЕГЭ", from:"student", preview:"А в задаче 5 надо учитывать трение или нет?", at:"14 мин", hwId:"h7", hwTitle:"Кинематика 1D" },
  { studentId:"s4", name:"Артём Белов",     stream:"ЕГЭ", from:"student", preview:"Прислал фото решения, проверьте пожалуйста", at:"1 ч",   hwId:"h4", hwTitle:"Статика" },
  { studentId:"s1", name:"Маша Коротаева",  stream:"ЕГЭ", from:"me",      preview:"Посмотри разбор задачи 3, завтра обсудим", at:"3 ч",   hwId:"h1", hwTitle:"Кинематика 1D" },
  { studentId:"s6", name:"Никита Орлов",    stream:"ОГЭ", from:"student", preview:"Не понял как раскрывать скобки в дроби", at:"вчера 21:40", hwId:"h5", hwTitle:"Дроби и пропорции" },
  { studentId:"s5", name:"Катя Морозова",    stream:"ЕГЭ", from:"student", preview:"Готова, сдала ВСЕ задачи ", at:"вчера 19:12", hwId:"h2", hwTitle:"Динамика · Ньютон" },
];

function initialsOf(name) {
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
}

function ChatRow({ chat, onOpen }) {
  const isMe = chat.from === "me";
  return (
    <button
      type="button"
      className="chat-row"
      onClick={() => onOpen(chat)}
      title={`Открыть ДЗ «${chat.hwTitle}» с чатом ученика`}
    >
      <span className="chat-row__avatar" aria-hidden>{initialsOf(chat.name)}</span>
      <span className="chat-row__body">
        <span className="chat-row__top">
          <span className="chat-row__name">{chat.name}</span>
          <Chip variant={chat.stream==="ЕГЭ" ? "ege" : "oge"}>{chat.stream}</Chip>
          <span className="chat-row__time">{chat.at}</span>
        </span>
        <span className="chat-row__preview">
          {isMe ? <span className="chat-row__prefix">Вы: </span> : null}
          {chat.preview}
        </span>
      </span>
      <Icon name="chevron-right" size={16} />
    </button>
  );
}

function RecentChatsCard({ onOpen }) {
  const chats = RECENT_CHATS.slice(0, 5);
  return (
    <section className="t-section" style={{marginBottom:16}}>
      <div className="t-section__header">
        <h2>Последние диалоги</h2>
        <span className="t-section__meta">сортировка по времени последнего сообщения</span>
        <span style={{marginLeft:"auto"}}><Button variant="ghost" size="sm">Все чаты</Button></span>
      </div>
      <hr className="t-divider" />
      <div>
        {chats.map(c => <ChatRow key={c.studentId + c.at} chat={c} onOpen={onOpen}/>)}
      </div>
    </section>
  );
}

function TplDashboardV2({ onOpenStudent, onOpenStudents, onOpenHomework }) {
  return (
    <>
      <div className="home-header">
        <div style={{flex:1, minWidth:0}}>
          <h1 style={{margin:0, fontSize:24, fontWeight:600, letterSpacing:"-0.005em"}}>
            Добро пожаловать, Владимир
          </h1>
          <div className="t-muted" style={{fontSize:13, marginTop:4}}>
            Вторник, 21 апреля · 4 урока сегодня · 4 работы на проверке · 2 ученика требуют внимания
          </div>
        </div>
        <div style={{display:"flex", gap:8, flex:"none"}}>
          <Button variant="outline" size="md" icon="calendar-plus">Новое занятие</Button>
          <Button variant="primary" size="md" icon="user-plus" onClick={()=>onOpenStudents && onOpenStudents()}>
            Добавить ученика
          </Button>
        </div>
      </div>

      <HomeCTAs
        onAddStudent={()=>onOpenStudents && onOpenStudents()}
        onAddPayment={()=>{}}
        onOpenStudents={()=>onOpenStudents && onOpenStudents()}
      />

      <div className="t-stats" style={{marginBottom:16}}>
        <div className="t-stats__cell">
          <div className="t-stats__label">Активных учеников</div>
          <div className="t-stats__value">14</div>
          <div className="t-stats__meta" style={{color:"var(--sokrat-state-success-fg)"}}>+2 за неделю</div>
        </div>
        <div className="t-stats__cell">
          <div className="t-stats__label">Требуют внимания</div>
          <div className="t-stats__value" style={{color:"var(--sokrat-state-warning-fg)"}}>2</div>
          <div className="t-stats__meta">просрочки, падение балла</div>
        </div>
        <div className="t-stats__cell">
          <div className="t-stats__label">Ø балл за неделю</div>
          <div className="t-stats__value">4,3</div>
          <div className="t-stats__meta" style={{color:"var(--sokrat-state-success-fg)"}}>+0,1 к прошлой</div>
        </div>
        <div className="t-stats__cell">
          <div className="t-stats__label">К оплате</div>
          <div className="t-stats__value">24 000 ₽</div>
          <div className="t-stats__meta">1 ждёт · 1 долг</div>
        </div>
      </div>

      <div className="t-grid-2" style={{marginBottom:16}}>
        <section className="t-section">
          <div className="t-section__header">
            <h2>Сегодня</h2>
            <span className="t-section__meta">4 занятия · 1 окно</span>
            <span style={{marginLeft:"auto"}}><Button variant="ghost" size="sm">Расписание</Button></span>
          </div>
          <hr className="t-divider" />
          <div style={{display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, padding:12}}>
            <SessionBlock s={{time:"10:00", name:"Маша К.",   topic:"Кинематика · разбор ДЗ", stream:"ЕГЭ"}}/>
            <SessionBlock s={{time:"13:00", name:"Лена И.",   topic:"Квадратные уравнения",   stream:"ОГЭ"}}/>
            <SessionBlock s={{time:"16:00", name:"Саша П.",   topic:"Производная, тренажёр",  stream:"ЕГЭ"}}/>
            <SessionBlock s={{time:"19:00", name:"Группа 11А",topic:"Динамика · пробник",     stream:"ЕГЭ"}}/>
          </div>
        </section>

        <section className="t-section">
          <div className="t-section__header">
            <h2>Требует проверки</h2>
            <span className="t-section__meta">4 работы</span>
            <span style={{marginLeft:"auto"}}><Button variant="ghost" size="sm">Все ДЗ</Button></span>
          </div>
          <hr className="t-divider" />
          <div>
            <SubmissionRow sub={{id:"r1", name:"Маша Коротаева", stream:"ЕГЭ", submittedAt:"21.04 09:14", score:8, total:8, answers:["ok","ok","ok","ok","ok","ok","ok","ok"], aiFlag:"ok"}}/>
            <SubmissionRow sub={{id:"r2", name:"Саша Петров",    stream:"ЕГЭ", submittedAt:"20.04 22:02", score:5, total:8, answers:["ok","ok","ok","part","ok","ok","miss","miss"], aiFlag:"warn", aiWarnCount:2}}/>
            <SubmissionRow sub={{id:"r3", name:"Катя Морозова",  stream:"ЕГЭ", submittedAt:"20.04 21:40", score:7, total:8, answers:["ok","ok","ok","ok","ok","ok","part","ok"], aiFlag:"ok"}}/>
            <SubmissionRow sub={{id:"r4", name:"Данил Киселёв",  stream:"ЕГЭ", submittedAt:"21.04 11:18", score:6, total:8, answers:["ok","ok","ok","ok","miss","ok","ok","part"], aiFlag:"warn", aiWarnCount:1}}/>
          </div>
        </section>
      </div>

      <StudentsActivityCard students={STUDENTS_DATA} onOpen={onOpenStudent}/>

      <RecentChatsCard onOpen={(chat) => onOpenHomework && onOpenHomework(chat)} />
    </>
  );
}

Object.assign(window, { TplDashboardV2, StudentsActivityCard, HomeCTAs, RecentChatsCard });
