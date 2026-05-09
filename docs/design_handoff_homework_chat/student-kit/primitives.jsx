/* global React */
// Student kit — primitives
// All classes live in tokens.css; this file wires behavior + KaTeX + Lucide.

const { useState, useEffect, useMemo, useRef } = React;

// ─── Icon (lucide) ─────────────────────────────────────────
function SIcon({ name, size = 20, strokeWidth = 1.75, style }) {
  const ref = useRef(null);
  useEffect(() => {
    if (window.lucide && ref.current) {
      ref.current.innerHTML = "";
      const ic = window.lucide.icons[toPascal(name)] || window.lucide.icons.Circle;
      const svg = window.lucide.createElement(ic);
      svg.setAttribute("width", size);
      svg.setAttribute("height", size);
      svg.setAttribute("stroke-width", strokeWidth);
      ref.current.appendChild(svg);
    }
  }, [name, size, strokeWidth]);
  return <span ref={ref} aria-hidden="true" style={{ display: "inline-flex", ...style }} />;
}
function toPascal(s){ return s.split("-").map(w=>w[0].toUpperCase()+w.slice(1)).join(""); }

// ─── Button ────────────────────────────────────────────────
function SButton({ variant = "outline", size = "md", icon, iconRight, iconOnly, block, learning, children, ...rest }) {
  const cls = [
    "s-btn",
    `s-btn--${variant}`,
    iconOnly ? "s-btn--icon" : `s-btn--${size}`,
    block ? "s-btn--block" : "",
  ].filter(Boolean).join(" ");
  const learnAttr = learning ? { "data-learning-cta": "" } : {};
  return (
    <button className={cls} {...learnAttr} {...rest}>
      {icon && <SIcon name={icon} />}
      {!iconOnly && children}
      {iconRight && <SIcon name={iconRight} />}
    </button>
  );
}

// ─── Chip ──────────────────────────────────────────────────
function SChip({ variant = "neutral", icon, children, ...rest }) {
  return (
    <span className={`s-chip s-chip--${variant}`} {...rest}>
      {icon && <SIcon name={icon} size={13} strokeWidth={2} />}
      {children}
    </span>
  );
}

// ─── StreakBadge / StreakCard ──────────────────────────────
function StreakBadge({ days, onDark, lost }) {
  const cls = ["s-streak", onDark && "s-streak--on-dark", lost && "s-streak--lost"].filter(Boolean).join(" ");
  return (
    <span className={cls} aria-label={`${days} дней подряд`}>
      <SIcon name="flame" size={16} strokeWidth={2} />
      {days}
    </span>
  );
}
function StreakCard({ days = 7, week }) {
  // week: array of {label, on, today}
  const defaultWeek = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"].map((l,i)=>({ label: l, on: i < 5, today: i === 4 }));
  const weekData = week || defaultWeek;
  return (
    <div className="s-streakcard">
      <div className="s-streakcard__flame"><SIcon name="flame" size={24} strokeWidth={2} /></div>
      <div>
        <div className="s-streakcard__count">{days}</div>
        <div className="s-streakcard__label">{pluralize(days, "день", "дня", "дней")} подряд</div>
      </div>
      <div className="s-streakcard__days">
        {weekData.map((d,i)=>(
          <div key={i} className={"s-streakday" + (d.on?" s-streakday--on":"") + (d.today?" s-streakday--today":"")}>{d.label[0]}</div>
        ))}
      </div>
    </div>
  );
}
function pluralize(n, one, few, many){
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// ─── DailyGoal (ring + label) ──────────────────────────────
function DailyGoal({ value = 0, max = 100, label = "Цель дня", detail, onDark, size = 64 }) {
  const r = (size - 7) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / max));
  const off = c * (1 - pct);
  return (
    <div className={"s-dailygoal" + (onDark?" s-dailygoal--on-dark":"")}>
      <div className={"s-ring" + (onDark?" s-ring--on-dark":"")} style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`}>
          <circle className="s-ring__track" cx={size/2} cy={size/2} r={r} />
          <circle className="s-ring__fill" cx={size/2} cy={size/2} r={r}
            strokeDasharray={c} strokeDashoffset={off} />
        </svg>
        <div className="s-ring__label">{Math.round(pct*100)}%</div>
      </div>
      <div className="s-dailygoal__body">
        <div className="s-dailygoal__label">{label}</div>
        <div className="s-dailygoal__value">{detail || `${value} / ${max} XP`}</div>
      </div>
    </div>
  );
}

// ─── Mastery ───────────────────────────────────────────────
function Mastery({ topic, level = 3, subtitle }) {
  const labels = ["Знакомство","Слабо","Средне","Уверенно","Мастер"];
  return (
    <div className={`s-mastery s-mastery--${level}`} aria-label={`${topic}: уровень ${level} из 5`}>
      <div className="s-mastery__row">
        <span className="s-mastery__topic">{topic}</span>
        <span className="s-mastery__label">{labels[level-1]}</span>
      </div>
      <div className="s-mastery__bar">
        {[1,2,3,4,5].map(i => <span key={i} className={"s-mastery__seg" + (i<=level?" s-mastery__seg--on":"")} />)}
      </div>
      {subtitle && <div className="s-card__meta">{subtitle}</div>}
    </div>
  );
}

// ─── Progress (labeled) ────────────────────────────────────
function SProgress({ value = 0, max = 100, label, suffix, accent, onDark }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={"s-progress" + (accent?" s-progress--accent":"") + (onDark?" s-progress--on-dark":"")}>
      <div className="s-progress__row">
        <span>{label}</span>
        <span className="s-progress__row--tabular">{suffix ?? `${value} / ${max}`}</span>
      </div>
      <div className="s-progress__track"><div className="s-progress__fill" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

// ─── InlineMath / FormulaBlock (student) ──────────────────
function SInlineMath({ tex }) {
  const ref = useRef(null);
  useEffect(() => {
    if (window.katex && ref.current) {
      try { window.katex.render(tex, ref.current, { throwOnError: false, displayMode: false }); }
      catch { ref.current.textContent = tex; }
    }
  }, [tex]);
  return <span className="s-formula-inline" ref={ref}>{tex}</span>;
}
function SFormulaBlock({ tex, hero }) {
  const ref = useRef(null);
  useEffect(() => {
    if (window.katex && ref.current) {
      try { window.katex.render(tex, ref.current, { throwOnError: false, displayMode: true }); }
      catch { ref.current.textContent = tex; }
    }
  }, [tex]);
  return <div className={"s-formula-block" + (hero?" s-formula-block--hero":"")} ref={ref}>{tex}</div>;
}

// ─── AnswerInput (numeric / text) ─────────────────────────
function SAnswerInput({ value, placeholder = "Ваш ответ", unit, state, onChange, ...rest }) {
  const stateCls = state ? ` s-answer--${state}` : "";
  return (
    <label className={"s-answer" + stateCls}>
      <input
        value={value ?? ""}
        placeholder={placeholder}
        onChange={e => onChange && onChange(e.target.value)}
        inputMode="decimal"
        {...rest}
      />
      {unit && <span className="s-answer__unit">{unit}</span>}
    </label>
  );
}

// ─── MCQ ──────────────────────────────────────────────────
function MCQ({ options, value, revealState, onChange }) {
  return (
    <div className="s-mcq" role="radiogroup">
      {options.map((opt, i) => {
        const letter = String.fromCharCode(0x0410 + i); // А, Б, В...
        const selected = value === opt.value;
        const dataState = revealState && opt.correct ? "correct"
          : (revealState && selected && !opt.correct) ? "incorrect"
          : undefined;
        return (
          <button key={opt.value}
            className="s-mcq__opt"
            role="radio"
            aria-pressed={selected}
            data-state={dataState}
            onClick={() => !revealState && onChange && onChange(opt.value)}
          >
            <span className="s-mcq__letter">{letter}</span>
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Hint ladder ──────────────────────────────────────────
function HintLadder({ hints, revealed = 1, onReveal }) {
  // hints: array of strings
  return (
    <div className="s-hints">
      {hints.slice(0, revealed).map((h, i) => (
        <div key={i} className="s-hint">
          <span className="s-hint__step">{i + 1}</span>
          <div className="s-hint__body">
            <div className="s-hint__kicker">{i === 0 ? "Подсказка" : `Подсказка ${i + 1}`}</div>
            {h}
          </div>
        </div>
      ))}
      {revealed < hints.length && (
        <button className="s-hint--reveal-button" onClick={onReveal} data-learning-cta>
          <SIcon name="lightbulb" size={18} strokeWidth={2} />
          Открыть следующую подсказку
          <span style={{marginLeft:"auto", fontWeight:500, color:"var(--sokrat-fg3)"}}>{revealed}/{hints.length}</span>
        </button>
      )}
    </div>
  );
}

// ─── Step-by-step reasoning ───────────────────────────────
function StepBlock({ steps, current = 0 }) {
  // steps: [{ title, body (string or JSX) }]
  return (
    <div className="s-steps">
      {steps.map((s, i) => (
        <div key={i} className={"s-step" + (i < current ? "" : (i === current ? " s-step--active" : " s-step--pending"))}>
          <div className="s-step__head">
            <span className="s-step__num">{i + 1}</span>
            <span className="s-step__title">{s.title}</span>
          </div>
          {s.body && (i === current || i < current) && <div className="s-step__body">{s.body}</div>}
        </div>
      ))}
    </div>
  );
}

// ─── AI feedback card ─────────────────────────────────────
function AIFeedback({ state = "socratic", title, children, actions }) {
  return (
    <div className={`s-aicard s-aicard--${state}`} role="status">
      <div className="s-aicard__head">
        <SIcon name={{
          correct: "check-circle",
          partial: "alert-circle",
          incorrect: "x-circle",
          socratic: "sparkles",
        }[state] || "message-circle"} size={18} strokeWidth={2} />
        <div className="s-aicard__title">{title}</div>
      </div>
      {children && <div className="s-aicard__body">{children}</div>}
      {actions && <div className="s-aicard__cta">{actions}</div>}
    </div>
  );
}

Object.assign(window, {
  SIcon, SButton, SChip,
  StreakBadge, StreakCard, DailyGoal, Mastery, SProgress,
  SInlineMath, SFormulaBlock, SAnswerInput, MCQ,
  HintLadder, StepBlock, AIFeedback,
  pluralize,
});
