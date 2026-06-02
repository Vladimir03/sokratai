/* SokratAI · №3 «Проверка работы» — galочка-паритет screen */

const I3 = {
  'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  'book-open': '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  'clipboard-check': '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  'badge-check': '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>',
  'check-circle': '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
  'clock': '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  'pencil': '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  'square-pen': '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>',
  'lightbulb': '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  'lock': '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  'rotate-ccw': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  'sparkles': '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z"/>',
  'graduation-cap': '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
};
function I({ name, size = 16, cls, style }) {
  return React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', className: cls, style, dangerouslySetInnerHTML: { __html: I3[name] || '' } });
}
const KICON = { hw: 'book-open', mock: 'clipboard-check' };

function plural3(n, one, few, many) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return few;
  return many;
}

/* ── Task edit modal (parity w/ EditScoreDialog) ── */
function TaskEditModal({ work, task, onClose, onSave }) {
  const H = window.HW3;
  const max = task.max;
  const cur = H.taskScore(task);
  const [val, setVal] = React.useState(cur != null ? String(cur).replace('.', ',') : '');
  const [comment, setComment] = React.useState(task.overrideComment || '');
  const [closeAfter, setCloseAfter] = React.useState(!task.verified);
  const num = Number(val.replace(',', '.'));
  const invalid = val.trim() === '' || Number.isNaN(num) || num < 0 || num > max;
  const noAi = task.ai === null;

  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-h">
          <h3>{work.kimLabels ? 'KIM' : 'Задача'} {task.n} — балл</h3>
          <p>Балл репетитора — итоговый, который видит ученик. AI-оценка не перезаписывается.</p>
        </div>
        <div className="modal-b">
          <div className="score-context">
            Текущее: <span className="cur">{cur != null ? H.fmt(cur) + ' / ' + max : '—'}</span>
            {noAi
              ? <span className="ai"> · AI-вердикта нет — оцените вручную</span>
              : <span className="ai"> · AI: <b>{H.fmt(task.ai)}</b> / {max}{task.hints > 0 ? ` · снижено за ${task.hints} ${plural3(task.hints, 'подсказку', 'подсказки', 'подсказок')}` : ''}</span>}
          </div>
          <div className="field">
            <label htmlFor="sc3">Балл репетитора (0–{max})</label>
            <input id="sc3" type="number" inputMode="decimal" step="0.5" min="0" max={max} value={val} onChange={(e) => setVal(e.target.value)} />
            <div className="help">{invalid ? `Введите число 0…${max}` : `0…${max}, шаг 0.5`}</div>
          </div>
          <div className="field">
            <label htmlFor="cm3">Комментарий ученику (опционально)</label>
            <textarea id="cm3" rows="2" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Напр.: засчитал полный балл — ход решения правильный"></textarea>
          </div>
          <label className="field check" htmlFor="cl3">
            <input id="cl3" type="checkbox" checked={closeAfter} onChange={(e) => setCloseAfter(e.target.checked)} />
            <span>Подтвердить задачу<span className="s">Ученик увидит балл и «проверено репетитором».</span></span>
          </label>
        </div>
        <div className="modal-f">
          <button className="btn btn--ghost left" onClick={onClose}>Отмена</button>
          <button className="btn btn--primary" disabled={invalid} onClick={() => onSave(num, comment, closeAfter)}>
            <I name="badge-check" size={16} cls="ico" /> {closeAfter ? 'Сохранить и подтвердить' : 'Сохранить балл'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Bulk confirm dialog ── */
function BulkDialog({ n, onClose, onConfirm }) {
  return (
    <div className="dlg-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dlg" role="dialog" aria-modal="true">
        <div className="dlg-h"><h3>Подтвердить {n} {plural3(n, 'задачу', 'задачи', 'задач')}, проверенных AI?</h3></div>
        <div className="dlg-b">Ученику откроются баллы и пометка «проверено репетитором» на этих задачах. AI-баллы остаются как есть — если с каким-то не согласны, поправьте его отдельно через «Изменить балл». Решение и AI-рубрика ученику не показываются.</div>
        <div className="dlg-f">
          <button className="btn btn--ghost" onClick={onClose}>Отмена</button>
          <button className="btn btn--primary" onClick={onConfirm}><I name="badge-check" size={16} cls="ico" /> Подтвердить ({n})</button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const H = window.HW3;
  const flowWork = window.SokratFlow && window.SokratFlow.active && window.SokratFlow.param('work');
  const [workId, setWorkId] = React.useState(H.WORKS[flowWork] ? flowWork : 'law');
  const base = H.WORKS[workId];
  const [tasks, setTasks] = React.useState(() => base.tasks.map(t => ({ ...t })));
  React.useEffect(() => { setTasks(base.tasks.map(t => ({ ...t }))); setSel('all'); }, [workId]);

  const [sel, setSel] = React.useState('all');      // 'all' | task index
  const [editing, setEditing] = React.useState(null); // task index
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [toast, setToast] = React.useState(null);
  const tr = React.useRef(0);
  const flash = (t) => { setToast(t); clearTimeout(tr.current); tr.current = setTimeout(() => setToast(null), 2200); };

  const work = base;
  const pending = H.pendingCount(tasks);
  const manual = H.manualCount(tasks);
  const verified = H.verifiedCount(tasks);
  const roll = H.rollup(work, tasks);

  const confirmTask = (i) => { setTasks(ts => ts.map((t, j) => j === i ? { ...t, verified: true } : t)); flash('Задача подтверждена'); };
  const reopenTask = (i) => { setTasks(ts => ts.map((t, j) => j === i ? { ...t, verified: false } : t)); flash('Задача открыта обратно'); };
  const bulkConfirm = () => { setTasks(ts => ts.map(t => (t.ai !== null && !t.verified) ? { ...t, verified: true } : t)); setBulkOpen(false); flash('Подтверждено всё, что проверил AI'); };
  const saveTask = (i, val, comment, close) => {
    setTasks(ts => ts.map((t, j) => j === i ? { ...t, override: val, overrideComment: comment, verified: close ? true : t.verified } : t));
    setEditing(null); flash(close ? 'Балл сохранён, задача подтверждена' : 'Балл сохранён');
  };

  const overallState = pending > 0 ? 'review' : manual > 0 ? 'manual' : 'verified';

  return (
    <React.Fragment>
      <div className="topnav">
        <div className="brand"><img src="assets/sokrat-logo.png" alt="" /> Сократ AI <span className="tag">ТЬЮТОР</span></div>
        <nav className="navlinks"><a href="#">Главная</a><a href="#" className="active">Домашки</a><a href="#">Ученики</a><a href="#">Пробники</a></nav>
        <span className="spacer"></span>
        {/* demo switcher */}
        <div className="cv-jump" style={{ marginRight: 8 }}>
          {[['law', 'ДЗ с AI'], ['mock', 'Пробник'], ['noai', 'Без AI']].map(([k, l]) => (
            <button key={k} className={workId === k ? 'active' : ''} onClick={() => setWorkId(k)}><span className="k">{l}</span></button>
          ))}
        </div>
        <div className="ava">ЕВ</div>
      </div>

      <div className="page3">
        <div className="crumb"><a href="#">Домашки</a><span className="sep">/</span><a href="#">{work.title}</a><span className="sep">/</span><span className="cur">{work.student}</span></div>

        <div className="app3" onMouseDown={() => {}}>
          {/* work header */}
          <div className="wh">
            <button className="back" aria-label="Назад"><I name="arrow-left" size={18} /></button>
            <div className={'wico' + (work.noAi ? '' : '')}><I name={KICON[work.kind]} size={22} /></div>
            <div className="wt">
              <h2>{work.title}
                <span className="exam-chip"><I name="graduation-cap" size={12} /> ЕГЭ</span>
                {overallState === 'verified'
                  ? <span className="tstatus verified"><I name="badge-check" /> Проверено</span>
                  : overallState === 'manual'
                    ? <span className="tstatus manual"><I name="square-pen" /> Ручная проверка · {manual}</span>
                    : <span className="tstatus review"><I name="clock" /> На проверке · {pending}</span>}
              </h2>
              <div className="wm">
                <span className="wstu"><span className="av">{work.studentInitials}</span> {work.student}</span>
                <span className="dot-sep">·</span><span>{work.group}</span>
                <span className="dot-sep">·</span><span>{work.date}</span>
                <span className="dot-sep">·</span><span className={'due' + (work.overdue ? ' overdue' : '')}>{work.due}</span>
              </div>
            </div>
            <div className="wright">
              <div className="wscore">{roll.main}{roll.suf ? <span className="mx"> {roll.suf}</span> : ''}{roll.sub ? <span className="sub">{roll.sub}</span> : ''}</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>проверено {verified}/{tasks.length}</div>
            </div>
          </div>

          {/* bulk banner */}
          {pending > 0 ? (
            <div className="bulk3">
              <div className="bi"><I name="badge-check" size={19} /></div>
              <div className="bt">
                <b>AI проверил {pending} {plural3(pending, 'задачу', 'задачи', 'задач')} — подтвердите в один клик</b>
                <span className="s">Открывает баллы ученику. С каким-то не согласны — поправьте через «Изменить балл».</span>
              </div>
              <button className="btn btn--primary" onClick={() => setBulkOpen(true)}><I name="badge-check" size={16} cls="ico" /> Подтвердить всё, что AI проверил ({pending})</button>
            </div>
          ) : manual > 0 ? (
            <div className="bulk3 manual">
              <div className="bi"><I name="square-pen" size={19} /></div>
              <div className="bt">
                <b>AI не смог проверить — нужна ручная оценка ({manual})</b>
                <span className="s">Фото-решение не распознано. Поставьте балл по каждой задаче через «Изменить балл».</span>
              </div>
            </div>
          ) : (
            <div className="bulk3 done">
              <div className="bi"><I name="check-circle" size={19} /></div>
              <div className="bt"><b>Работа полностью проверена</b><span className="s">Все задачи подтверждены — ученик видит итоговые баллы.</span></div>
              {window.SokratFlow && window.SokratFlow.active &&
                <button className="btn btn--primary" onClick={() => window.SokratFlow.navStep('report', { track: window.SokratFlow.param('track') || 'ege' })}><I name="arrow-right" size={16} cls="ico" /> Перейти к отчёту родителю</button>}
            </div>
          )}

          {/* anti-leak */}
          <div className="leak">
            <I name="shield-check" size={15} />
            <span><b>Ученик видит только итоговый балл и «проверено».</b> AI-рубрика, подсказки и полное решение остаются у вас — подтверждение их не раскрывает.</span>
          </div>

          {/* mini-card row */}
          <div className="mini-row">
            <div className="mini">
              <button className={'sq all' + (sel === 'all' ? ' sel' : '')} onClick={() => setSel('all')} aria-pressed={sel === 'all'}>
                <span className="lab">Все</span><span className="sc">{tasks.length}</span>
              </button>
            </div>
            {tasks.map((t, i) => {
              const sc = H.taskScore(t);
              const cls = H.cellClass(sc, t.max);
              const st = H.taskStatus(t);
              const pendingCell = st === 'review';
              return (
                <div className="mini" key={i}>
                  <button className={'sq ' + cls + (sel === i ? ' sel' : '') + (pendingCell ? ' pending' : '')} onClick={() => setSel(i)} aria-pressed={sel === i}>
                    <span className="lab">{work.kimLabels ? 'KIM ' + t.n : '№' + t.n}</span>
                    <span className="sc">{H.fmt(sc)}{sc != null ? '/' + t.max : ''}</span>
                    {t.verified && <I name="badge-check" cls="vchk" />}
                    {t.hints > 0 && <span className="hint"><I name="lightbulb" /> {t.hints}</span>}
                    {t.override != null && <span className="ovr" title="Балл правлен"></span>}
                  </button>
                  {st !== 'verified' && (
                    <button className="pencil" aria-label="Изменить балл" onClick={(e) => { e.stopPropagation(); setEditing(i); }}><I name="pencil" /></button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mini-legend">
            <span className="it"><span className="sw" style={{ background: 'var(--heat-e-bg)' }}></span> ≥80%</span>
            <span className="it"><span className="sw" style={{ background: 'var(--heat-a-bg)' }}></span> 30–80%</span>
            <span className="it"><span className="sw" style={{ background: 'var(--heat-r-bg)' }}></span> &lt;30%</span>
            <span className="it"><span className="sw pending"></span> ждёт подтверждения</span>
            <span className="it"><I name="lightbulb" size={12} style={{ color: 'var(--ochre-700)' }} /> подсказки</span>
            <span className="it"><I name="badge-check" size={13} style={{ color: 'var(--s-success-fg)' }} /> подтверждено</span>
          </div>

          {/* detail */}
          <div className="detail3">
            {sel === 'all' ? (
              <div className="all-list">
                {tasks.map((t, i) => {
                  const sc = H.taskScore(t);
                  const cls = H.cellClass(sc, t.max);
                  const st = H.taskStatus(t);
                  return (
                    <div className={'tl-row' + (t.verified ? ' verified' : '')} key={i}>
                      <span className={'tnum ' + cls}>{H.fmt(sc)}</span>
                      <div className="tinfo">
                        <div className="tt">{work.kimLabels ? 'KIM ' + t.n : 'Задача ' + t.n} <span className="dmax" style={{ fontWeight: 500, color: 'var(--fg-muted)', fontSize: 12 }}>/ {t.max} б</span></div>
                        <div className="ts">
                          {st === 'manual'
                            ? <span style={{ color: 'var(--oge)' }}>нет AI-вердикта</span>
                            : <span>AI: {H.fmt(t.ai)} / {t.max}</span>}
                          {t.hints > 0 && <span className="hint"><I name="lightbulb" /> {t.hints} {plural3(t.hints, 'подсказка', 'подсказки', 'подсказок')}</span>}
                          {t.override != null && <span style={{ color: 'var(--fg-muted)' }}>· правлен репетитором</span>}
                        </div>
                      </div>
                      <div className="tact">
                        {st === 'verified' ? (
                          <span className="reopen" onClick={() => reopenTask(i)}><I name="rotate-ccw" /> Открыть обратно</span>
                        ) : st === 'manual' ? (
                          <button className="btn btn--sm btn--confirm" onClick={() => setEditing(i)}><I name="badge-check" size={15} cls="ico" /> Поставить балл</button>
                        ) : (
                          <React.Fragment>
                            <button className="btn btn--sm" onClick={() => setEditing(i)}>Изменить балл</button>
                            <button className="btn btn--sm btn--confirm" onClick={() => confirmTask(i)}><I name="badge-check" size={15} cls="ico" /> Подтвердить</button>
                          </React.Fragment>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              (() => {
                const t = tasks[sel]; const sc = H.taskScore(t); const cls = H.cellClass(sc, t.max); const st = H.taskStatus(t);
                return (
                  <React.Fragment>
                    <div className="dt-head">
                      <div>
                        <span className="dn">{work.kimLabels ? 'KIM ' + t.n : 'Задача ' + t.n}</span> <span className="dmax">/ {t.max} б</span>
                        <div style={{ marginTop: 5 }}>
                          {st === 'verified' ? <span className="tstatus verified"><I name="badge-check" /> Проверено</span>
                            : st === 'manual' ? <span className="tstatus manual"><I name="square-pen" /> Нужна ручная оценка</span>
                            : <span className="tstatus review"><I name="clock" /> На проверке</span>}
                        </div>
                      </div>
                      <span className="spacer"></span>
                      <span className={'dt-score ' + cls}>{H.fmt(sc)}{sc != null ? ' / ' + t.max : ''}</span>
                    </div>

                    <div className={'ai-card' + (st === 'manual' ? ' manual' : '')}>
                      <div className="ah">
                        <span className="badge"><I name="sparkles" size={12} /> AI-вердикт</span>
                        {st !== 'manual' && <span className="ascore">{H.fmt(t.ai)}<span className="mx"> / {t.max}</span></span>}
                        {t.hints > 0 && <span className="hints"><I name="lightbulb" /> {t.hints} {plural3(t.hints, 'подсказка', 'подсказки', 'подсказок')}</span>}
                      </div>
                      <div className="ab">
                        <span className="tutor-only"><I name="lock" /> Видно только репетитору</span>
                        {st === 'manual' ? 'AI не смог распознать рукописное решение. Оцените задачу вручную.' : t.aiComment}
                      </div>
                    </div>

                    <div className="dt-actions">
                      {st === 'verified' ? (
                        <React.Fragment>
                          <span className="verified-note"><I name="badge-check" /> Подтверждено{t.override != null ? ' · балл правлен' : ''}</span>
                          <span className="spacer"></span>
                          <span className="reopen" onClick={() => reopenTask(sel)}><I name="rotate-ccw" /> Открыть обратно</span>
                        </React.Fragment>
                      ) : st === 'manual' ? (
                        <button className="btn btn--confirm" onClick={() => setEditing(sel)}><I name="badge-check" size={16} cls="ico" /> Поставить балл и подтвердить</button>
                      ) : (
                        <React.Fragment>
                          <button className="btn" onClick={() => setEditing(sel)}><I name="pencil" size={15} cls="ico" /> Изменить балл</button>
                          <button className="btn btn--confirm" onClick={() => confirmTask(sel)}><I name="badge-check" size={16} cls="ico" /> Подтвердить</button>
                        </React.Fragment>
                      )}
                    </div>
                  </React.Fragment>
                );
              })()
            )}
          </div>

          {bulkOpen && <BulkDialog n={pending} onClose={() => setBulkOpen(false)} onConfirm={bulkConfirm} />}
          {editing != null && <TaskEditModal work={work} task={tasks[editing]} onClose={() => setEditing(null)} onSave={(v, c, close) => saveTask(editing, v, c, close)} />}
          {toast && <div className="toast"><I name="check-circle" size={16} /> {toast}</div>}
        </div>
      </div>
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
if (window.SokratFlow) window.SokratFlow.mark('review');
