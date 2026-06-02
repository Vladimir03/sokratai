/* hero v2 — state hook + shell + track switcher (→ window) */

function useHero2(profile) {
  const init = () => ({
    works: profile.works.map(w => ({ ...w, tasks: w.tasks ? w.tasks.map(t => ({ ...t })) : undefined })),
    target: profile.goal.target,
  });
  const [works, setWorks] = React.useState(init().works);
  const [target, setTarget] = React.useState(profile.goal.target);
  const [toast, setToast] = React.useState(null);
  const tref = React.useRef(0);
  const flash = (t) => { setToast(t); clearTimeout(tref.current); tref.current = setTimeout(() => setToast(null), 2200); };

  const verifyTasks = (w) => ({ ...w, tasks: w.tasks.map(t => (t.ai !== null ? { ...t, verified: true } : t)) });

  const confirmWork = (id) => {
    setWorks(ws => ws.map(w => {
      if (w.id !== id) return w;
      if (w.holistic) return { ...w, verified: true };
      return verifyTasks(w);
    }));
    flash('Работа подтверждена');
  };
  const reopenWork = (id) => {
    setWorks(ws => ws.map(w => {
      if (w.id !== id) return w;
      if (w.holistic) return { ...w, verified: false };
      return { ...w, tasks: w.tasks.map(t => ({ ...t, verified: false })) };
    }));
    flash('Работа открыта обратно');
  };
  const bulkConfirm = () => {
    setWorks(ws => ws.map(w => (w.notSubmitted || w.noAi || w.holistic) ? w : verifyTasks(w)));
    flash('Подтверждено всё, что проверил AI');
  };
  const saveScore = (id, val, close) => {
    setWorks(ws => ws.map(w => {
      if (w.id !== id) return w;
      const next = { ...w, raw: val };
      if (close) {
        if (w.holistic) next.verified = true;
        else next.tasks = w.tasks.map(t => ({ ...t, verified: true, override: t.ai === null ? (t.override ?? t.max) : t.override }));
      }
      return next;
    }));
    flash(close ? 'Сохранено и подтверждено' : 'Сохранено');
  };

  const goal = { ...profile.goal, target };
  return { works, goal, setTarget, confirmWork, reopenWork, bulkConfirm, saveScore, toast };
}

function HeroShell2({ profile, mobile, state = 'ready', onRetry, onAssign }) {
  const hero = useHero2(profile);
  const [editing, setEditing] = React.useState(null);
  const [report, setReport] = React.useState(false);
  const liveProfile = { ...profile, goal: hero.goal };
  const bulkN = window.HERO2.bulkCount(hero.works);
  const ctx = { works: hero.works, confirm: hero.confirmWork, reopen: hero.reopenWork, openEdit: (w) => setEditing(w) };

  let body;
  if (state === 'loading') body = <SkeletonState />;
  else if (state === 'empty') body = <EmptyState onAssign={onAssign} />;
  else if (state === 'error') body = <ErrorState onRetry={onRetry} />;
  else body = (
    <React.Fragment>
      <Summary2 profile={liveProfile} works={hero.works} bulkN={bulkN} onBulk={hero.bulkConfirm} onTarget={hero.setTarget} />
      <VadimNote2 />
      <HeroCards ctx={ctx} />
    </React.Fragment>
  );

  const head = (
    <React.Fragment>
      <Chrome2 profile={liveProfile} onReport={() => state === 'ready' && setReport(r => !r)} />
      {body}
    </React.Fragment>
  );

  return (
    <div className={'app' + (mobile ? ' app--m' : '')} onMouseDown={() => report && setReport(false)}>
      {mobile ? <div className="m-scroll">{head}</div> : head}

      {report && <ReportPopover2 profile={liveProfile} />}
      {editing && (
        <EditScoreModal2 work={editing} onClose={() => setEditing(null)}
          onSave={(val, close) => { hero.saveScore(editing.id, val, close); setEditing(null); }} />
      )}
      {hero.toast && <Toast2 text={hero.toast} />}
    </div>
  );
}

function AppRoot() {
  const P = window.HERO2.PROFILES;
  const initial = (() => {
    const t = new URLSearchParams(location.search).get('track');
    return P[t] ? t : 'ege';
  })();
  const [key, setKey] = React.useState(initial);
  const tabs = [
    { k: 'ege', label: 'ЕГЭ', sub: 'Маша · 11 кл' },
    { k: 'oge', label: 'ОГЭ', sub: 'Костя · 9 кл' },
    { k: 'school', label: 'Школа', sub: 'Аня · 8 кл' },
  ];
  return (
    <React.Fragment>
      <div className="cv-top">
        <div className="lede">
          <h1>Страница ученика → вкладка «Прогресс» · hero v2</h1>
          <div className="path"><code>/tutor/students/:id</code> · родные шкалы по треку · цвет клетки = % от макс</div>
        </div>
        <div className="v2-switch">
          <span className="sl">Превью трека:</span>
          <div className="cv-jump">
            {tabs.map(t => (
              <button key={t.k} className={t.k === key ? 'active' : ''} onClick={() => setKey(t.k)}>
                <span className="k">{t.label}</span><span className="sub">{t.sub}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="v2-stage">
        <div className="v2-frame">
          <HeroShell2 key={key} profile={P[key]} />
        </div>
      </div>
    </React.Fragment>
  );
}

Object.assign(window, { AppRoot, HeroShell2, useHero2 });
if (window.SokratFlow) window.SokratFlow.mark('hero');
