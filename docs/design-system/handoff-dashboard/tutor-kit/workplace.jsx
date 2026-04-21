/* global React */
// Tutor kit — workplace components

// ─── StudentRow (list item) ───
function StudentRow({ student, onOpen }) {
  return (
    <div className="t-studentrow">
      <Avatar name={student.name} size={32} ring={student.stream === "ЕГЭ" ? "ege" : "oge"} />
      <div>
        <div className="t-studentrow__name">{student.name}</div>
        <div className="t-studentrow__meta">{student.grade} класс · {student.subjects.join(", ")}</div>
      </div>
      <div className="t-studentrow__right">
        <Chip variant={student.stream === "ЕГЭ" ? "ege" : "oge"}>{student.stream}</Chip>
        <Progress value={student.progress} label={`${student.progress}%`} />
        <span className="t-muted t-num" style={{fontSize:12}}>{student.lastSession}</span>
        <StatusDot tone={student.statusTone}>{student.statusLabel}</StatusDot>
        <Button variant="ghost" size="sm" icon="chevron-right" iconOnly aria-label="Открыть" onClick={() => onOpen && onOpen(student)} />
      </div>
    </div>
  );
}

// ─── RosterTable ───
function RosterTable({ students, selection, onSelect }) {
  const allSel = selection && students.every(s => selection.has(s.id));
  return (
    <div className="t-table-wrap">
      <table className="t-table">
        <thead>
          <tr>
            <th className="is-check">
              <input type="checkbox" checked={!!allSel}
                onChange={e => onSelect && onSelect(e.target.checked ? new Set(students.map(s=>s.id)) : new Set())} />
            </th>
            <th>Ученик</th>
            <th>Поток</th>
            <th>Предметы</th>
            <th className="is-num">Прогресс</th>
            <th>Посл. занятие</th>
            <th>Статус</th>
            <th className="is-actions" aria-label="Действия"></th>
          </tr>
        </thead>
        <tbody>
          {students.map(s => {
            const sel = selection && selection.has(s.id);
            return (
              <tr key={s.id} aria-selected={sel || undefined}>
                <td className="is-check">
                  <input type="checkbox" checked={!!sel}
                    onChange={e => {
                      if (!onSelect) return;
                      const next = new Set(selection || []);
                      e.target.checked ? next.add(s.id) : next.delete(s.id);
                      onSelect(next);
                    }} />
                </td>
                <td className="is-primary">{s.name}</td>
                <td><Chip variant={s.stream === "ЕГЭ" ? "ege" : "oge"}>{s.stream}</Chip></td>
                <td className="t-muted">{s.subjects.join(", ")}</td>
                <td className="is-num">{s.progress}%</td>
                <td className="t-num t-muted">{s.lastSession}</td>
                <td><StatusDot tone={s.statusTone}>{s.statusLabel}</StatusDot></td>
                <td className="is-actions">
                  <div className="row-actions">
                    <Tooltip label="Назначить ДЗ"><Button variant="ghost" icon="clipboard-plus" iconOnly aria-label="Назначить ДЗ" /></Tooltip>
                    <Tooltip label="Открыть"><Button variant="ghost" icon="chevron-right" iconOnly aria-label="Открыть" /></Tooltip>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── StudentCard (profile header block) ───
function StudentCard({ student, primary }) {
  return (
    <div className="t-card">
      <div className="t-card__header">
        <Avatar name={student.name} size={56} ring={student.stream === "ЕГЭ" ? "ege" : "oge"} />
        <div style={{flex:1, minWidth:0}}>
          <div className="t-card__title" style={{fontSize:18}}>{student.name}</div>
          <div className="t-muted" style={{fontSize:13, marginTop:2}}>
            {student.grade} класс · {student.stream} ({student.subjects.join(", ")})
          </div>
          <div className="t-muted" style={{fontSize:12, marginTop:2}}>
            Репетитор: {student.tutor} · с {student.since}
          </div>
        </div>
        {primary}
      </div>
    </div>
  );
}

// ─── HomeworkListRow ───
function HomeworkListRow({ hw, onOpen }) {
  return (
    <div className="t-listrow">
      <div style={{flex:1, minWidth:0, display:"flex", flexDirection:"column", gap:2}}>
        <span className="t-listrow__title">{hw.title}</span>
        <span className="t-listrow__meta">{hw.tasks} задач · назначено {hw.assigned} из {hw.total}</span>
      </div>
      <Chip variant={hw.stream === "ЕГЭ" ? "ege" : "oge"}>{hw.stream}</Chip>
      <span className="t-listrow__meta">Срок {hw.due}</span>
      <StatusDot tone={hw.statusTone}>{hw.statusLabel}</StatusDot>
      <Button variant="ghost" size="sm" icon="chevron-right" iconOnly aria-label="Открыть" onClick={()=>onOpen && onOpen(hw)} />
    </div>
  );
}

// ─── HomeworkSetCard (grid view, restrained — not featured) ───
function HomeworkSetCard({ hw }) {
  return (
    <div className="t-card t-card--interactive" tabIndex={0}>
      <div className="t-card__body">
        <div className="t-hstack" style={{marginBottom:8}}>
          <Chip variant={hw.stream === "ЕГЭ" ? "ege" : "oge"}>{hw.stream}</Chip>
          <StatusDot tone={hw.statusTone}>{hw.statusLabel}</StatusDot>
        </div>
        <div className="t-card__title" style={{marginBottom:6}}>{hw.title}</div>
        <div className="t-muted" style={{fontSize:13}}>{hw.tasks} задач · {hw.assigned} из {hw.total} учеников</div>
      </div>
      <hr className="t-divider" />
      <div className="t-card__footer" style={{justifyContent:"space-between", padding:"10px 16px"}}>
        <span className="t-muted t-num" style={{fontSize:12}}>Срок {hw.due}</span>
        <Button variant="ghost" size="sm" icon="chevron-right" iconOnly aria-label="Открыть" />
      </div>
    </div>
  );
}

// ─── TaskCard ───
function TaskCard({ index, task }) {
  return (
    <div className="t-task">
      <div className="t-task__num">{String(index).padStart(2, "0")}</div>
      <div className="t-task__body">
        <div className="t-task__statement">{task.statement}</div>
        {task.formula && <FormulaBlock tex={task.formula} />}
        <div className="t-task__meta" style={{marginTop:8}}>
          <span><span className="t-task__meta-key">Ответ:</span> <span className="t-task__meta-val t-num">{task.answer}</span>{task.unit && <span className="t-unit"> {task.unit}</span>}</span>
          {task.tolerance && <span><span className="t-task__meta-key">Допуск:</span> <span className="t-task__meta-val t-num">±{task.tolerance}</span></span>}
          <span><span className="t-task__meta-key">Код:</span> <span className="t-task__meta-val">{task.code}</span></span>
          <span className="t-hstack"><span className="t-task__meta-key">Сложность:</span> <Difficulty level={task.difficulty} /></span>
        </div>
      </div>
      <div className="t-task__actions">
        <Tooltip label="Редактировать"><Button variant="ghost" icon="pencil" iconOnly aria-label="Редактировать" /></Tooltip>
        <Tooltip label="Заменить"><Button variant="ghost" icon="refresh-cw" iconOnly aria-label="Заменить" /></Tooltip>
        <Tooltip label="Удалить"><Button variant="ghost" icon="trash-2" iconOnly aria-label="Удалить" /></Tooltip>
      </div>
    </div>
  );
}

// ─── TaskBankRow ───
function TaskBankRow({ task, onOpen }) {
  return (
    <tr onClick={()=>onOpen && onOpen(task)} style={{cursor:"pointer"}}>
      <td className="is-primary t-num">{task.code}</td>
      <td>{task.topic}</td>
      <td><Chip variant={task.stream === "ЕГЭ" ? "ege" : "oge"}>{task.stream}</Chip></td>
      <td className="t-muted">{task.subject}</td>
      <td><Difficulty level={task.difficulty} /></td>
      <td className="t-muted">{task.source}</td>
      <td className="is-num">{task.uses}</td>
      <td className="is-num t-muted">{task.updated}</td>
    </tr>
  );
}

// ─── SubmissionRow ───
function SubmissionRow({ sub, expanded, onToggle }) {
  return (
    <>
      <div className="t-studentrow" style={{cursor:"pointer"}} onClick={onToggle}>
        <Avatar name={sub.name} size={32} ring={sub.stream === "ЕГЭ" ? "ege" : "oge"} />
        <div style={{flex:1, minWidth:0}}>
          <div className="t-studentrow__name">{sub.name}</div>
          <div className="t-studentrow__meta">Сдано {sub.submittedAt}</div>
        </div>
        <div className="t-studentrow__right">
          <span className="t-num" style={{fontSize:13, fontWeight:600}}>{sub.score}/{sub.total}</span>
          <span className="t-hstack" style={{gap:3}}>
            {sub.answers.map((ok,i)=><span key={i} style={{width:8,height:8,borderRadius:"50%",background: ok==="ok"? "var(--sokrat-state-success-fg)": ok==="part"?"var(--sokrat-state-warning-fg)":"var(--sokrat-state-danger-fg)"}}/>)}
          </span>
          <span className={"t-aicheck__ai-chip " + (sub.aiFlag==="ok"?"t-aicheck__ai-chip--ok":sub.aiFlag==="warn"?"t-aicheck__ai-chip--warn":"")}>AI {sub.aiFlag === "ok" ? "✓" : sub.aiFlag === "warn" ? `⚠ ${sub.aiWarnCount||""}`.trim() : "?"}</span>
          <Icon name={expanded ? "chevron-down" : "chevron-right"} />
        </div>
      </div>
    </>
  );
}

// ─── AICheckBlock ───
function AICheckBlock({ verdict = "warn", confidence = 0.72, reason, onOverride }) {
  const chipCls = verdict === "ok" ? "t-aicheck__ai-chip--ok" : verdict === "warn" ? "t-aicheck__ai-chip--warn" : "";
  const label = verdict === "ok" ? "AI ✓ верно" : verdict === "warn" ? "AI ⚠ требует проверки" : "AI ? неясно";
  return (
    <div className="t-aicheck">
      <div className="t-aicheck__row">
        <span className={"t-aicheck__ai-chip " + chipCls}>{label}</span>
        <span className="t-aicheck__confidence">
          уверенность
          <span className="t-aicheck__bar"><span className="t-aicheck__bar-fill" style={{width: `${Math.round(confidence*100)}%`}}/></span>
          {Math.round(confidence*100)}%
        </span>
      </div>
      {reason && <div className="t-aicheck__reason">{reason}</div>}
      <div className="t-hstack" style={{justifyContent:"flex-end"}}>
        <Button variant="ghost" size="sm" onClick={onOverride}>Поставить свою оценку</Button>
      </div>
    </div>
  );
}

// ─── SubmissionReview (two-pane) ───
function SubmissionReview({ sub }) {
  return (
    <div className="t-review">
      <div className="t-review__pane">
        <div className="t-section__header" style={{padding:"0 0 10px"}}><h2>Работа ученика</h2></div>
        <hr className="t-divider" style={{margin:"0 -16px 12px"}} />
        <div style={{fontSize:13, color:"var(--sokrat-fg2)", lineHeight:1.55}}>
          Задача 02 · Тело движется с ускорением <InlineMath tex="a = 2\\,\\text{м}/\\text{с}^2" />, начальная скорость <InlineMath tex="v_0 = 4\\,\\text{м}/\\text{с}" />. Найти скорость через 4 с.
        </div>
        <FormulaBlock tex="v = v_0 + at = 4 + 2 \\cdot 4 = 12\\,\\text{м}/\\text{с}" />
        <div className="t-hstack" style={{gap:8, marginTop:8}}>
          <span className="t-muted" style={{fontSize:12}}>Ответ ученика:</span>
          <span className="t-num" style={{fontWeight:600}}>12 <span className="t-unit">м/с</span></span>
          <StatusDot tone="success">совпал с ключом</StatusDot>
        </div>
      </div>
      <div className="t-review__pane">
        <div className="t-section__header" style={{padding:"0 0 10px"}}><h2>Проверка</h2></div>
        <hr className="t-divider" style={{margin:"0 -16px 12px"}} />
        <AICheckBlock verdict="ok" confidence={0.94} reason="Ответ и единицы измерения совпадают с ключом. Ход решения линейный, формула использована корректно." />
        <div className="t-group__section-label" style={{padding:"12px 0 6px"}}>Итоговая оценка</div>
        <div className="t-hstack">
          <AnswerInput value="5" unit="из 5" />
          <Button variant="primary" size="sm">Сохранить</Button>
        </div>
      </div>
    </div>
  );
}

// ─── SessionBlock ───
function SessionBlock({ s }) {
  return (
    <div className={"t-session" + (s.stream === "ОГЭ" ? " t-session--oge" : "") + (s.past ? " t-session--past" : "")}>
      <span className="t-session__time">{s.time}</span>
      <span className="t-session__title">{s.name}</span>
      <span className="t-session__meta">{s.topic}</span>
    </div>
  );
}

// ─── WeekGrid ───
function WeekGrid({ sessions }) {
  const days = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];
  const hours = [9,10,11,12,13,14,15,16,17,18,19,20];
  const cells = {};
  sessions.forEach(s => { cells[`${s.day}-${s.hour}`] = s; });
  return (
    <div className="t-week">
      <div className="t-week__head"></div>
      {days.map(d => <div key={d} className="t-week__head">{d}</div>)}
      {hours.map(h => (
        <React.Fragment key={h}>
          <div className="t-week__hour">{h}:00</div>
          {days.map((d,i) => {
            const s = cells[`${i}-${h}`];
            return <div key={d+h} className="t-week__cell">{s && <SessionBlock s={s} />}</div>;
          })}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── PaymentRow ───
function PaymentRow({ p }) {
  return (
    <div className="t-payrow">
      <Avatar name={p.name} size={32} />
      <div>
        <div style={{fontWeight:600, fontSize:13}}>{p.name}</div>
        <div className="t-muted" style={{fontSize:12}}>{p.plan}</div>
      </div>
      <span className="t-num t-muted" style={{fontSize:12}}>{p.period}</span>
      <span className="is-num t-num">{p.amount.toLocaleString("ru-RU")} ₽</span>
      <StatusDot tone={p.statusTone}>{p.statusLabel}</StatusDot>
      <Button variant="outline" size="sm">{p.action}</Button>
    </div>
  );
}

// ─── GroupPanel (single card, sections separated by dividers; inset surfaces only) ───
function GroupPanel({ group, bare }) {
  return (
    <section className={"t-group" + (bare ? " t-group--bare" : "")}>
      <div className="t-group__header">
        <span className="t-group__title">{group.name}</span>
        <Chip variant={group.stream === "ЕГЭ" ? "ege" : "oge"}>{group.stream}</Chip>
        <span className="t-group__meta">{group.members.length} учеников · {group.sharedHomework.length} ДЗ</span>
        <Button variant="ghost" size="sm" icon="more-horizontal" iconOnly aria-label="Меню" />
      </div>
      <hr className="t-divider" />
      {group.note && <div className="t-group__inset">{group.note}</div>}
      <div className="t-group__section-label">Участники</div>
      {group.members.map(m => <StudentRow key={m.id} student={m} />)}
      <hr className="t-divider" />
      <div className="t-group__section-label">Общие домашние</div>
      {group.sharedHomework.map(h => <HomeworkListRow key={h.id} hw={h} />)}
      <hr className="t-divider" />
      <div className="t-card__footer" style={{padding:"10px 14px", justifyContent:"flex-start", gap:6}}>
        <Button variant="ghost" size="sm" icon="user-plus">Добавить ученика</Button>
        <Button variant="ghost" size="sm" icon="clipboard-plus">Назначить ДЗ группе</Button>
      </div>
    </section>
  );
}

Object.assign(window, {
  StudentRow, RosterTable, StudentCard,
  HomeworkListRow, HomeworkSetCard,
  TaskCard, TaskBankRow,
  SubmissionRow, SubmissionReview, AICheckBlock,
  SessionBlock, WeekGrid,
  PaymentRow, GroupPanel,
});
