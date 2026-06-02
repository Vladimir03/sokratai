/* SokratAI · «Успеваемость» — cross-student list app */

const U_ICONS = {
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'folder-tree': '<path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 14 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H12a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M3 5a2 2 0 0 0 2 2h3"/><path d="M3 3v13a2 2 0 0 0 2 2h3"/>',
  'triangle-alert': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  'users': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'target': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  'badge-check': '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>',
  'check-circle': '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
  'filter': '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  'arrow-down-up': '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/>',
  'search': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  'trending-up': '<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>',
  'trending-down': '<path d="M16 17h6v-6"/><path d="m22 17-8.5-8.5-5 5L2 7"/>',
  'minus': '<path d="M5 12h14"/>',
  'clock': '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  'trend-flag': '<path d="M3 22V4a1 1 0 0 1 1-1h14l-3 5 3 5H4"/>',
};
function UI({ name, size = 16, cls, style }) {
  return React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', className: cls, style, dangerouslySetInnerHTML: { __html: U_ICONS[name] || '' } });
}

const HERO_URL = 'Прогресс ученика - hero v2.html';
function openStudent(s) {
  if (window.SokratFlow && window.SokratFlow.active) { window.SokratFlow.navStep('hero', { track: s.track || 'ege' }); return; }
  const url = s.track ? HERO_URL + '?track=' + s.track : HERO_URL;
  window.location.href = url;
}
const pctCls = (p) => p < 45 ? 'low' : p < 75 ? 'mid' : 'hi';
const goalCls = (s) => s.behind ? 'low' : (s.goalPct < 75 ? 'mid' : 'hi');
const trendName = (t) => t < 0 ? 'trending-down' : t > 0 ? 'trending-up' : 'minus';
const trendCls = (t) => t < 0 ? 'down' : t > 0 ? 'up' : 'flat';

const Row = React.memo(function Row({ s }) {
  return (
    <tr className="row" tabIndex={0} role="button" aria-label={'Открыть прогресс: ' + s.name}
      onClick={() => openStudent(s)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openStudent(s); } }}>
      <td>
        <span className="scell">
          <span className={'adot ' + (s.risk ? 'risk' : s.backlog ? 'backlog' : 'off')} aria-hidden="true"></span>
          <span className="nm">{s.name}</span>
          <span className="stream-chip">{s.stream}</span>
          <span className="grade">{s.grade}</span>
        </span>
      </td>
      <td>
        <span className="barcell">
          <span className={'bar bar-goal ' + goalCls(s)}><span style={{ width: s.goalPct + '%' }}></span></span>
          <span className={'pct ' + goalCls(s)}>{s.goalPct}%</span>
          <UI name={trendName(s.trend)} size={13} cls={'trend-i ' + trendCls(s.trend)} />
        </span>
      </td>
      <td>
        {s.checkedPct === 100 ? (
          <span className="chk full"><UI name="badge-check" size={15} /> 100%</span>
        ) : (
          <span className="chk">
            <span className="track"><span style={{ width: s.checkedPct + '%' }}></span></span>
            {s.checkedPct}%
          </span>
        )}
      </td>
      <td>
        {(s.risk || s.backlog) ? (
          <span className="sigs">
            {s.risk && <span className="sig-chip risk"><UI name="trend-flag" size={13} /> {s.riskReason}</span>}
            {s.backlog && <span className="sig-chip backlog"><UI name="clock" size={13} /> {s.backlogReason}</span>}
          </span>
        ) : (
          <span className="sig-ok">всё в норме</span>
        )}
      </td>
      <td><button className="act-btn" tabIndex={-1} aria-hidden="true" onClick={(e) => { e.stopPropagation(); openStudent(s); }}><UI name="chevron-right" size={18} /></button></td>
    </tr>
  );
});

function App() {
  const { STUDENTS, plural } = window.USP;
  const [sort, setSort] = React.useState('attention');

  const riskTotal = STUDENTS.filter(s => s.risk).length;
  const backlogTotal = STUDENTS.filter(s => s.backlog).length;
  const [filterMode, setFilterMode] = React.useState(null); // null | 'risk' | 'backlog'

  const filtered = React.useMemo(() => {
    if (filterMode === 'risk') return STUDENTS.filter(s => s.risk);
    if (filterMode === 'backlog') return STUDENTS.filter(s => s.backlog);
    return STUDENTS;
  }, [STUDENTS, filterMode]);

  const byAttention = (a, b) => (b.attnScore - a.attnScore) || a.name.localeCompare(b.name, 'ru');
  const byName = (a, b) => a.name.localeCompare(b.name, 'ru');
  const byGoal = (a, b) => a.goalPct - b.goalPct || a.name.localeCompare(b.name, 'ru');

  const sorted = React.useMemo(() => {
    const c = filtered.slice();
    if (sort === 'attention') c.sort(byAttention);
    else if (sort === 'goal') c.sort(byGoal);
    else c.sort(byName);
    return c;
  }, [filtered, sort]);

  const groups = React.useMemo(() => {
    if (sort !== 'groups') return null;
    const m = new Map();
    for (const s of filtered.slice().sort(byAttention)) {
      const key = s.groupId ?? '__none__';
      if (!m.has(key)) m.set(key, { key, label: s.groupName, students: [] });
      m.get(key).students.push(s);
    }
    const all = [...m.values()];
    all.sort((a, b) => a.key === '__none__' ? 1 : b.key === '__none__' ? -1 : a.label.localeCompare(b.label, 'ru'));
    return all;
  }, [filtered, sort]);

  const COLS = 5;
  const segs = [
    { k: 'attention', label: <span><UI name="arrow-down-up" size={13} /> Приоритет</span> },
    { k: 'groups', label: <span><UI name="folder-tree" size={13} /> Группы</span> },
    { k: 'goal', label: '% к цели' },
    { k: 'name', label: 'А→Я' },
  ];

  return (
    <React.Fragment>
      <div className="topnav">
        <div className="brand"><img src="assets/sokrat-logo.png" alt="" /> Сократ AI <span className="tag">ТЬЮТОР</span></div>
        <nav className="navlinks"><a href="#">Главная</a><a href="#" className="active">Ученики</a><a href="#">Домашки</a><a href="#">Пробники</a></nav>
        <span className="spacer"></span>
        <div className="ava">ЕВ</div>
      </div>

      <div className="page">
        <div className="crumb"><a href="#">Ученики</a><span className="sep">/</span><span className="cur">Успеваемость</span></div>

        <div className="usp">
          <div className="usp-head">
            <div className="ht">
              <h2>Успеваемость</h2>
              <div className="meta">{STUDENTS.length} {plural(STUDENTS.length, 'ученик', 'ученика', 'учеников')} · <b className="risk">{riskTotal} отстают</b> · <b className="bl">{backlogTotal} ждут моей проверки</b></div>
            </div>
            <div className="usp-tools">
              <button className={'flt risk' + (filterMode === 'risk' ? ' on' : '')} onClick={() => setFilterMode(m => m === 'risk' ? null : 'risk')} aria-pressed={filterMode === 'risk'}>
                <UI name="trend-flag" size={15} /> Отстают
              </button>
              <button className={'flt backlog' + (filterMode === 'backlog' ? ' on' : '')} onClick={() => setFilterMode(m => m === 'backlog' ? null : 'backlog')} aria-pressed={filterMode === 'backlog'}>
                <UI name="clock" size={15} /> Ждут проверки
              </button>
              <div className="seg" role="group" aria-label="Сортировка">
                {segs.map(x => (
                  <button key={x.k} className={sort === x.k ? 'on' : ''} aria-pressed={sort === x.k} onClick={() => setSort(x.k)}>{x.label}</button>
                ))}
              </div>
            </div>
          </div>

          {sorted.length === 0 ? (
            <div className="usp-empty">
              <div className="ill"><UI name="check-circle" size={26} /></div>
              <h3>{filterMode === 'risk' ? 'Отстающих нет' : 'Непроверенного нет'}</h3>
              <p>{filterMode === 'risk' ? 'Все ученики движутся к цели. Снимите фильтр, чтобы видеть весь список.' : 'У всех учеников всё подтверждено. Снимите фильтр, чтобы видеть весь список.'}</p>
            </div>
          ) : (
            <div className="usp-wrap">
              <table className="usp-t">
                <colgroup><col /><col style={{ width: 170 }} /><col style={{ width: 160 }} /><col style={{ width: 240 }} /><col style={{ width: 48 }} /></colgroup>
                <thead>
                  <tr>
                    <th>Ученик</th>
                    <th className="num">% к цели</th>
                    <th className="num">% проверено</th>
                    <th className="sig">Сигналы</th>
                    <th className="act" aria-label="Действие"></th>
                  </tr>
                </thead>
                <tbody>
                  {sort === 'groups'
                    ? groups.map(g => {
                        const grisk = g.students.filter(s => s.risk).length;
                        const gbl = g.students.filter(s => s.backlog).length;
                        return (
                          <React.Fragment key={g.key}>
                            <tr className="grp">
                              <th colSpan={COLS} scope="colgroup">
                                <span className="gh">
                                  <UI name="folder-tree" size={14} />
                                  {g.label}
                                  <span className="count">{g.students.length}</span>
                                  {grisk > 0 && <span className="gatt"><UI name="trend-flag" size={12} /> {grisk} отстают</span>}
                                  {gbl > 0 && <span className="gbl"><UI name="clock" size={12} /> {gbl} на проверке</span>}
                                </span>
                              </th>
                            </tr>
                            {g.students.map(s => <Row key={s.id} s={s} />)}
                          </React.Fragment>
                        );
                      })
                    : sorted.map(s => <Row key={s.id} s={s} />)}
                </tbody>
              </table>
            </div>
          )}

          <div className="usp-foot">
            <span className="lg"><span className="lg-chip risk"><UI name="trend-flag" size={12} /> отстаёт</span> риск удержания — далеко от цели / падает динамика</span>
            <span className="lg"><span className="lg-chip backlog"><UI name="clock" size={12} /> на проверке</span> мой бэклог — подтвердить / поставить балл</span>
            <span className="hint">Клик по строке открывает прогресс ученика.</span>
          </div>
        </div>
      </div>
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
if (window.SokratFlow) window.SokratFlow.mark('usp');
