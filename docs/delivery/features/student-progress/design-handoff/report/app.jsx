/* SokratAI · №4 «Отчёт родителю» /p/:slug — app */

const RI = {
  'trophy': '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  'trending-up': '<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>',
  'trending-down': '<path d="M16 17h6v-6"/><path d="m22 17-8.5-8.5-5 5L2 7"/>',
  'target': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  'check-circle': '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
  'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  'lock': '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  'square-pen': '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>',
  'external-link': '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  'sparkles': '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z"/>',
};
function R({ name, size = 16, cls, style }) {
  return React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', className: cls, style, dangerouslySetInnerHTML: { __html: RI[name] || '' } });
}
const fmtMark = (n) => Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');

/* trend line chart (native unit, scaled axis) */
function TrendChart({ trend }) {
  const W = 560, H = 200, padL = 30, padR = 14, padT = 22, padB = 26;
  const s = trend.series, n = s.length;
  const lo = trend.axisLo, hi = trend.axisHi;
  const x = (i) => padL + i * (W - padL - padR) / (n - 1);
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const line = s.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  const area = line + ` L${x(n - 1).toFixed(1)} ${H - padB} L${x(0).toFixed(1)} ${H - padB} Z`;
  const ticks = trend.axisHi <= 5 ? [2, 3, 4, 5] : [0, 25, 50, 75, 100];
  const last = s[n - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      {/* goal band */}
      <rect x={padL} y={padT} width={W - padL - padR} height={Math.max(0, y(trend.goalBand) - padT)} fill="var(--ochre-500)" opacity="0.08" />
      <line x1={padL} x2={W - padR} y1={y(trend.goalBand)} y2={y(trend.goalBand)} stroke="var(--ochre-500)" strokeWidth="1" strokeDasharray="4 4" opacity="0.7" />
      <text x={W - padR} y={y(trend.goalBand) - 5} fontSize="10" fill="var(--ochre-700)" textAnchor="end" fontWeight="600">цель {trend.goalBand}{trend.axisHi <= 5 ? '' : ''}</text>
      {ticks.map(g => (
        <g key={g}>
          <line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} stroke="var(--border-l)" strokeWidth="1" />
          <text x={padL - 6} y={y(g) + 3} fontSize="9.5" fill="var(--fg-muted)" textAnchor="end">{g}</text>
        </g>
      ))}
      <path d={area} fill="var(--green-700)" opacity="0.08" />
      <path d={line} fill="none" stroke="var(--green-700)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {s.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="3.5" fill="#fff" stroke="var(--green-700)" strokeWidth="2" />)}
      {trend.tickLabels.map((l, i) => l ? <text key={i} x={x(i)} y={H - 8} fontSize="9.5" fill="var(--fg3)" textAnchor="middle">{l}</text> : null)}
      {/* last value pill */}
      <g transform={`translate(${x(n - 1)}, ${y(last)})`}>
        <rect x="-30" y="-30" width="60" height="20" rx="6" fill="var(--green-700)" />
        <text x="0" y="-16" fontSize="11" fill="#fff" textAnchor="middle" fontWeight="700">{fmtMark(last)}{trend.axisHi <= 5 ? '' : ' б'}</text>
      </g>
    </svg>
  );
}

function App() {
  const { TRACKS, PERIODS, forecastText, deltaOver } = window.RPT;
  const [trackKey, setTrackKey] = React.useState(() => {
    const t = window.SokratFlow && window.SokratFlow.active && window.SokratFlow.param('track');
    return (t && window.RPT.TRACKS[t]) ? t : 'ege';
  });
  const [periodKey, setPeriodKey] = React.useState('month');
  const t = TRACKS[trackKey];
  const period = PERIODS[periodKey];

  const [comment, setComment] = React.useState(t.comment);
  const [editingComment, setEditingComment] = React.useState(false);
  const [toast, setToast] = React.useState(null);
  const tr = React.useRef(0);
  React.useEffect(() => { setComment(t.comment); setEditingComment(false); }, [trackKey]);
  const flash = (m) => { setToast(m); clearTimeout(tr.current); tr.current = setTimeout(() => setToast(null), 2000); };

  const isMark = t.unit === 'mark';
  const delta = deltaOver(t.trend.series, period.back);
  const fc = forecastText(t);
  const pubUrl = 'sokratai.ru/p/' + t.slug;

  const periodWord = periodKey === 'week' ? 'за неделю' : periodKey === 'month' ? 'за 4 недели' : 'за период';

  const copyText = () => {
    const lines = [];
    lines.push(`Отчёт по ученику: ${t.student}, ${t.grade} — ${t.subject}`);
    lines.push(`Период: ${period.range}`);
    lines.push(`${t.curLabel}: ${isMark ? fmtMark(t.current) : t.current} ${t.curUnit}`);
    lines.push(`Динамика ${periodWord}: ${delta > 0 ? '+' : ''}${fmtMark(delta)} ${isMark ? 'к оценке' : 'балла'}`);
    lines.push(`${t.forecastLabel}: ${fc} (≈ прогноз по темпу)`);
    lines.push('');
    lines.push(`Освоено: ${t.zones.green.join(', ')}`);
    lines.push(`В работе: ${t.zones.yellow.join(', ')}`);
    lines.push(`Требует внимания: ${t.zones.red.join(', ')}`);
    lines.push('');
    lines.push('Последние работы:');
    t.recent.forEach(r => lines.push(`— ${r.title}: ${r.confirmed ? r.pct + '%' : r.status}`));
    lines.push('');
    lines.push(`Комментарий репетитора (${t.tutor}): ${comment}`);
    lines.push('');
    lines.push(`Полный отчёт: ${pubUrl}`);
    const text = lines.join('\n');
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => flash('Текст отчёта скопирован'), () => flash('Текст готов к копированию'));
    else flash('Текст готов');
  };
  const copyLink = () => {
    if (navigator.clipboard) navigator.clipboard.writeText('https://' + pubUrl).then(() => flash('Ссылка скопирована'), () => flash('Ссылка готова'));
    else flash('Ссылка готова');
  };

  const pctCls = (p) => p >= 80 ? 'hi' : p >= 50 ? 'mid' : 'low';

  return (
    <React.Fragment>
      {/* tutor action bar — not part of the public page */}
      <div className="actionbar">
        <div className="ab-l">
          <span className="lbl">Период</span>
          <div className="period-seg" role="group" aria-label="Период отчёта">
            {Object.values(PERIODS).map(p => (
              <button key={p.id} className={periodKey === p.id ? 'on' : ''} onClick={() => setPeriodKey(p.id)}>{p.label}</button>
            ))}
          </div>
          {/* demo: track switcher */}
          <span className="lbl" style={{ marginLeft: 6 }}>Трек</span>
          <div className="period-seg">
            {[['ege', 'ЕГЭ'], ['oge', 'ОГЭ'], ['school', 'Школа']].map(([k, l]) => (
              <button key={k} className={trackKey === k ? 'on' : ''} onClick={() => setTrackKey(k)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="ab-r">
          <div className="urlbox" title={pubUrl}>
            <R name="lock" cls="lock" />
            <code>{pubUrl}</code>
          </div>
          <button className="btn btn--sm" onClick={copyLink}><R name="link" size={15} cls="ico" /> Ссылка</button>
          <button className="btn btn--sm" onClick={copyText}><R name="copy" size={15} cls="ico" /> Текст</button>
          <button className="btn btn--sm btn--primary" onClick={() => window.print()}><R name="download" size={15} cls="ico" /> PDF / картинка</button>
          <span className="pub-note"><R name="shield-check" /> без регистрации</span>
        </div>
      </div>

      <div className="rpt-page">
        <div className="sheet-wrap">
          <div className="sheet" id="report-sheet">
            {/* header */}
            <div className="rh">
              <img className="logo" src="assets/sokrat-logo.png" alt="" />
              <div className="brand">
                <div className="nm">Сократ AI</div>
                <div className="sub">Отчёт родителю · {periodWord}</div>
              </div>
              <div className="rh-r">
                <span className="confirmed-pill"><R name="check-circle" /> Только подтверждённое</span>
                <span className="date-pill">{period.range}</span>
              </div>
            </div>

            {/* title + stats */}
            <div className="rtitle">
              <div>
                <h1>{t.student}, {t.grade} — {t.subject}</h1>
                <div className="tutor">Репетитор: {t.tutor}</div>
              </div>
              <div className="rstats">
                <div className="stat cur">
                  <div className="sl"><R name="trophy" size={13} /> {t.curLabel}</div>
                  <div className="sv">{isMark ? fmtMark(t.current) : t.current}<span className="u"> {t.curUnit}</span></div>
                  <div className="ss">цель {t.goalTarget}</div>
                </div>
                <div className="stat delta">
                  <div className="sl"><R name={delta < 0 ? 'trending-down' : 'trending-up'} size={13} /> {period.label}</div>
                  <div className="sv">{delta > 0 ? '+' : ''}{fmtMark(delta)}</div>
                  <div className="ss">{isMark ? 'к оценке' : 'темп растёт'}</div>
                </div>
                <div className="stat fc">
                  <div className="sl"><R name="target" size={13} /> {t.forecastLabel}</div>
                  <div className="sv">{fc}</div>
                  <div className="ss">при текущем темпе</div>
                </div>
              </div>
            </div>

            {/* topic map */}
            <div className="zones">
              <div className="sec-lab">Карта тем <span className="hint">по статусу освоения</span></div>
              <div className="zgrid">
                <div className="zone green">
                  <div className="ztop"></div>
                  <div className="zbody">
                    <div className="zh">Зелёная зона</div>
                    <div className="zsub">освоено · {t.zones.green.length} {t.zones.green.length === 1 ? 'тема' : 'темы'}</div>
                    <ul>{t.zones.green.map((z, i) => <li key={i}><span className="zd"></span>{z}</li>)}</ul>
                  </div>
                </div>
                <div className="zone yellow">
                  <div className="ztop"></div>
                  <div className="zbody">
                    <div className="zh">Жёлтая зона</div>
                    <div className="zsub">в работе · {t.zones.yellow.length} {t.zones.yellow.length === 1 ? 'тема' : 'темы'}</div>
                    <ul>{t.zones.yellow.map((z, i) => <li key={i}><span className="zd"></span>{z}</li>)}</ul>
                  </div>
                </div>
                <div className="zone red">
                  <div className="ztop"></div>
                  <div className="zbody">
                    <div className="zh">Красная зона</div>
                    <div className="zsub">требует внимания · {t.zones.red.length} {t.zones.red.length === 1 ? 'тема' : 'темы'}</div>
                    <ul>{t.zones.red.map((z, i) => <li key={i}><span className="zd"></span>{z}</li>)}</ul>
                  </div>
                </div>
              </div>
            </div>

            {/* chart + recent */}
            <div className="lower">
              <div>
                <div className="sec-lab">Динамика {isMark ? 'оценки' : 'балла'} <span className="hint">{t.trend.series.length} точек · ось {t.trend.axisLo}—{t.trend.axisHi}</span></div>
                <div className="chart-h">
                  <span className={'delta ' + (delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat')}>{delta > 0 ? '+' : ''}{fmtMark(delta)} {isMark ? 'к оценке' : 'балла'}</span>
                  <span className="tempo">{periodWord}</span>
                </div>
                <div className="chartbox"><TrendChart trend={t.trend} /></div>
              </div>
              <div>
                <div className="sec-lab">Последние работы <span className="hint">{periodWord}</span></div>
                <div className="recent">
                  {t.recent.map((r, i) => (
                    <div className="ri" key={i}>
                      <div className="rt">
                        <div className="t">{r.title}</div>
                        <div className="s">{r.sub}</div>
                      </div>
                      {r.confirmed
                        ? <span className={'pct ' + pctCls(r.pct)}>{r.markNote ? r.markNote : r.pct + '%'}</span>
                        : <span className="pend">{r.status}</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* tutor comment (editable) */}
            <div className="rcomment">
              <div className="cbox">
                <div className="ch">
                  <R name="square-pen" /> Комментарий репетитора
                  {!editingComment && <span className="edit" onClick={() => setEditingComment(true)}><R name="square-pen" /> изменить</span>}
                </div>
                {editingComment ? (
                  <textarea autoFocus value={comment} onChange={(e) => setComment(e.target.value)}
                    onBlur={() => setEditingComment(false)}
                    onKeyDown={(e) => { if (e.key === 'Escape') setEditingComment(false); }} />
                ) : (
                  <div className="ctext">{comment}<div className="by">— {t.tutor}</div></div>
                )}
              </div>
            </div>

            {/* footer */}
            <div className="rfoot">
              <span className="gen"><R name="sparkles" size={14} style={{ color: 'var(--green-700)' }} /> Собрано Сократ AI из подтверждённых данных</span>
              <span className="leak"><R name="shield-check" /> Без решений, рубрик и AI-вердиктов — только итоги</span>
              <span className="site">sokratai.ru</span>
            </div>
          </div>
        </div>
      </div>

      {toast && <div className="toast"><R name="check-circle" size={16} /> {toast}</div>}
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
if (window.SokratFlow) window.SokratFlow.mark('report');
