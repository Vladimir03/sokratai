/* hero v2 — mobile review harness: iOS 390px frame + state & track switchers */

function AppRootMobile() {
  const P = window.HERO2.PROFILES;
  const [track, setTrack] = React.useState('ege');
  const [state, setState] = React.useState('ready');

  const tracks = [
    { k: 'ege', label: 'ЕГЭ', sub: 'Маша' },
    { k: 'oge', label: 'ОГЭ', sub: 'Костя' },
    { k: 'school', label: 'Школа', sub: 'Аня' },
  ];
  const states = [
    { k: 'ready', label: 'Норма' },
    { k: 'empty', label: 'Пустой' },
    { k: 'loading', label: 'Загрузка' },
    { k: 'error', label: 'Ошибка' },
  ];

  return (
    <React.Fragment>
      <div className="cv-top">
        <div className="lede">
          <h1>Прогресс ученика · мобайл 390px + состояния</h1>
          <div className="path">iOS Safari · инпуты ≥16px · цели ≥44px</div>
        </div>
        <div className="v2-switch">
          <span className="sl">Состояние:</span>
          <div className="cv-jump">
            {states.map(s => (
              <button key={s.k} className={s.k === state ? 'active' : ''} onClick={() => setState(s.k)}>
                <span className="k">{s.label}</span>
              </button>
            ))}
          </div>
          <span className="sl" style={{ marginLeft: 8 }}>Трек:</span>
          <div className="cv-jump">
            {tracks.map(t => (
              <button key={t.k} className={t.k === track ? 'active' : ''} onClick={() => setTrack(t.k)}>
                <span className="k">{t.label}</span><span className="sub">{t.sub}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="m-stage">
        <IOSDevice width={390} height={844}>
          <HeroShell2
            key={track}
            profile={P[track]}
            mobile
            state={state}
            onRetry={() => setState('ready')}
            onAssign={() => setState('ready')}
          />
        </IOSDevice>
      </div>
    </React.Fragment>
  );
}

window.AppRootMobile = AppRootMobile;
