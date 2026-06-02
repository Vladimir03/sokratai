/* ============================================================
   SokratAI hero v2 — components (→ window)
   ============================================================ */

const ICONS2 = {
  'badge-check': '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>',
  'check-circle': '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
  'check': '<path d="M20 6 9 17l-5-5"/>',
  'clock': '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  'book-open': '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  'clipboard-check': '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'triangle-alert': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  'external-link': '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  'trending-up': '<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>',
  'trending-down': '<path d="M16 17h6v-6"/><path d="m22 17-8.5-8.5-5 5L2 7"/>',
  'rotate-ccw': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  'square-pen': '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>',
  'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  'list-checks': '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  'percent': '<line x1="19" x2="5" y1="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  'graduation-cap': '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
  'school': '<path d="M14 22v-4a2 2 0 1 0-4 0v4"/><path d="m18 10 3.447 1.724a1 1 0 0 1 .553.894V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-7.382a1 1 0 0 1 .553-.894L6 10"/><path d="M18 5v17"/><path d="m4 6 7.106-3.553a2 2 0 0 1 1.788 0L20 6"/><path d="M6 5v17"/><circle cx="12" cy="9" r="2"/>',
  'target': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  'inbox': '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  'plus': '<path d="M5 12h14"/><path d="M12 5v14"/>'
};

function Icon({ name, size = 18, stroke = 2, className, style }) {
  return React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round',
    className, style, dangerouslySetInnerHTML: { __html: ICONS2[name] || '' }
  });
}
const KIND_ICON2 = { hw: 'book-open', mock: 'clipboard-check', manual: 'square-pen' };
const KIND_LABEL = { hw: 'ДЗ', mock: 'Пробник', manual: 'Вручную' };

function plural2(n, one, few, many) {
  const a = n % 10,b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return few;
  return many;
}

/* exam chip — neutral + icon */
function ExamChip({ exam }) {
  const e = window.HERO2.EXAM[exam];if (!e) return null;
  return <span className="exam-chip"><Icon name={e.icon} size={12} /> {e.label}</span>;
}

/* native-unit score rollup */
function ScoreRollup({ work, big }) {
  const H = window.HERO2;
  const r = H.rollup(work);
  const cls = r.ratio == null ? 'empty' : r.ratio < 0.5 ? 'low' : r.ratio < 0.75 ? 'mid' : '';
  if (r.main === '—') return <span className={(big ? 'work-score ' : '') + 'empty'}>—</span>;
  return (
    <span className={big ? 'work-score ' + cls : cls} style={big ? {} : { fontWeight: 700 }}>
      <span>{r.main}{r.suf ? <span className="mx"> {r.suf}</span> : null}{r.markTag ? <span className="mark-tag">оценка</span> : null}</span>
      {r.sub ? <span className="sub">{r.sub}</span> : null}
    </span>);

}

/* app chrome — profile aware */
function Chrome({ profile, onReport }) {
  return (
    <React.Fragment>
      <div className="topnav">
        <div className="brand"><img src="assets/sokrat-logo.png" alt="" /> Сократ AI <span className="tag">ТЬЮТОР</span></div>
        <nav className="navlinks"><a href="#">Главная</a><a href="#" className="active">Ученики</a><a href="#">Домашки</a><a href="#">Пробники</a></nav>
        <span className="spacer"></span>
        <div className="ava">ЕВ</div>
      </div>
      <div className="crumb">
        <a href="#">Ученики</a><span className="sep">/</span>
        <a href="#">{profile.name}</a><span className="sep">/</span><span className="cur">Прогресс</span>
      </div>
      <div className="student-head">
        <div className="avatar">{profile.initials}</div>
        <div className="who">
          <h2>{profile.name}</h2>
          <div className="line2">
            <span className="stream-tag ege">{profile.stream}</span>
            <span>{profile.grade}</span><span className="dot-sep">·</span><span>{profile.group}</span>
          </div>
        </div>
        <div className="actions">
          <button className="btn" onClick={onReport}><Icon name="file-text" size={15} className="ico" /> Отчёт родителю</button>
        </div>
      </div>
    </React.Fragment>);

}

/* GOAL CARD — current → target in native unit + scaled sparkline + editable target */
function GoalCard({ goal, onTarget }) {
  const [editing, setEditing] = React.useState(false);
  const [val, setVal] = React.useState(String(goal.target));
  React.useEffect(() => setVal(String(goal.target)), [goal.target]);

  const pct = (v) => Math.max(0, Math.min(100, (v - goal.floor) / (goal.ceil - goal.floor) * 100));
  const fillW = pct(goal.current);
  const pinL = pct(goal.target);
  const dyn = goal.spark[goal.spark.length - 1] - goal.spark[0];
  const cur = (goal.approx ? '≈' : '') + goal.current;

  // sparkline scaled to spark range (padded)
  const lo = Math.min(...goal.spark, goal.floor),hi = Math.max(...goal.spark, goal.target);
  const W = 260,Hh = 54,pad = 6;
  const sx = (i) => pad + i * (W - pad * 2) / (goal.spark.length - 1);
  const sy = (v) => pad + (1 - (v - lo) / (hi - lo || 1)) * (Hh - pad * 2);
  const path = goal.spark.map((v, i) => (i ? 'L' : 'M') + sx(i).toFixed(1) + ' ' + sy(v).toFixed(1)).join(' ');

  const commit = () => {
    const n = parseInt(val, 10);
    if (Number.isFinite(n) && n >= goal.floor && n <= goal.ceil) onTarget(n);
    setEditing(false);
  };

  return (
    <div className="goalcard">
      <div>
        <div className="gl-label"><Icon name="target" size={14} /> {goal.label}</div>
        <div className="gl-main">
          <span className="gl-cur">{cur}</span>
          <span className="gl-arrow"><Icon name="arrow-right" size={18} /></span>
          <span className="gl-target">цель {editing ?
            <input className="gl-target-edit" autoFocus value={val} onChange={(e) => setVal(e.target.value)}
            onBlur={commit} onKeyDown={(e) => {if (e.key === 'Enter') commit();if (e.key === 'Escape') setEditing(false);}} /> :
            <span className="t">{goal.target}</span>}
          </span>
          {!editing && <span className="gl-edit" onClick={() => setEditing(true)}><Icon name="square-pen" size={13} /> изменить цель</span>}
        </div>
        <div className="gl-bar">
          <div className="fill" style={{ width: fillW + '%' }}></div>
          {goal.thresholds && goal.thresholds.map((th) =>
          <div key={th.v} className="gl-thresh" style={{ left: pct(th.v) + '%' }} title={th.label + ': ' + th.v + ' тест-балл'}></div>
          )}
          <div className="goalpin" style={{ left: pinL + '%' }}></div>
        </div>
        <div className="gl-scale"><span>{goal.floor}</span>{goal.thresholds &&
          <span className="gl-thresh-cap">пороги: {goal.thresholds.map((t) => t.v + ' ' + t.label).join(' · ')}</span>}<span>{goal.ceil}</span></div>
        <div className="gl-note">
          <span className="dl">{goal.noun === 'оценка' ? 'Осталось до цели: ' : 'До цели: '}
            {goal.target - goal.current > 0 ? '+' + (goal.target - goal.current) + ' ' + (goal.noun === 'оценка' ? 'балл' : 'тест-балл') : 'достигнута'}</span>
          <span className="approx">· {goal.note}</span>
        </div>
      </div>
      <div className="gl-spark">
        <div className="sh"><span>Динамика</span>
          <span className={'dyn ' + (dyn > 0 ? 'up' : dyn < 0 ? 'down' : '')}>{dyn > 0 ? '▲ +' + dyn : dyn < 0 ? '▼ ' + dyn : '= 0'}</span>
        </div>
        <svg viewBox={`0 0 ${W} ${Hh}`} preserveAspectRatio="none">
          <line x1={pad} x2={W - pad} y1={sy(goal.target)} y2={sy(goal.target)} stroke="var(--green-700)" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
          <path d={path + ` L${sx(goal.spark.length - 1).toFixed(1)} ${Hh - pad} L${sx(0).toFixed(1)} ${Hh - pad} Z`} fill="var(--green-700)" opacity="0.08" />
          <path d={path} fill="none" stroke="var(--green-700)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {goal.spark.map((v, i) => <circle key={i} cx={sx(i)} cy={sy(v)} r="2.6" fill="#fff" stroke="var(--green-700)" strokeWidth="1.6" />)}
        </svg>
        <div className="sx">{goal.sparkLabels.map((l, i) => <span key={i}>{l}</span>)}</div>
      </div>
    </div>);

}

/* summary = goal card + 3 tiles + bulk CTA */
function Summary({ profile, works, bulkN, onBulk, onTarget }) {
  const H = window.HERO2;
  const total = works.length;
  const submitted = works.filter((w) => !w.notSubmitted).length;
  const attention = works.filter((w) => {const s = H.workState(w);return s.kind === 'review' || s.kind === 'manual';}).length;
  const gradable = works.filter((w) => !w.notSubmitted);
  const checked = gradable.filter((w) => H.workState(w).kind === 'verified').length;
  const pct = gradable.length ? Math.round(checked / gradable.length * 100) : 0;

  return (
    <div className="summary">
      <GoalCard goal={profile.goal} onTarget={onTarget} />
      <div className="summary-tiles">
        <div className="metric">
          <div className="label"><Icon name="list-checks" size={13} className="i" /> Сдано / всего</div>
          <div className="value">{submitted}<span className="unit">/ {total}</span></div>
          <div className="sub"><span className="muted">{total - submitted > 0 ? total - submitted + ' ждут сдачи' : 'всё сдано'}</span></div>
        </div>
        <div className="metric">
          <div className="label"><Icon name="percent" size={13} className="i" /> Проверено</div>
          <div className="value">{pct}<span className="unit">%</span></div>
          <div className="sub"><span className="muted">{checked} из {gradable.length} работ</span></div>
        </div>
        <div className={'metric' + (attention > 0 ? ' att' : '')}>
          <div className="label"><Icon name="triangle-alert" size={13} className="i" /> Требует внимания</div>
          <div className="value">{attention}</div>
          <div className="sub"><span className="muted">{attention > 0 ? 'работ на проверке' : 'всё проверено'}</span></div>
        </div>
      </div>

      {bulkN > 0 ?
      <div className="bulkbar">
          <div className="bb-i"><Icon name="badge-check" size={19} /></div>
          <div className="bb-txt">
            <b>AI проверил {bulkN} {plural2(bulkN, 'задачу', 'задачи', 'задач')} — подтвердите в один клик</b>
            <span className="s">Открывает задачи ученику. Несогласны с баллом — правьте по работе через «Изменить балл» внизу.</span>
          </div>
          <button className="btn btn--primary" onClick={onBulk}><Icon name="badge-check" size={16} className="ico" /> Подтвердить всё, что AI проверил ({bulkN})</button>
        </div> :

      <div className="bulkbar done">
          <div className="bb-i"><Icon name="check-circle" size={19} /></div>
          <div className="bb-txt"><b>Всё, что проверил AI, подтверждено</b><span className="s">Работы без AI-вердикта отмечены отдельно — проверьте вручную.</span></div>
        </div>
      }
    </div>);

}

function VadimNote() {
  return (
    <div className="vadim-note" title="Появится в спеке отчёта">
      <Icon name="square-pen" size={15} className="vi" />
      <span><b>Заметки репетитора</b> · знания теории, проблемы с урока — попадут в отчёт родителю за период</span>
      <span className="edit">Добавить</span>
    </div>);

}

function StatusBadge({ state }) {
  if (state.kind === 'verified') return <span className="st-badge ok"><Icon name="badge-check" size={15} className="bi" /> Проверено</span>;
  if (state.kind === 'review') return <span className="st-badge review"><Icon name="clock" size={15} className="bi" /> На проверке {state.n}</span>;
  if (state.kind === 'manual') return <span className="st-badge manual"><Icon name="square-pen" size={15} className="bi" /> Ручная проверка</span>;
  return <span className="st-badge none"><Icon name="clock" size={15} className="bi" /> Не сдано</span>;
}

function ConfirmCluster({ state, onConfirm, onEdit, onReopen }) {
  if (state.kind === 'verified') return <span className="reopen" onClick={onReopen}><Icon name="rotate-ccw" /> Открыть обратно</span>;
  if (state.kind === 'none') return null;
  if (state.kind === 'manual') return <button className="btn btn--sm btn--confirm" onClick={onEdit}><Icon name="badge-check" size={15} className="ico" /> Поставить балл и подтвердить</button>;
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button className="btn btn--sm" onClick={onEdit}>Изменить балл</button>
      <button className="btn btn--sm btn--confirm" onClick={onConfirm}><Icon name="badge-check" size={15} className="ico" /> Подтвердить</button>
    </div>);

}

/* unit-aware edit modal */
function EditScoreModal({ work, onClose, onSave }) {
  const H = window.HERO2;
  const isMark = work.unit === 'mark';
  const max = isMark ? 5 : work.rawMax;
  const [val, setVal] = React.useState(work.raw != null ? String(work.raw).replace('.', ',') : '');
  const [comment, setComment] = React.useState('');
  const [closeAfter, setCloseAfter] = React.useState(true);
  const num = Number(val.replace(',', '.'));
  const invalid = val.trim() === '' || Number.isNaN(num) || num < 0 || num > max;
  const aiTotal = work.aiGraded ? work.tasks.reduce((s, t) => s + (t.ai || 0), 0) : null;
  const unitWord = isMark ? 'Оценка (2–5)' : `Балл (0–${max})`;

  return (
    <div className="modal-scrim" onMouseDown={(e) => {if (e.target === e.currentTarget) onClose();}}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-h">
          <h3>{work.title} — {isMark ? 'оценка' : 'балл'}</h3>
          <p>{isMark ? 'Школьная оценка — фиксируется как есть.' : 'Балл репетитора — итог, который видит ученик. AI-оценка не перезаписывается.'}</p>
        </div>
        <div className="modal-b">
          <div className="score-context">
            Текущее: <span className="cur">{work.raw != null ? isMark ? H.fmt(work.raw) : H.fmt(work.raw) + ' / ' + max : '—'}</span>
            {work.aiGraded ? <span className="ai"> · AI: <b>{H.fmt(aiTotal)}</b> первичных б · снижено за подсказки</span> :
            <span className="ai"> · AI-вердикта нет — {isMark ? 'внесите оценку' : 'оцените вручную'}</span>}
          </div>
          <div className="field">
            <label htmlFor="sc">{unitWord}</label>
            <input id="sc" type="number" inputMode={isMark ? 'numeric' : 'decimal'} step={isMark ? 1 : 0.1} min="0" max={max}
            value={val} onChange={(e) => setVal(e.target.value)} />
            <div className="help">{invalid ? `Введите число 0…${max}` : isMark ? 'оценка 2…5' : `0…${max}, шаг 0.1`}</div>
          </div>
          <div className="field">
            <label htmlFor="cm">Комментарий (опционально, увидит ученик)</label>
            <textarea id="cm" rows="2" value={comment} onChange={(e) => setComment(e.target.value)}
            placeholder="Напр.: засчитал полный балл — ход решения правильный"></textarea>
          </div>
          <label className="field check" htmlFor="cl">
            <input id="cl" type="checkbox" checked={closeAfter} onChange={(e) => setCloseAfter(e.target.checked)} />
            <span>Подтвердить и закрыть работу<span className="s">Ученик увидит «проверено репетитором».</span></span>
          </label>
        </div>
        <div className="modal-f">
          <button className="btn btn--ghost left" onClick={onClose}>Отмена</button>
          <button className="btn btn--primary" disabled={invalid} onClick={() => onSave(num, closeAfter)}>
            <Icon name="badge-check" size={16} className="ico" /> {closeAfter ? 'Сохранить и подтвердить' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>);

}

function ReportPopover({ profile }) {
  const slug = profile.key === 'ege' ? 'maria-korolenko-apr' : profile.key === 'oge' ? 'kostya-lebedev-apr' : 'anya-orlova-apr';
  return (
    <div className="report-pop" onMouseDown={(e) => e.stopPropagation()}>
      <div className="rh">
        <div className="t"><Icon name="file-text" size={16} /> Отчёт родителю</div>
        <div className="p">Соберётся из подтверждённых данных · в родных единицах ученика</div>
      </div>
      <div className="rb">
        <div className="rrow"><Icon name="clock" size={15} className="ic" /> Период: <b>15 мар — 12 апр</b> (абонемент)</div>
        <div className="rrow"><Icon name="shield-check" size={15} className="ic" /> Только <b>подтверждённые</b> работы</div>
        <div className="rrow"><Icon name="target" size={15} className="ic" /> Цель: <b>{profile.goal.label.toLowerCase()} → {profile.goal.target}</b></div>
        <div className="rlink">sokratai.ru/p/{slug}</div>
      </div>
      <div className="rf">
        {window.SokratFlow && window.SokratFlow.active
          ? <button className="btn btn--primary" onClick={() => window.SokratFlow.navStep('report', { track: profile.key })}><Icon name="arrow-right" size={15} className="ico" /> Открыть отчёт родителю</button>
          : <button className="btn" disabled style={{ opacity: .6 }}><Icon name="arrow-right" size={15} className="ico" /> Открыть конструктор отчёта</button>}
        <div className="anti"><Icon name="shield-check" size={13} /> Без решений и рубрик — родитель видит динамику, не ответы</div>
      </div>
    </div>);

}

function Toast({ text }) {return <div className="toast"><Icon name="check-circle" size={16} /> {text}</div>;}

/* ── states ─────────────────────────────────────────────── */
function EmptyState({ onAssign }) {
  return (
    <div className="state-wrap">
      <div className="state-ill"><Icon name="inbox" size={30} /></div>
      <h3 className="state-h">Пока нет работ</h3>
      <p className="state-p">Назначьте первое ДЗ или пробник — сданные работы, баллы и прогресс к цели начнут собираться здесь.</p>
      <button className="btn btn--primary" onClick={onAssign}><Icon name="plus" size={16} className="ico" /> Назначить ДЗ</button>
    </div>
  );
}

function ErrorState({ onRetry }) {
  return (
    <div className="state-wrap">
      <div className="state-ill danger"><Icon name="triangle-alert" size={28} /></div>
      <h3 className="state-h">Не удалось загрузить прогресс</h3>
      <p className="state-p">Проверьте соединение и попробуйте ещё раз. Данные не потеряны.</p>
      <button className="btn btn--primary" onClick={onRetry}><Icon name="rotate-ccw" size={16} className="ico" /> Повторить</button>
    </div>
  );
}

function SkeletonState() {
  return (
    <div className="skel-wrap" aria-hidden="true">
      <div className="skel skel-goal"></div>
      <div className="skel-tiles">
        <div className="skel skel-tile"></div><div className="skel skel-tile"></div><div className="skel skel-tile"></div>
      </div>
      {[0, 1, 2, 3].map(i => (
        <div className="skel-work" key={i}>
          <div className="skel skel-ico"></div>
          <div className="skel-lines">
            <div className="skel skel-l1"></div>
            <div className="skel skel-l2"></div>
            <div className="skel skel-heat"></div>
          </div>
          <div className="skel skel-score"></div>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, {
  Icon2: Icon, KIND_ICON2, KIND_LABEL, ExamChip, ScoreRollup,
  Chrome2: Chrome, GoalCard, Summary2: Summary, VadimNote2: VadimNote,
  StatusBadge2: StatusBadge, ConfirmCluster2: ConfirmCluster, EditScoreModal2: EditScoreModal,
  ReportPopover2: ReportPopover, Toast2: Toast,
  EmptyState, ErrorState, SkeletonState, plural2
});