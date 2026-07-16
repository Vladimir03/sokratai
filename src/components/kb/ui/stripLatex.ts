/**
 * Strip LaTeX delimiters and common commands → READABLE plain text.
 *
 * Используется в плотных превью (таблица ревью загрузчика, карточки списка,
 * homework preview, диалоги перемещения) — где KaTeX не рендерим (перф/rule 50).
 *
 * КРИТИЧНО (хотфикс 2026-07-12, репорт Светланы/математика): раньше `\frac`
 * просто вырезался, и `\frac{16}{x+5}` превращался в «16x+5» — тутор в таблице
 * видел ДРУГОЕ, неверное уравнение. Теперь дроби рендерятся как `a/b` со
 * скобками для составных частей, а частые операторы/греческие — в юникод-символы.
 * Неизвестные команды по-прежнему удаляются (как раньше, без регрессии).
 */

/** Часть числителя/знаменателя дроби: скобки нужны, если это не «атом». */
function wrapFracPart(part: string): string {
  const t = part.trim();
  // Атом = одиночный знак/число/переменная (возможно с ведущим минусом/корнем
  // или десятичной точкой/запятой). Всё с оператором/пробелом внутри → в скобки.
  return /^-?√?[A-Za-z0-9_.,А-Яа-яЁё]+$/u.test(t) ? t : `(${t})`;
}

/** Частые LaTeX-команды → читаемые юникод-символы (порядок: длинные раньше коротких). */
const COMMAND_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\\left|\\right/g, ''],
  // Имена функций — сохраняем читаемыми (иначе \sin\alpha → просто α).
  [/\\sin/g, 'sin'],
  [/\\cos/g, 'cos'],
  [/\\tan/g, 'tan'],
  [/\\cot/g, 'cot'],
  [/\\ln/g, 'ln'],
  [/\\lg/g, 'lg'],
  [/\\log/g, 'log'],
  [/\\cdot/g, '·'],
  [/\\times/g, '×'],
  [/\\div/g, '÷'],
  [/\\pm/g, '±'],
  [/\\mp/g, '∓'],
  [/\\leq|\\le\b/g, '≤'],
  [/\\geq|\\ge\b/g, '≥'],
  [/\\neq|\\ne\b/g, '≠'],
  [/\\approx/g, '≈'],
  [/\\infty/g, '∞'],
  [/\\alpha/g, 'α'],
  [/\\beta/g, 'β'],
  [/\\gamma/g, 'γ'],
  [/\\delta/g, 'δ'],
  [/\\Delta/g, 'Δ'],
  [/\\mu/g, 'μ'],
  [/\\pi/g, 'π'],
  [/\\rho/g, 'ρ'],
  [/\\sigma/g, 'σ'],
  [/\\omega/g, 'ω'],
  [/\\varphi|\\phi/g, 'φ'],
  [/\\theta/g, 'θ'],
  [/\\lambda/g, 'λ'],
  [/\\Rightarrow/g, '⇒'],
  [/\\rightarrow|\\to/g, '→'],
];

/**
 * Распарсить {…}-группу с БАЛАНСОМ скобок начиная с позиции `i` (s[i] === '{').
 * Ревью 2026-07-16 P1: плоский regex `\{[^{}]*\}` не матчил вложенные группы
 * (`\frac{x^{2}+1}{y}` → команда не обрабатывалась → «x^2+1y», слитно и неверно
 * — тот же класс, что исходный баг с дробями).
 */
function parseBraceGroup(s: string, i: number): { content: string; end: number } | null {
  if (s[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < s.length; j += 1) {
    if (s[j] === '{') depth += 1;
    else if (s[j] === '}') {
      depth -= 1;
      if (depth === 0) return { content: s.slice(i + 1, j), end: j + 1 };
    }
  }
  return null; // незакрытая группа — обработку пропускаем (битый LaTeX)
}

function skipSpaces(s: string, i: number): number {
  while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i += 1;
  return i;
}

/** \sqrt{a} → √(a); \sqrt[n]{a} → «корень n-й степени из a». Balanced-группы. */
function replaceSqrts(s: string): string {
  let guard = 0;
  for (;;) {
    if (guard++ > 40) break;
    const m = /\\sqrt/.exec(s);
    if (!m) break;
    let i = skipSpaces(s, m.index + m[0].length);
    // Опциональная степень [n].
    let degree: string | null = null;
    if (s[i] === '[') {
      const close = s.indexOf(']', i);
      if (close !== -1) {
        degree = s.slice(i + 1, close);
        i = skipSpaces(s, close + 1);
      }
    }
    const g = parseBraceGroup(s, i);
    if (!g) {
      // Нет группы — убираем саму команду, чтобы не зациклиться.
      s = s.slice(0, m.index) + s.slice(m.index + m[0].length);
      continue;
    }
    const inner = replaceSqrts(g.content); // вложенные корни
    const rendered = degree !== null
      ? `корень ${degree}-й степени из ${wrapFracPart(inner)}`
      : `√${wrapFracPart(inner)}`;
    s = s.slice(0, m.index) + rendered + s.slice(g.end);
  }
  return s;
}

/** \frac{a}{b} → a/b (скобки для составных частей). Balanced-группы + рекурсия. */
function replaceFracs(s: string): string {
  let guard = 0;
  for (;;) {
    if (guard++ > 40) break;
    const m = /\\[dt]?frac/.exec(s);
    if (!m) break;
    const i1 = skipSpaces(s, m.index + m[0].length);
    const g1 = parseBraceGroup(s, i1);
    if (!g1) {
      s = s.slice(0, m.index) + s.slice(m.index + m[0].length);
      continue;
    }
    const i2 = skipSpaces(s, g1.end);
    const g2 = parseBraceGroup(s, i2);
    if (!g2) {
      // Одна группа — оставляем её содержимое без дроби.
      s = s.slice(0, m.index) + replaceFracs(g1.content) + s.slice(g1.end);
      continue;
    }
    const a = replaceFracs(g1.content); // вложенные дроби внутри частей
    const b = replaceFracs(g2.content);
    s = s.slice(0, m.index) + `${wrapFracPart(a)}/${wrapFracPart(b)}` + s.slice(g2.end);
  }
  return s;
}

export function stripLatex(text: string): string {
  let s = text
    .replace(/\$\$(.*?)\$\$/g, '$1') // $$...$$ → content
    .replace(/\$(.*?)\$/g, '$1'); // $...$ → content

  // Порядок: sqrt ДО frac — `\frac{\sqrt{x}}{2}` тогда даёт `√x/2`, а не «(\sqrt{x})/2».
  s = replaceSqrts(s);
  s = replaceFracs(s);

  for (const [re, sym] of COMMAND_REPLACEMENTS) s = s.replace(re, sym);

  return s
    .replace(/\\[a-zA-Z]+/g, '') // прочие неизвестные команды → удалить (как раньше)
    .replace(/\\[,;!: ]/g, ' ') // LaTeX-пробелы (\, \; \  \! \:) → пробел
    .replace(/\\/g, '') // любой оставшийся одиночный бэкслеш → убрать
    .replace(/\{,\}/g, ',') // {,} → , (LaTeX-запятая в десятичных)
    .replace(/[{}]/g, '') // оставшиеся скобки-группировки → убрать
    .replace(/[ \t]{2,}/g, ' ') // схлопнуть двойные пробелы после чисток
    .trim();
}
