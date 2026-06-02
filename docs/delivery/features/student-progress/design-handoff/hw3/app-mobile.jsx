/* SokratAI · №3 «Проверка работы» — MOBILE app (iOS frame harness) */

const HM_ICONS = {
  'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  'badge-check': '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>',
  'check-circle': '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
  'check': '<path d="M20 6 9 17l-5-5"/>',
  'clock': '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  'square-pen': '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>',
  'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  'rotate-ccw': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  'sparkles': '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z"/>',
  'lightbulb': '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'inbox': '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  'triangle-alert': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
};
function H({ name, size = 16, cls, style }) {
  return React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', className: cls, style, dangerouslySetInnerHTML: { __html: HM_ICONS[name] || '' } });
}

function cloneWork(w) { return { ...w, tasks: w.tasks.map(t => ({ ...t })) }; }

function TaskCard({ w, t, onOpen }) {
  const D = window.HW3;
  const sc = D.taskScore(t);
  const cls = D.cellClass(sc, t.max);
  const st = D.taskStatus(t);
  return (
    <div className={'tc ' + st} onClick={() => onOpen(t)}>
      <div className="tc-h">
        <span className="tc-n">{w.kimLabels ? 'KIM ' + t.n : 'Задача ' + t.n}</span>
        {st === 'verified' ? <H name="badge-check" size={18} cls="tc-st verified" />
          : st === 'manual' ? <H name="square-pen" size={17} cls="tc-st manual" />
          : <H name="clock" size={17} cls="tc-st review" />}
      </div>
      <div className={'tc-score ' + cls}>{D.fmt(sc)}<span className="mx"> / {t.max}</span></div>
      {st === 'verified' ? <div className="tc-meta verified"><H name="badge-check" size={12} /> подтверждено</div>
        : st === 'manual' ? <div className="tc-meta manual"><H name="square-pen" size={12} /> нет AI-вердикта</div>
        : <div className="tc-meta review"><H name="clock" size={12} /> AI: {D.fmt(t.ai)} — на проверке</div>}
      <div className="tc-tap"><H name="chevron-right" size={12} /> {st === 'manual' ? 'поставить балл' : 'разбор / изменить'}</div>
    </div>
  );
}

/* task detail + edit bottom-sheet */
function TaskSheet({ w, t, onClose, onConfirm, onSave }) {
  const D = window.HW3;
  const isManual = t.ai === null;
  const cur = D.taskScore(t);
  const cls = D.cellClass(cur, t.max);
  const [val, setVal] = React.useState(cur != null ? cur : 0);
  const [comment, setComment] = React.useState(t.overrideComment || '');
  const [editing, setEditing] = React.useState(isManual); // manual opens straight into entry
  const st = D.taskStatus(t);
  const step = (d) => setVal(v => Math.max(0, Math.min(t.max, +(Number(v) + d).toFixed(1))));

  return (
    <div className="hm-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="hm-sheet">
        <div className="grab"></div>
        <div className="sh-h">
          <span className="nch">{w.kimLabels ? 'KIM ' + t.n : 'Задача ' + t.n}</span>
          <h3>{isManual ? 'Поставить балл' : 'Разбор задачи'}</h3>
          {!editing && <span className={'sc ' + cls}>{D.fmt(cur)}<span style={{ fontSize: 12, color: 'var(--fg-muted)', fontWeight: 600 }}> /{t.max}</span></span>}
        </div>

        {/* AI rubric — tutor-only (anti-leak) */}
        {!isManual && t.aiComment && (
          <div className="hm-rubric">
            <div className="rh"><H name="sparkles" size={14} /> Разбор AI <span className="only">только репетитор</span></div>
            <div className="rb">{t.aiComment}</div>
            <div className="rmeta"><span>AI-балл: <b>{D.fmt(t.ai)} / {t.max}</b></span>{t.hints > 0 && <span><H name="lightbulb" size={12} style={{ display: 'inline', verticalAlign: '-2px' }} /> подсказок: <b>{t.hints}</b></span>}</div>
          </div>
        )}

        {editing ? (
          <div className="hm-edit">
            <label>{isManual ? 'Балл (нет AI-вердикта)' : 'Балл репетитора (итог)'}</label>
            <div className="inrow">
              <div className="stepper">
                <button onClick={() => step(-0.5)} aria-label="минус">−</button>
                <input type="number" inputMode="decimal" step="0.5" min="0" max={t.max} value={val} onChange={(e) => setVal(e.target.value)} />
                <button onClick={() => step(0.5)} aria-label="плюс">+</button>
              </div>
              <span className="ofmax">из {t.max}</span>
            </div>
            <div className="help">Итоговый балл видит ученик. AI-оценка не перезаписывается.</div>
            <textarea placeholder="Комментарий ученику (опционально)" value={comment} onChange={(e) => setComment(e.target.value)}></textarea>
            <div className="sh-actions">
              <button className="btn" onClick={() => { if (isManual) onClose(); else setEditing(false); }}>Отмена</button>
              <button className="btn btn--primary" onClick={() => onSave(t.n, Math.max(0, Math.min(t.max, Number(val))), comment)}>
                <H name="badge-check" size={17} cls="ico" /> Сохранить и подтвердить
              </button>
            </div>
          </div>
        ) : st === 'verified' ? (
          <div className="confrow">
            <button className="btn" onClick={() => setEditing(true)}><H name="square-pen" size={16} cls="ico" /> Изменить балл</button>
            <button className="btn" onClick={() => onConfirm(t.n, false)}><H name="rotate-ccw" size={16} cls="ico" /> Открыть обратно</button>
          </div>
        ) : (
          <div className="confrow">
            <button className="btn" onClick={() => setEditing(true)}><H name="square-pen" size={16} cls="ico" /> Изменить балл</button>
            <button className="btn btn--primary" onClick={() => onConfirm(t.n, true)}><H name="badge-check" size={17} cls="ico" /> Подтвердить</button>
          </div>
        )}
      </div>
    </div>
  );
}

function HwReview({ workKey, state, setState }) {
  const D = window.HW3;
  const base = D.WORKS[workKey];
  const [work, setWork] = React.useState(() => cloneWork(base));
  React.useEffect(() => { setWork(cloneWork(base)); }, [workKey]);
  const [openTask, setOpenTask] = React.useState(null);
  const [toast, setToast] = React.useState(null);
  const tr = React.useRef(0);
  const flash = (m) => { setToast(m); clearTimeout(tr.current); tr.current = setTimeout(() => setToast(null), 2000); };

  const tasks = work.tasks;
  const pending = D.pendingCount(tasks);
  const manual = D.manualCount(tasks);
  const verified = D.verifiedCount(tasks);
  const roll = D.rollup(work, tasks);

  const setTask = (n, patch) => setWork(w => ({ ...w, tasks: w.tasks.map(t => t.n === n ? { ...t, ...patch } : t) }));

  const confirmTask = (n, on) => { setTask(n, { verified: on }); setOpenTask(null); flash(on ? 'Задача подтверждена' : 'Задача открыта обратно'); };
  const saveTask = (n, val, comment) => { setTask(n, { override: val, overrideComment: comment, verified: true }); setOpenTask(null); flash('Балл сохранён, подтверждено'); };
  const bulkConfirm = () => { setWork(w => ({ ...w, tasks: w.tasks.map(t => t.ai !== null ? { ...t, verified: true } : t) })); flash('Подтверждено всё, что проверил AI'); };
  const reopenAll = () => { setWork(w => ({ ...w, tasks: w.tasks.map(t => ({ ...t, verified: false })) })); flash('Работа открыта обратно'); };

  // states
  if (state === 'loading') {
    return (
      <div className="hw--m">
        <div className="hm-skel">
          <div className="hm-sk" style={{ height: 16, width: '60%' }}></div>
          <div className="hm-sk" style={{ height: 44, marginTop: 12, borderRadius: 10 }}></div>
          <div className="hm-skgrid">
            {[0, 1, 2, 3, 4, 5].map(i => <div className="hm-skcard" key={i}><div className="hm-sk a"></div><div className="hm-sk b"></div><div className="hm-sk c"></div></div>)}
          </div>
        </div>
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div className="hw--m">
        <div className="hm-stateview">
          <div className="ill danger"><H name="triangle-alert" size={28} /></div>
          <h3>Не удалось открыть работу</h3>
          <p>Проверьте соединение и попробуйте ещё раз. Проверенные баллы сохранены.</p>
          <button className="cta" onClick={() => setState('ready')}><H name="rotate-ccw" size={17} /> Повторить</button>
        </div>
      </div>
    );
  }
  if (state === 'empty') {
    return (
      <div className="hw--m">
        <div className="hm-stateview">
          <div className="ill"><H name="inbox" size={26} /></div>
          <h3>Работа ещё не сдана</h3>
          <p>Когда ученик сдаст работу, AI проверит задачи и они появятся здесь для подтверждения.</p>
        </div>
      </div>
    );
  }

  const allDone = pending === 0 && manual === 0;
  const progPct = Math.round(100 * verified / tasks.length);

  return (
    <div className="hw--m">
      <div className="hm-top">
        <div className="nav">
          <button className="back" aria-label="Назад"><H name="arrow-left" size={18} /></button>
          <div className="wt">
            <div className="t">{work.title}</div>
            <div className="s">{work.date} · {work.due}</div>
          </div>
        </div>
        <div className="stu">
          <span className="av">{work.studentInitials}</span>
          <span className="si"><span className="nm">{work.student}</span><span className="gr">{work.group}</span></span>
          <span className="roll"><span className="v">{roll.main}{roll.suf ? <span className="mx"> {roll.suf}</span> : ''}</span>{roll.sub ? <span className="sub">{roll.sub}</span> : null}</span>
        </div>
        <div className="hm-prog">
          <div className="bar"><span style={{ width: progPct + '%' }}></span></div>
          <span className="lbl">{verified} / {tasks.length} подтв.</span>
        </div>
      </div>

      <div className="hm-leak">
        <H name="shield-check" size={15} />
        <span><b>Ученик видит только балл и «проверено».</b> Разбор AI, подсказки и рубрика остаются у репетитора.</span>
      </div>

      <div className="hm-scroll">
        <div className="hm-grid">
          {tasks.map(t => <TaskCard key={t.n} w={work} t={t} onOpen={setOpenTask} />)}
        </div>
      </div>

      {/* sticky bulk bar */}
      <div className="hm-bulk">
        <div className="summ">
          {allDone
            ? <span className="done"><H name="check-circle" size={15} /> Всё подтверждено</span>
            : pending > 0
              ? <span className="pend"><H name="clock" size={14} /> {pending} на проверке{manual > 0 ? ` · ${manual} вручную` : ''}</span>
              : <span className="pend"><H name="square-pen" size={14} /> {manual} вручную</span>}
          {verified > 0 && <span className="reopen" onClick={reopenAll}><H name="rotate-ccw" size={13} /> Открыть обратно</span>}
        </div>
        {pending > 0
          ? <button className="bbtn" onClick={bulkConfirm}><H name="badge-check" size={19} /> Подтвердить всё, что AI проверил ({pending})</button>
          : manual > 0
            ? <button className="bbtn manual" onClick={() => setOpenTask(tasks.find(t => t.ai === null && !t.verified))}><H name="square-pen" size={18} /> Поставить баллы вручную ({manual})</button>
            : <button className="bbtn done" disabled><H name="check-circle" size={18} /> Работа подтверждена</button>}
      </div>

      {openTask && <TaskSheet w={work} t={openTask} onClose={() => setOpenTask(null)} onConfirm={confirmTask} onSave={saveTask} />}
      {toast && <div className="hm-toast"><H name="check-circle" size={15} /> {toast}</div>}
    </div>
  );
}

function AppMobile() {
  const [workKey, setWorkKey] = React.useState('law');
  const [state, setState] = React.useState('ready');
  return (
    <React.Fragment>
      <div className="cv-top">
        <div className="lede">
          <h1>Проверка работы · мобайл + состояния</h1>
          <div className="path">мини-карточки переносом · sticky bulk · EditScore bottom-sheet · anti-leak</div>
        </div>
        <div className="v2-switch">
          <span className="sl">Работа:</span>
          <div className="cv-jump">
            {[['law', 'С AI (8)'], ['mock', 'Пробник'], ['noai', 'Без AI']].map(([k, l]) => (
              <button key={k} className={workKey === k ? 'active' : ''} onClick={() => { setWorkKey(k); setState('ready'); }}><span className="k">{l}</span></button>
            ))}
          </div>
          <span className="sl" style={{ marginLeft: 8 }}>Состояние:</span>
          <div className="cv-jump">
            {[['ready', 'Норма'], ['empty', 'Не сдана'], ['loading', 'Загрузка'], ['error', 'Ошибка']].map(([k, l]) => (
              <button key={k} className={state === k ? 'active' : ''} onClick={() => setState(k)}><span className="k">{l}</span></button>
            ))}
          </div>
        </div>
      </div>

      <div className="hm-stage">
        <IOSDevice width={390} height={844}>
          <HwReview key={workKey} workKey={workKey} state={state} setState={setState} />
        </IOSDevice>
      </div>
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<AppMobile />);
