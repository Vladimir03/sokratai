/* hero v2 — cards body (anchored hero). Native units + exam chips. */
function HeroCards({ ctx }) {
  const { works, confirm, reopen, openEdit } = ctx;
  const H = window.HERO2;
  const [open, setOpen] = React.useState({});
  const toggle = (id) => setOpen(o => ({ ...o, [id]: !o[id] }));
  const hasDetail = (w) => !w.holistic; // holistic (оценка/устный) has nothing to expand
  // flow: map a hero work → the Review screen's workId
  const REVIEW_MAP = { 'Законы сохранения': 'law', 'Пробник ЕГЭ — вариант 7': 'mock', 'Графическая задача (фото-решение)': 'noai' };
  const flow = window.SokratFlow && window.SokratFlow.active;
  const openReview = (w) => window.SokratFlow.navStep('review', { work: REVIEW_MAP[w.title] || 'law' });

  return (
    <div className="work-list">
      {works.map(w => {
        const st = H.workState(w);
        const isOpen = !!open[w.id];
        const attention = st.kind === 'review' || st.kind === 'manual';
        const showHeat = !w.holistic && !w.notSubmitted;
        return (
          <div key={w.id} className={'work' + (isOpen ? ' open' : '') + (w.kind === 'manual' ? ' manual' : '') + (st.kind === 'verified' ? ' checked' : '') + (attention ? ' attention' : '')}>
            <div className="work-main" onClick={() => hasDetail(w) && toggle(w.id)} style={hasDetail(w) ? {} : { cursor: 'default' }}>
              <div className="work-ico"><Icon2 name={KIND_ICON2[w.kind]} /></div>
              <div className="work-info">
                <div className="wt">
                  <span className="name">{w.title}</span>
                  <span className="work-kind">{KIND_LABEL[w.kind]}</span>
                </div>
                <div className="wm">
                  <span>{w.date}</span>
                  <span className="dot-sep">·</span>
                  <span className={'due' + (w.overdue ? ' overdue' : '')}>{w.due}</span>
                  <span className="dot-sep">·</span>
                  <ExamChip exam={w.exam} />
                </div>
                {showHeat && (
                  <div className="heatrow">
                    {w.tasks.map((t, i) => {
                      const sc = H.taskScore(t);
                      const cls = H.cellClass(sc, t.max);
                      const pending = t.ai !== null && !t.verified;
                      return <span key={i} className={'heat heat--' + cls + (pending ? ' heat--pending' : '')} title={(w.kimLabels ? 'KIM ' : 'Задача ') + (i + 1)}>{H.cellText(sc)}</span>;
                    })}
                  </div>
                )}
              </div>
              <div className="work-right" onClick={(e) => e.stopPropagation()}>
                <ScoreRollup work={w} big />
                <StatusBadge2 state={st} />
                <div className="controls">
                  {flow && (st.kind === 'review' || st.kind === 'manual') && REVIEW_MAP[w.title]
                    ? <button className="btn btn--sm btn--confirm" onClick={() => openReview(w)}>Открыть проверку <Icon2 name="arrow-right" size={14} className="ico" /></button>
                    : <ConfirmCluster2 state={st}
                        onConfirm={() => confirm(w.id)} onEdit={() => openEdit(w)} onReopen={() => reopen(w.id)} />}
                  {hasDetail(w) && <Icon2 name="chevron-right" size={18} className="chev" />}
                </div>
              </div>
            </div>

            {hasDetail(w) && (
              <div className="work-detail">
                {w.notSubmitted ? (
                  <div style={{ fontSize: 13, color: 'var(--fg3)' }}>Ученик ещё не сдал работу. {w.due[0].toUpperCase() + w.due.slice(1)}.</div>
                ) : (
                  <React.Fragment>
                    <div className="task-cards">
                      {w.tasks.map((t, i) => {
                        const sc = H.taskScore(t);
                        const cls = H.cellClass(sc, t.max);
                        return (
                          <div key={i} className={'tcard' + (t.verified ? ' verified' : '')}>
                            <div className="th">
                              <span className="tn">{w.kimLabels ? 'KIM ' + (i + 1) : 'Задача ' + (i + 1)}</span>
                              <span className={'ts ' + cls}>{H.cellText(sc)}<span style={{ fontWeight: 500, color: 'var(--fg-muted)', fontSize: 11 }}> /{t.max}</span></span>
                            </div>
                            <div className="tmeta">
                              {t.ai === null
                                ? <span><Icon2 name="square-pen" size={12} style={{ display: 'inline', verticalAlign: '-2px' }} /> нет AI-вердикта</span>
                                : t.verified
                                  ? <span style={{ color: 'var(--s-success-fg)' }}><Icon2 name="badge-check" size={12} style={{ display: 'inline', verticalAlign: '-2px' }} /> подтверждено</span>
                                  : <span style={{ color: 'var(--s-warn-fg)' }}><Icon2 name="clock" size={12} style={{ display: 'inline', verticalAlign: '-2px' }} /> AI: {H.fmt(t.ai)} — на проверке</span>}
                            </div>
                            {!t.verified && <div className="tedit"><button className="btn btn--sm" onClick={() => openEdit(w)}>Изменить балл</button></div>}
                          </div>
                        );
                      })}
                    </div>
                    <div className="detail-foot">
                      <div className="prog">
                        <div className="lbl"><span>Проверено задач</span><span>{w.tasks.filter(t => t.verified).length} / {w.tasks.length}</span></div>
                        <div className="bar"><span style={{ width: (100 * w.tasks.filter(t => t.verified).length / w.tasks.length) + '%' }}></span></div>
                      </div>
                      {st.kind === 'review' && <button className="btn btn--confirm btn--sm" onClick={() => confirm(w.id)}><Icon2 name="badge-check" size={15} className="ico" /> Подтвердить работу ({st.n})</button>}
                      {st.kind === 'manual' && <button className="btn btn--confirm btn--sm" onClick={() => openEdit(w)}><Icon2 name="badge-check" size={15} className="ico" /> Поставить балл и подтвердить</button>}
                    </div>
                  </React.Fragment>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
window.HeroCards = HeroCards;
