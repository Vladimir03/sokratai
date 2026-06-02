/* SokratAI · №2 «Успеваемость» — MOBILE app (iOS frame harness) */

const MU_ICONS = {
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'folder-tree': '<path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 14 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H12a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M3 5a2 2 0 0 0 2 2h3"/><path d="M3 3v13a2 2 0 0 0 2 2h3"/>',
  'triangle-alert': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  'target': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  'badge-check': '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>',
  'check-circle': '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
  'check': '<path d="M20 6 9 17l-5-5"/>',
  'arrow-down-up': '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/>',
  'sliders': '<line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="2" x2="6" y1="14" y2="14"/><line x1="10" x2="14" y1="8" y2="8"/><line x1="18" x2="22" y1="16" y2="16"/>',
  'trending-up': '<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>',
  'trending-down': '<path d="M16 17h6v-6"/><path d="m22 17-8.5-8.5-5 5L2 7"/>',
  'minus': '<path d="M5 12h14"/>',
  'clock': '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  'trend-flag': '<path d="M3 22V4a1 1 0 0 1 1-1h14l-3 5 3 5H4"/>',
  'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'rotate-ccw': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  'inbox': '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  'a-z': '<path d="M3 16h6"/><path d="m3 20 3-8 3 8"/><path d="M14 4h7l-7 16h7"/>',
};
function M({ name, size = 16, cls, style }) {
  return React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', className: cls, style, dangerouslySetInnerHTML: { __html: MU_ICONS[name] || '' } });
}

const mGoalCls = (s) => s.behind ? 'low' : (s.goalPct < 75 ? 'mid' : 'hi');
const mTrend = (t) => t < 0 ? 'trending-down' : t > 0 ? 'trending-up' : 'minus';
const mTrendCls = (t) => t < 0 ? 'down' : t > 0 ? 'up' : 'flat';

/* one student card */
const MCard = React.memo(function MCard({ s }) {
  const gc = mGoalCls(s);
  return (
    <div className="um-card" role="button" tabIndex={0}>
      <div className="c-top">
        <span className={'adot ' + (s.risk ? 'risk' : s.backlog ? 'backlog' : 'off')}></span>
        <span className="nm">{s.name}</span>
        <span className="stream">{s.stream}</span>
        <M name="chevron-right" size={18} cls="chev" />
      </div>
      <div className="grade">{s.grade} · {s.groupName}</div>
      <div className="um-metrics">
        <div className="mg">
          <div className="ml"><span>% к цели</span><span className={'v ' + gc}>{s.goalPct}%<M name={mTrend(s.trend)} size={13} cls={'trend-i ' + mTrendCls(s.trend)} /></span></div>
          <div className={'bar ' + gc}><span style={{ width: s.goalPct + '%' }}></span></div>
        </div>
        <div className="mc">
          <div className="ml" style={{ justifyContent: 'flex-end' }}><span>проверено</span></div>
          {s.checkedPct === 100
            ? <div className="v full"><M name="badge-check" size={14} /> 100%</div>
            : <div className="v">{s.checkedPct}%</div>}
        </div>
      </div>
      {(s.risk || s.backlog) ? (
        <div className="um-sigs">
          {s.risk && <span className="um-sig risk"><M name="trend-flag" size={12} /> {s.riskReason}</span>}
          {s.backlog && <span className="um-sig backlog"><M name="clock" size={12} /> {s.backlogReason}</span>}
        </div>
      ) : (
        <div className="um-sigs"><span className="um-sig ok">всё в норме</span></div>
      )}
    </div>
  );
});

/* windowed list — render only what's near viewport (handles 62+ smoothly) */
function WindowedList({ items, grouped }) {
  const ROW = 150, GROUP = 40, OVER = 6;
  const scRef = React.useRef(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [vh, setVh] = React.useState(640);
  React.useEffect(() => {
    const el = scRef.current; if (!el) return;
    setVh(el.clientHeight);
    const on = () => setScrollTop(el.scrollTop);
    el.addEventListener('scroll', on, { passive: true });
    return () => el.removeEventListener('scroll', on);
  }, []);

  // flatten to a positioned list
  const flat = React.useMemo(() => {
    const rows = []; let y = 0;
    if (grouped) {
      grouped.forEach(g => {
        rows.push({ type: 'grp', g, y, h: GROUP }); y += GROUP;
        g.students.forEach(s => { rows.push({ type: 'row', s, y, h: ROW }); y += ROW; });
      });
    } else {
      items.forEach(s => { rows.push({ type: 'row', s, y, h: ROW }); y += ROW; });
    }
    return { rows, total: y };
  }, [items, grouped]);

  const start = scrollTop - OVER * ROW, end = scrollTop + vh + OVER * ROW;
  const visible = flat.rows.filter(r => (r.y + r.h) >= start && r.y <= end);

  return (
    <div className="um-scroll" ref={scRef}>
      <div style={{ position: 'relative', height: flat.total }}>
        {visible.map((r, i) =>
          r.type === 'grp' ? (
            <div key={'g' + r.g.key} className="um-grp" style={{ position: 'absolute', top: r.y, left: 0, right: 0, height: GROUP }}>
              <M name="folder-tree" size={14} /> {r.g.label}
              <span className="c">{r.g.students.length}</span>
              {r.g.risk > 0 && <span className="ga"><M name="trend-flag" size={11} /> {r.g.risk} отстают</span>}
            </div>
          ) : (
            <div key={r.s.id} style={{ position: 'absolute', top: r.y, left: 0, right: 0, padding: '0' }}>
              <MCard s={r.s} />
            </div>
          )
        )}
      </div>
    </div>
  );
}

/* bottom-sheet: filter + sort */
function ControlsSheet({ open, onClose, filterMode, setFilterMode, sort, setSort, counts }) {
  if (!open) return null;
  const sorts = [
    { k: 'attention', label: 'Приоритет', sub: 'риск, затем бэклог', icon: 'arrow-down-up' },
    { k: 'groups', label: 'По группам', sub: 'сгруппировать', icon: 'folder-tree' },
    { k: 'goal', label: '% к цели', sub: 'отстающие сверху', icon: 'target' },
    { k: 'name', label: 'По алфавиту', sub: 'А → Я', icon: 'a-z' },
  ];
  const filters = [
    { k: 'risk', label: 'Отстают', sub: 'риск удержания', icon: 'trend-flag', cnt: counts.risk, cls: 'risk' },
    { k: 'backlog', label: 'Ждут проверки', sub: 'мой бэклог', icon: 'clock', cnt: counts.backlog, cls: 'backlog' },
  ];
  return (
    <div className="um-sheet-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="um-sheet">
        <div className="grab"></div>
        <h3>Фильтр и сортировка</h3>
        <div className="sec">Показать только</div>
        {filters.map(f => (
          <button key={f.k} className={'um-opt ' + f.cls + (filterMode === f.k ? ' on' : '')} onClick={() => setFilterMode(filterMode === f.k ? null : f.k)}>
            <span className="oi"><M name={f.icon} /></span>
            <span className="ot">{f.label}<span className="os">{f.sub}</span></span>
            <span className="cnt">{f.cnt}</span>
            <span className="chk">{filterMode === f.k && <M name="check" size={13} />}</span>
          </button>
        ))}
        <div className="sec">Сортировка</div>
        {sorts.map(o => (
          <button key={o.k} className={'um-opt' + (sort === o.k ? ' on' : '')} onClick={() => setSort(o.k)}>
            <span className="oi"><M name={o.icon} /></span>
            <span className="ot">{o.label}<span className="os">{o.sub}</span></span>
            <span className="chk">{sort === o.k && <M name="check" size={13} />}</span>
          </button>
        ))}
        <div className="applybar">
          {(filterMode || sort !== 'attention') && (
            <button className="btn reset" onClick={() => { setFilterMode(null); setSort('attention'); }}><M name="rotate-ccw" size={15} cls="ico" /> Сброс</button>
          )}
          <button className="btn btn--primary" onClick={onClose}>Готово</button>
        </div>
      </div>
    </div>
  );
}

function AppMobile() {
  const { STUDENTS, plural } = window.USP;
  const [state, setState] = React.useState('ready');
  const [sort, setSort] = React.useState('attention');
  const [filterMode, setFilterMode] = React.useState(null);
  const [sheet, setSheet] = React.useState(false);

  const riskTotal = STUDENTS.filter(s => s.risk).length;
  const backlogTotal = STUDENTS.filter(s => s.backlog).length;

  const filtered = React.useMemo(() => {
    if (filterMode === 'risk') return STUDENTS.filter(s => s.risk);
    if (filterMode === 'backlog') return STUDENTS.filter(s => s.backlog);
    return STUDENTS;
  }, [STUDENTS, filterMode]);

  const byAttention = (a, b) => (b.attnScore - a.attnScore) || a.name.localeCompare(b.name, 'ru');
  const byGoal = (a, b) => a.goalPct - b.goalPct || a.name.localeCompare(b.name, 'ru');
  const byName = (a, b) => a.name.localeCompare(b.name, 'ru');

  const sorted = React.useMemo(() => {
    const c = filtered.slice();
    if (sort === 'goal') c.sort(byGoal); else if (sort === 'name') c.sort(byName); else c.sort(byAttention);
    return c;
  }, [filtered, sort]);

  const grouped = React.useMemo(() => {
    if (sort !== 'groups') return null;
    const m = new Map();
    for (const s of filtered.slice().sort(byAttention)) {
      const key = s.groupId ?? '__none__';
      if (!m.has(key)) m.set(key, { key, label: s.groupName, students: [], risk: 0 });
      const g = m.get(key); g.students.push(s); if (s.risk) g.risk++;
    }
    const all = [...m.values()];
    all.sort((a, b) => a.key === '__none__' ? 1 : b.key === '__none__' ? -1 : a.label.localeCompare(b.label, 'ru'));
    return all;
  }, [filtered, sort]);

  const activeCount = (filterMode ? 1 : 0) + (sort !== 'attention' ? 1 : 0);
  const sortLabel = { attention: 'Приоритет', groups: 'Группы', goal: '% к цели', name: 'А→Я' }[sort];

  let body;
  if (state === 'loading') {
    body = (
      <div className="um-skel">
        {[0, 1, 2, 3, 4].map(i => (
          <div className="um-skcard" key={i}>
            <div className="r1"><span className="um-sk um-sk-dot"></span><span className="um-sk um-sk-nm"></span><span className="um-sk um-sk-chip"></span></div>
            <div className="um-sk um-sk-bar"></div>
            <div className="um-sk um-sk-sig"></div>
          </div>
        ))}
      </div>
    );
  } else if (state === 'error') {
    body = (
      <div className="um-state">
        <div className="ill danger"><M name="triangle-alert" size={28} /></div>
        <h3>Не удалось загрузить</h3>
        <p>Проверьте соединение и попробуйте ещё раз. Список учеников не потерян.</p>
        <button className="cta" onClick={() => setState('ready')}><M name="rotate-ccw" size={17} /> Повторить</button>
      </div>
    );
  } else if (sorted.length === 0) {
    body = (
      <div className="um-state">
        <div className="ill"><M name="check-circle" size={26} /></div>
        <h3>{filterMode === 'risk' ? 'Отстающих нет' : 'Непроверенного нет'}</h3>
        <p>{filterMode === 'risk' ? 'Все ученики движутся к цели.' : 'У всех всё подтверждено.'} Снимите фильтр, чтобы видеть весь список.</p>
        <button className="cta" onClick={() => setFilterMode(null)}><M name="x" size={16} /> Снять фильтр</button>
      </div>
    );
  } else {
    body = <WindowedList items={sorted} grouped={grouped} />;
  }

  return (
    <React.Fragment>
      {/* canvas harness controls */}
      <div className="cv-top">
        <div className="lede">
          <h1>Успеваемость · мобайл + состояния</h1>
          <div className="path">таблица → карточки · фильтр/сортировка в bottom-sheet · windowed 62</div>
        </div>
        <div className="v2-switch">
          <span className="sl">Состояние:</span>
          <div className="cv-jump">
            {[['ready', 'Норма'], ['empty', 'Пустой*'], ['loading', 'Загрузка'], ['error', 'Ошибка']].map(([k, l]) => (
              <button key={k} className={state === k ? 'active' : ''} onClick={() => { if (k === 'empty') { setFilterMode('risk'); setState('ready'); } else setState(k); }}><span className="k">{l}</span></button>
            ))}
          </div>
        </div>
      </div>

      <div className="um-stage">
        <IOSDevice width={390} height={844}>
          <div className="usp--m">
            <div className="um-head">
              <div className="ht">
                <div>
                  <h2>Успеваемость</h2>
                  <div className="count">{STUDENTS.length} {plural(STUDENTS.length, 'ученик', 'ученика', 'учеников')} · <b className="r">{riskTotal} отстают</b> · <b className="b">{backlogTotal} на проверке</b></div>
                </div>
                <div className="ctrl">
                  <button className="um-ctrl-btn" onClick={() => setSheet(true)}>
                    <M name="sliders" size={16} /> Фильтр
                    {activeCount > 0 && <span className="badge">{activeCount}</span>}
                  </button>
                </div>
              </div>
              {(filterMode || sort !== 'attention') && (
                <div className="um-chips">
                  {filterMode === 'risk' && <span className="um-chip risk"><M name="trend-flag" size={12} /> Отстают <span className="x" onClick={() => setFilterMode(null)}><M name="x" size={13} /></span></span>}
                  {filterMode === 'backlog' && <span className="um-chip backlog"><M name="clock" size={12} /> Ждут проверки <span className="x" onClick={() => setFilterMode(null)}><M name="x" size={13} /></span></span>}
                  {sort !== 'attention' && <span className="um-chip sort"><M name="arrow-down-up" size={12} /> {sortLabel}</span>}
                </div>
              )}
            </div>
            {body}
            <ControlsSheet open={sheet} onClose={() => setSheet(false)}
              filterMode={filterMode} setFilterMode={setFilterMode}
              sort={sort} setSort={setSort} counts={{ risk: riskTotal, backlog: backlogTotal }} />
          </div>
        </IOSDevice>
      </div>
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<AppMobile />);
