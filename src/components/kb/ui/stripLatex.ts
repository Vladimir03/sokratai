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
  // Атом = одиночный знак/число/переменная (возможно с ведущим минусом или
  // десятичной точкой/запятой). Всё с внутренним оператором/пробелом → в скобки.
  return /^-?[A-Za-z0-9_.,А-Яа-яЁё]+$/u.test(t) ? t : `(${t})`;
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

export function stripLatex(text: string): string {
  let s = text
    .replace(/\$\$(.*?)\$\$/g, '$1') // $$...$$ → content
    .replace(/\$(.*?)\$/g, '$1'); // $...$ → content

  // \frac{a}{b} → a/b. Innermost-first + loop (частично покрывает вложенность:
  // напр. \frac{\frac{1}{2}}{3}). \dfrac/\tfrac тоже. Плоский случай (99% KB) —
  // главный кейс репорта.
  const fracRe = /\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/;
  let guard = 0;
  while (fracRe.test(s) && guard++ < 20) {
    s = s.replace(fracRe, (_m, a: string, b: string) => `${wrapFracPart(a)}/${wrapFracPart(b)}`);
  }

  // \sqrt{a} → √(a); \sqrt[n]{a} → корень n-й степени из a.
  s = s
    .replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, (_m, n: string, a: string) => `корень ${n}-й степени из ${wrapFracPart(a)}`)
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, (_m, a: string) => `√${wrapFracPart(a)}`);

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
