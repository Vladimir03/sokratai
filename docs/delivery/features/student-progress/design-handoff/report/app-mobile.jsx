/* SokratAI · №4 «Отчёт родителю» — MOBILE app (iOS frame harness) */

const RI = {
  'trophy': '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  'target': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  'check-circle': '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
  'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  'square-pen': '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>',
  'external-link': '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  'clock-x': '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/><path d="m17 17 5 5"/><path d="m22 17-5 5"/>',
  'send': '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
};
function R({ name, size = 16, cls, style }) {
  return React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', className: cls, style, dangerouslySetInnerHTML: { __html: RI[name] || '' } });
}

/* compact trend chart for 390px */
function MTrend({ trend }) {
  const W = 330, H = 120, padL = 22, padR = 10, padT = 16, padB = 18;
  const s = trend.series, n = s.length;
  const lo = trend.axisLo, hi = trend.axisHi;
  const x = (i) => padL + i * (W - padL - padR) / (n - 1);
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const line = s.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  const area = line + ` L${x(n - 1).toFixed(1)} ${H - padB} L${x(0).toFixed(1)} ${H - padB} Z`;
  const last = s[n - 1];
  const isMark = hi <= 5;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      <rect x={padL} y={padT} width={W - padL - padR} height={Math.max(0, y(trend.goalBand) - padT)} fill="var(--ochre-500)" opacity="0.08" />
      <line x1={padL} x2={W - padR} y1={y(trend.goalBand)} y2={y(trend.goalBand)} stroke="var(--ochre-500)" strokeWidth="1" strokeDasharray="4 4" opacity="0.7" />
      <text x={W - padR} y={y(trend.goalBand) - 4} fontSize="9.5" fill="var(--ochre-700)" textAnchor="end" fontWeight="700">цель {trend.goalBand}</text>
      <path d={area} fill="var(--green-700)" opacity="0.08" />
      <path d={line} fill="none" stroke="var(--green-700)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {s.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="3" fill="#fff" stroke="var(--green-700)" strokeWidth="2" />)}
      {trend.tickLabels.map((l, i) => (i === 0 || i === n - 1) && l ? <text key={i} x={x(i)} y={H - 5} fontSize="9" fill="var(--fg3)" textAnchor={i === 0 ? 'start' : 'end'}>{l}</text> : null)}
      <g transform={`translate(${x(n - 1)}, ${y(last)})`}>
        <circle cx="0" cy="0" r="4.5" fill="var(--green-700)" />
      </g>
    </svg>
  );
}

function ReportMobile({ track, period, comment }) {
  const { forecastText, deltaOver } = window.RPT;
  const t = track;
  const isMark = t.unit === 'mark';
  const fmtMark = (n) => Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
  const delta = deltaOver(t.trend.series, period.back);
  const fc = forecastText(t);
  const pctCls = (p) => p >= 80 ? 'hi' : p >= 50 ? 'mid' : 'low';
  const periodWord = period.id === 'week' ? 'за неделю' : period.id === 'month' ? 'за 4 недели' : 'за период';

  return (
    <React.Fragment>
      {/* public top bar */}
      <div className="m-pubbar">
        <img className="logo" src="assets/sokrat-logo.png" alt="" />
        <div className="pb-t">
          <div className="nm">Сократ AI</div>
          <div className="sub">Отчёт родителю · {period.range}</div>
        </div>
        <span className="conf"><R name="check-circle" /> подтверждённое</span>
      </div>

      {/* ABOVE THE FOLD: result */}
      <div className="m-hero">
        <div className="who">{t.grade} · {t.subject}</div>
        <h1>{t.student}</h1>
        <div className="tutor">Репетитор: {t.tutor}</div>

        <div className="m-bigstats">
          <div className="m-bs cur">
            <div className="l"><R name="trophy" size={13} /> {t.curLabel}</div>
            <div className="v">{isMark ? fmtMark(t.current) : t.current}<span className="u"> {t.curUnit}</span></div>
            <div className="s">цель {t.goalTarget}</div>
          </div>
          <div className="m-bs fc">
            <div className="l"><R name="target" size={13} /> {t.forecastLabel}</div>
            <div className="v">{fc}</div>
            <div className="s">по темпу</div>
          </div>
        </div>

        <div className="m-trend">
          <div className="th">
            <span className="t">Динамика {isMark ? 'оценки' : 'балла'}</span>
            <span className={'d ' + (delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat')}>{delta > 0 ? '+' : ''}{fmtMark(delta)} {periodWord}</span>
          </div>
          <MTrend trend={t.trend} />
        </div>
      </div>

      {/* period */}
      <div className="m-period" role="group" aria-label="Период">
        {Object.values(window.RPT.PERIODS).map(p => (
          <button key={p.id} className={period.id === p.id ? 'on' : ''} onClick={() => window.__setPeriod(p.id)}>{p.label}</button>
        ))}
      </div>

      {/* topic map → vertical */}
      <div className="m-block">
        <div className="m-sec">Карта тем <span className="h">статус освоения</span></div>
        <div className="m-zones">
          {[['green', 'Освоено', t.zones.green], ['yellow', 'В работе', t.zones.yellow], ['red', 'Требует внимания', t.zones.red]].map(([cls, ttl, list]) => (
            <div className={'m-zone ' + cls} key={cls}>
              <div className="zhead">
                <span className="zdot"></span>
                <span className="zttl">{ttl}</span>
                <span className="zcount">{list.length} {list.length === 1 ? 'тема' : 'темы'}</span>
              </div>
              <div className="ztopics">{list.map((z, i) => <span className="tp" key={i}>{z}</span>)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* recent works */}
      <div className="m-block">
        <div className="m-sec">Последние работы <span className="h">{periodWord}</span></div>
        <div className="m-recent">
          {t.recent.map((r, i) => (
            <div className="m-ri" key={i}>
              <div className="rt"><div className="t">{r.title}</div><div className="s">{r.sub}</div></div>
              {r.confirmed
                ? <span className={'pct ' + pctCls(r.pct)}>{r.markNote ? r.markNote : r.pct + '%'}</span>
                : <span className="pend">{r.status}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* comment */}
      <div className="m-block">
        <div className="m-comment">
          <div className="ch"><R name="square-pen" /> Комментарий репетитора</div>
          <div className="ct">{comment}</div>
          <div className="by">— {t.tutor}</div>
        </div>
      </div>

      {/* footer */}
      <div className="m-foot">
        <div className="leak"><R name="shield-check" /> Без решений, рубрик и AI-вердиктов — только итоги</div>
        <div className="site">sokratai.ru</div>
      </div>
    </React.Fragment>
  );
}

/* expired-link screen (NOT a 404) */
function ExpiredScreen({ track }) {
  return (
    <div className="m-expired">
      <div className="ill"><R name="clock-x" size={30} /></div>
      <h2>Срок ссылки истёк</h2>
      <p>Эта ссылка на отчёт больше не активна. Репетитор может прислать свежую — данные никуда не делись.</p>
      <div className="who2">
        <span className="av">{track.initials}</span>
        <span>Отчёт по ученику: <b style={{ color: 'var(--fg2)' }}>{track.student}</b></span>
      </div>
      <button className="cta"><R name="send" size={17} /> Запросить новую ссылку</button>
      <div className="leak"><R name="shield-check" /> Доступ к отчёту всегда по актуальной ссылке от репетитора</div>
    </div>
  );
}

function AppMobile() {
  const { TRACKS, PERIODS } = window.RPT;
  const [trackKey, setTrackKey] = React.useState('ege');
  const [periodKey, setPeriodKey] = React.useState('month');
  const [screen, setScreen] = React.useState('report'); // report | expired
  const [webview, setWebview] = React.useState(true);    // simulate in-app WebView
  const [toast, setToast] = React.useState(null);
  const tr = React.useRef(0);
  const t = TRACKS[trackKey];
  const period = PERIODS[periodKey];
  const comment = t.comment;

  React.useEffect(() => { window.__setPeriod = setPeriodKey; }, []);
  const flash = (m) => { setToast(m); clearTimeout(tr.current); tr.current = setTimeout(() => setToast(null), 2200); };

  const pubUrl = 'sokratai.ru/p/' + t.slug;
  const copyText = () => {
    const L = [];
    L.push(`Отчёт: ${t.student}, ${t.grade} — ${t.subject}`);
    L.push(`Период: ${period.range}`);
    L.push(`${t.curLabel}: ${t.unit === 'mark' ? t.current : t.current} ${t.curUnit} · ${t.forecastLabel}: ${window.RPT.forecastText(t)}`);
    L.push(`Освоено: ${t.zones.green.join(', ')}`);
    L.push(`Требует внимания: ${t.zones.red.join(', ')}`);
    L.push(`Комментарий (${t.tutor}): ${comment}`);
    L.push(`Полный отчёт: ${pubUrl}`);
    const text = L.join('\n');
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => flash('Текст отчёта скопирован'), () => flash('Текст готов'));
    else flash('Текст готов');
  };
  const tryPdf = () => {
    if (webview) flash('В этом приложении скачивание недоступно — откройте в браузере');
    else { flash('Открываю PDF…'); try { window.print(); } catch (e) {} }
  };

  return (
    <React.Fragment>
      {/* canvas-only harness controls (not part of the phone) */}
      <div className="cv-top">
        <div className="lede">
          <h1>Отчёт родителю · мобайл /p/:slug</h1>
          <div className="path">in-app WebView (Telegram/VK) · above-the-fold = результат · ссылка истекает</div>
        </div>
        <div className="v2-switch">
          <span className="sl">Экран:</span>
          <div className="cv-jump">
            <button className={screen === 'report' ? 'active' : ''} onClick={() => setScreen('report')}><span className="k">Отчёт</span></button>
            <button className={screen === 'expired' ? 'active' : ''} onClick={() => setScreen('expired')}><span className="k">Срок истёк</span></button>
          </div>
          <span className="sl" style={{ marginLeft: 8 }}>Окружение:</span>
          <div className="cv-jump">
            <button className={webview ? 'active' : ''} onClick={() => setWebview(true)}><span className="k">In-app</span></button>
            <button className={!webview ? 'active' : ''} onClick={() => setWebview(false)}><span className="k">Браузер</span></button>
          </div>
          <span className="sl" style={{ marginLeft: 8 }}>Трек:</span>
          <div className="cv-jump">
            {[['ege', 'ЕГЭ'], ['oge', 'ОГЭ'], ['school', 'Школа']].map(([k, l]) => (
              <button key={k} className={trackKey === k ? 'active' : ''} onClick={() => setTrackKey(k)}><span className="k">{l}</span></button>
            ))}
          </div>
        </div>
      </div>

      <div className="m-stage">
        <IOSDevice width={390} height={844}>
          <div className="rpt--m">
            {screen === 'expired' ? (
              <ExpiredScreen track={t} />
            ) : (
              <React.Fragment>
                <div className="m-scroll">
                  <ReportMobile key={trackKey + periodKey} track={t} period={period} comment={comment} />
                  {/* sticky actions */}
                  <div className="m-actions">
                    <div className="row">
                      <button className="mbtn" onClick={copyText}><R name="copy" size={17} /> Скопировать текст</button>
                      <button className="mbtn primary" onClick={tryPdf}><R name="download" size={17} /> PDF / картинка</button>
                    </div>
                    {webview && (
                      <div className="wv-hint">
                        <R name="external-link" size={13} /> Скачивание в этом приложении ограничено — <a href="#">открыть в браузере</a>
                      </div>
                    )}
                  </div>
                </div>
                {toast && <div className="m-toast"><R name="check-circle" size={15} /> {toast}</div>}
              </React.Fragment>
            )}
          </div>
        </IOSDevice>
      </div>
    </React.Fragment>
  );
}

/* extra icons used here (extend the report icon set) */
ReactDOM.createRoot(document.getElementById('root')).render(<AppMobile />);
