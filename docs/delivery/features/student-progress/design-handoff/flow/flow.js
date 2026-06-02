/* ============================================================
   SokratAI · Happy-path flow (Elena's scenario) — plain JS, no React.
   Активна только при ?flow=1. Рисует нижнюю плавающую ленту-навигатор
   и связывает 4 экрана:
     Успеваемость → Прогресс ученика → Проверка работы → Отчёт родителю
   Каждый экран зовёт SokratFlow.mark('<step>') после маунта.
   ============================================================ */
(function () {
  const params = new URLSearchParams(location.search);
  const active = params.get('flow') === '1';

  const STEPS = [
    { key: 'usp',    label: 'Успеваемость', file: 'Успеваемость - кросс-ученический список.html', defaults: {} },
    { key: 'hero',   label: 'Прогресс',     file: 'Прогресс ученика - hero v2.html',              defaults: { track: 'ege' } },
    { key: 'review', label: 'Проверка',     file: 'Проверка работы - галочка-паритет.html',       defaults: { work: 'law' } },
    { key: 'report', label: 'Отчёт',        file: 'Отчёт родителю - publ p-slug.html',            defaults: { track: 'ege' } },
  ];

  function buildURL(file, extra) {
    const u = new URLSearchParams();
    u.set('flow', '1');
    Object.entries(extra || {}).forEach(([k, v]) => { if (v != null) u.set(k, v); });
    return file + '?' + u.toString();
  }
  function nav(file, extra) { location.href = buildURL(file, extra); }
  function navStep(key, extra) {
    const s = STEPS.find(x => x.key === key); if (!s) return;
    nav(s.file, Object.assign({}, s.defaults, extra));
  }

  let current = null;
  function render() {
    if (!active) return;
    let bar = document.getElementById('sokrat-flowbar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'sokrat-flowbar';
      document.body.appendChild(bar);
      injectCSS();
    }
    const idx = STEPS.findIndex(s => s.key === current);
    bar.innerHTML =
      '<button class="fb-back" title="Назад">' + svg('m15 18-6-6 6-6') + '</button>' +
      '<div class="fb-rail">' +
      STEPS.map((s, i) => {
        const state = i < idx ? 'done' : i === idx ? 'cur' : 'next';
        return '<button class="fb-step ' + state + '" data-k="' + s.key + '">' +
          '<span class="fb-dot">' + (i < idx ? svg('M20 6 9 17l-5-5', 11) : (i + 1)) + '</span>' +
          '<span class="fb-lab">' + s.label + '</span>' +
        '</button>' + (i < STEPS.length - 1 ? '<span class="fb-sep">' + svg('m9 18 6-6-6-6', 12) + '</span>' : '');
      }).join('') +
      '</div>' +
      '<span class="fb-tag">демо-поток</span>';

    bar.querySelector('.fb-back').onclick = () => history.back();
    bar.querySelectorAll('.fb-step').forEach(b => {
      b.onclick = () => { if (b.dataset.k !== current) navStep(b.dataset.k); };
    });
  }

  function svg(d, size) {
    size = size || 14;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>';
  }

  function injectCSS() {
    const css = `
    #sokrat-flowbar{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:9000;
      display:flex;align-items:center;gap:10px;padding:7px 10px 7px 7px;
      background:rgba(15,23,42,0.94);backdrop-filter:blur(10px);border-radius:14px;
      box-shadow:0 10px 34px rgba(0,0,0,.28);font-family:'Golos Text',system-ui,sans-serif;
      animation:fbin .25s cubic-bezier(.2,.7,.3,1) both;}
    @keyframes fbin{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
    #sokrat-flowbar .fb-back{width:34px;height:34px;border-radius:9px;border:0;background:rgba(255,255,255,0.1);
      color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex:0 0 auto;}
    #sokrat-flowbar .fb-back:hover{background:rgba(255,255,255,0.18);}
    #sokrat-flowbar .fb-rail{display:flex;align-items:center;gap:2px;}
    #sokrat-flowbar .fb-step{display:flex;align-items:center;gap:7px;padding:5px 9px;border:0;background:transparent;
      border-radius:9px;cursor:pointer;color:rgba(255,255,255,0.55);font:inherit;font-size:13px;font-weight:600;}
    #sokrat-flowbar .fb-step:hover{background:rgba(255,255,255,0.08);color:#fff;}
    #sokrat-flowbar .fb-step.cur{color:#fff;background:rgba(255,255,255,0.12);cursor:default;}
    #sokrat-flowbar .fb-step.done{color:rgba(167,216,190,0.95);}
    #sokrat-flowbar .fb-dot{width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;
      font-size:11px;font-weight:700;flex:0 0 auto;border:1.5px solid currentColor;}
    #sokrat-flowbar .fb-step.cur .fb-dot{background:#1B6B4A;border-color:#1B6B4A;color:#fff;}
    #sokrat-flowbar .fb-step.done .fb-dot{background:rgba(167,216,190,0.18);}
    #sokrat-flowbar .fb-lab{white-space:nowrap;}
    #sokrat-flowbar .fb-sep{color:rgba(255,255,255,0.28);display:flex;align-items:center;}
    #sokrat-flowbar .fb-tag{font-size:10px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;
      color:rgba(255,255,255,0.45);padding-right:4px;border-left:1px solid rgba(255,255,255,0.14);padding-left:10px;}
    @media (max-width:560px){#sokrat-flowbar .fb-lab{display:none}#sokrat-flowbar .fb-tag{display:none}}
    `;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  }

  window.SokratFlow = {
    active,
    param: (k) => params.get(k),
    nav, navStep,
    mark(step) { current = step; if (active) (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', render) : render()); },
    // navigate to a step only if we're in flow mode; else run fallback
    go(step, extra, fallback) { if (active) navStep(step, extra); else if (fallback) fallback(); },
  };
})();
