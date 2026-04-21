/* global React */
// Tutor kit — primitives
// All classes defined in tokens.css; this file wires behavior + platform-aware KbdHint.

const { useState, useEffect, useMemo, useRef } = React;

// ─── Icon (lucide via CDN; expects window.lucide) ───
function Icon({ name, size = 16, strokeWidth = 1.75, style }) {
  const ref = useRef(null);
  useEffect(() => {
    if (window.lucide && ref.current) {
      ref.current.innerHTML = "";
      const svg = window.lucide.createElement(window.lucide.icons[toPascal(name)] || window.lucide.icons.Circle);
      svg.setAttribute("width", size);
      svg.setAttribute("height", size);
      svg.setAttribute("stroke-width", strokeWidth);
      ref.current.appendChild(svg);
    }
  }, [name, size, strokeWidth]);
  return <span ref={ref} aria-hidden="true" style={{ display: "inline-flex", ...style }} />;
}
function toPascal(s){ return s.split("-").map(w=>w[0].toUpperCase()+w.slice(1)).join(""); }

// ─── Button ───
function Button({ variant = "outline", size = "md", icon, iconOnly, children, ...rest }) {
  const cls = [
    "t-btn",
    `t-btn--${variant}`,
    iconOnly ? (size === "md" ? "t-btn--icon-sm" : "t-btn--icon") : `t-btn--${size}`,
  ].join(" ");
  return (
    <button className={cls} {...rest}>
      {icon && <Icon name={icon} />}
      {!iconOnly && children}
    </button>
  );
}

// ─── Field / Input ───
function Field({ label, caption, error, children, style }) {
  return (
    <label className="t-field" style={style}>
      {label && <span className="t-field__label">{label}</span>}
      {children}
      {(caption || error) && (
        <span className={"t-field__caption" + (error ? " t-field__caption--error" : "")}>
          {error || caption}
        </span>
      )}
    </label>
  );
}
function Input({ prefix, suffix, error, ...rest }) {
  return (
    <span className={"t-field__control" + (error ? " t-field__control--error" : "")}>
      {prefix}
      <input className="t-field__input" {...rest} />
      {suffix && <span className="t-field__suffix">{suffix}</span>}
    </span>
  );
}

// ─── Chip ───
function Chip({ variant = "neutral", children, pressed, onClick, ...rest }) {
  if (variant === "filter") {
    return (
      <button className="t-chip t-chip--filter" aria-pressed={!!pressed} onClick={onClick} {...rest}>
        {children}
      </button>
    );
  }
  return <span className={`t-chip t-chip--${variant}`} {...rest}>{children}</span>;
}

// ─── StatusDot ───
function StatusDot({ tone = "neutral", children }) {
  return (
    <span className={`t-status t-status--${tone}`}>
      <span className="t-status__dot" />
      <span>{children}</span>
    </span>
  );
}

// ─── Avatar ───
function Avatar({ name = "?", size = 32, ring }) {
  const initials = name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
  const cls = ["t-avatar", `t-avatar--${size}`, ring ? `t-avatar--${ring}` : ""].join(" ");
  return <span className={cls}>{initials}</span>;
}

// ─── Divider ───
function Divider({ vertical }) {
  return <hr className={"t-divider" + (vertical ? " t-divider--v" : "")} />;
}

// ─── EmptyState ───
function EmptyState({ title, body, cta }) {
  return (
    <div className="t-empty">
      <div className="t-empty__title">{title}</div>
      {body && <div className="t-empty__body">{body}</div>}
      {cta && <div className="t-empty__cta">{cta}</div>}
    </div>
  );
}

// ─── Tabs (underline) ───
function Tabs({ items, value, onChange }) {
  return (
    <div className="t-tabs" role="tablist">
      {items.map(it => (
        <button
          key={it.value}
          role="tab"
          aria-selected={it.value === value}
          className="t-tabs__item"
          onClick={() => onChange && onChange(it.value)}
        >
          {it.label}
          {typeof it.count === "number" && <Chip variant="count">{it.count}</Chip>}
        </button>
      ))}
    </div>
  );
}

// ─── Segment ───
function Segment({ items, value, onChange }) {
  return (
    <div className="t-seg" role="group">
      {items.map(it => (
        <button
          key={it.value}
          className="t-seg__item"
          aria-pressed={it.value === value}
          onClick={() => onChange && onChange(it.value)}
        >{it.label}</button>
      ))}
    </div>
  );
}

// ─── Tooltip ───
function Tooltip({ label, children }) {
  return (
    <span className="t-tip">
      {children}
      <span className="t-tip__bubble" role="tooltip">{label}</span>
    </span>
  );
}

// ─── KbdHint (platform-aware) ───
function isMac(){
  if (typeof navigator === "undefined") return false;
  const p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
  return /mac|iPhone|iPod|iPad/i.test(p);
}
function KbdHint({ keys }) {
  // keys: array of strings; use "Mod" for Ctrl/Cmd placeholder
  const mac = isMac();
  const render = keys.map(k => k === "Mod" ? (mac ? "⌘" : "Ctrl") : k);
  return (
    <span className="t-kbd">
      {render.map((k,i)=><kbd key={i}>{k}</kbd>)}
    </span>
  );
}

// ─── InlineMath / FormulaBlock (KaTeX via window.katex if present; fallback = styled text) ───
function InlineMath({ tex }) {
  const ref = useRef(null);
  useEffect(() => {
    if (window.katex && ref.current) {
      try { window.katex.render(tex, ref.current, { throwOnError: false, displayMode: false }); }
      catch { ref.current.textContent = tex; }
    }
  }, [tex]);
  return <span className="t-formula-inline" ref={ref}>{tex}</span>;
}
function FormulaBlock({ tex }) {
  const ref = useRef(null);
  useEffect(() => {
    if (window.katex && ref.current) {
      try { window.katex.render(tex, ref.current, { throwOnError: false, displayMode: true }); }
      catch { ref.current.textContent = tex; }
    }
  }, [tex]);
  return <div className="t-formula-block" ref={ref}>{tex}</div>;
}

// ─── AnswerInput ───
function AnswerInput({ value, placeholder = "Ответ", unit, tolerance, onChange }) {
  return (
    <span className="t-answer">
      <input
        value={value ?? ""}
        placeholder={placeholder}
        onChange={e => onChange && onChange(e.target.value)}
        inputMode="decimal"
      />
      {unit && <span className="t-answer__unit">{unit}</span>}
      {tolerance && <span className="t-answer__tol">±{tolerance}</span>}
    </span>
  );
}

// ─── Progress ───
function Progress({ value, max = 100, label }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <span className="t-progress">
      <span className="t-progress__track"><span className="t-progress__fill" style={{ width: `${pct}%` }} /></span>
      <span className="t-progress__label">{label ?? `${Math.round(pct)}%`}</span>
    </span>
  );
}

// ─── Difficulty dots (1..3) ───
function Difficulty({ level = 1 }) {
  return (
    <span className="t-diff" aria-label={`Сложность ${level} из 3`}>
      {[1,2,3].map(i => <span key={i} className={"t-diff__dot" + (i <= level ? " t-diff__dot--on" : "")} />)}
    </span>
  );
}

Object.assign(window, {
  Icon, Button, Field, Input, Chip, StatusDot, Avatar, Divider,
  EmptyState, Tabs, Segment, Tooltip, KbdHint,
  InlineMath, FormulaBlock, AnswerInput, Progress, Difficulty,
});
