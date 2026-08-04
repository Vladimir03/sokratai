/**
 * Normalize LaTeX delimiters to remark-math compatible format.
 * Extracted from ChatMessage.tsx / GuidedChatMessage.tsx for reuse.
 *
 * KB tasks were imported with `$$variable=N$$` (block math) for short
 * variable assignments — KaTeX rendered them as centered blocks, breaking
 * the natural reading flow («С крыши высотой\n[H = 45]\nметров»). Vladimir's
 * call: short math (≤ INLINE_THRESHOLD chars on a single line) should always
 * render inline; only long / multiline expressions stay block.
 *
 * History: an earlier version used a regex `$$([^$\n]{1,40})$$` for the
 * normalization. That broke on adjacent block pairs like
 * `$$LongX$$ Y $$LongZ$$` — the regex matched the closing-of-X + opening-
 * of-Z as a fresh `$$ Y $$` pair (because both are valid `$$` sequences
 * with short content between), corrupting the source into
 * `$$LongX$Y$LongZ$$` (unbalanced delimiters → KaTeX renders raw text).
 * Replaced with a character-walking scan that always pairs each `$$` with
 * the NEXT `$$`, so closing/opening can't be mis-fused.
 */

// Length cutoff for forcing inline. Picked to keep short variable assignments
// and simple fractions (e.g. `\frac{1}{2}`) inline while letting longer
// derivations stay on their own line.
const INLINE_THRESHOLD = 40;

/**
 * Walk through `text`, pair every `$$` with the very next `$$`, and convert
 * the pair to inline `$X$` if X is ≤ INLINE_THRESHOLD chars and single-line.
 * Long / multiline content stays as `$$X$$`. Bullet-proof against the
 * adjacent-block-pair confusion that regex backtracking caused.
 */
function normalizeBlockPairs(text: string): string {
  let result = "";
  let i = 0;
  const n = text.length;

  while (i < n) {
    const open = text.indexOf("$$", i);
    if (open < 0) {
      result += text.slice(i);
      break;
    }
    // Append text before the opening $$
    result += text.slice(i, open);
    // Find closing $$
    const close = text.indexOf("$$", open + 2);
    if (close < 0) {
      // No closing $$ — emit rest as-is so we don't mangle the input.
      result += text.slice(open);
      break;
    }
    const content = text.slice(open + 2, close);
    if (
      content.length <= INLINE_THRESHOLD &&
      !content.includes("\n")
    ) {
      result += `$${content}$`;
    } else {
      result += `$$${content}$$`;
    }
    i = close + 2;
  }

  return result;
}

/** Строка целиком = одна формула (допускается хвостовой знак препинания). */
function isMathOnlyLine(trimmed: string): boolean {
  if (trimmed.length === 0) return false;
  // Блочная `$$…$$` либо инлайн `$…$`, опционально с `.`/`,`/`;`/`:`/`!`/`?`.
  // Хвостовой знак допускается НАМЕРЕННО: репетиторы уже написали формулы с
  // точкой (обходной приём «поставь точку после доллара»), и после этой правки
  // их контент обязан продолжать рисоваться столбиком — без миграции данных.
  return /^\$\$[^$]*\$\$[.,;:!?]?$/.test(trimmed) || /^\$[^$]*\$[.,;:!?]?$/.test(trimmed);
}

/** Начало строки — маркер списка: `1)` `2.` `а)` `б.` `-` `–` `•`. */
function startsListItem(trimmed: string): boolean {
  return /^(?:[0-9]{1,2}[).]|[a-zA-Zа-яА-ЯёЁ][).]|[-–—•])\s/u.test(trimmed);
}

const STARTS_INLINE_MATH = /^\$[^$\n]+\$/;
const ENDS_INLINE_MATH = /\$[^$\n]+\$$/;

/**
 * Втягивает одиночную формулу обратно в предложение, НО не склеивает формулы
 * между собой.
 *
 * Зачем: правило существует, чтобы «С крыши высотой\n$H=45$\nметров» читалось
 * одним предложением. Раньше оно было двумя глобальными регэкспами через
 * `\n`, поэтому срабатывало без разбора и склеивало ЛЮБЫЕ две формулы на
 * соседних строках в строчку. Химик пишет уравнения столбиком — и получал
 * строчку; обходились точкой после `$` (совет по цепочке от репетитора к
 * репетитору). Теперь решение принимается на границе строк:
 *   - обе строки — формулы  → перенос СОХРАНЯЕТСЯ (столбик);
 *   - следующая строка начинает пункт списка → перенос сохраняется;
 *   - иначе — прежнее поведение байт-в-байт.
 */
function collapseMathHuggingNewlines(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];

  for (const raw of lines) {
    if (out.length === 0) {
      out.push(raw);
      continue;
    }
    const curTrim = raw.trim();
    // Пустую строку копим: решение примет следующая непустая (прежние правила
    // поглощали пустые строки через `\n+`).
    if (curTrim.length === 0) {
      out.push(raw);
      continue;
    }
    // Последняя непустая строка — «якорь» для склейки.
    let anchor = out.length - 1;
    while (anchor >= 0 && out[anchor].trim().length === 0) anchor -= 1;
    if (anchor < 0) {
      out.push(raw);
      continue;
    }
    const anchorTrim = out[anchor].trim();

    const keepBreak =
      (isMathOnlyLine(anchorTrim) && isMathOnlyLine(curTrim)) || startsListItem(curTrim);
    if (!keepBreak) {
      const joinBecauseNextIsMath =
        /\S$/.test(anchorTrim) && STARTS_INLINE_MATH.test(curTrim);
      const joinBecausePrevIsMath =
        ENDS_INLINE_MATH.test(anchorTrim) && /^\S/.test(curTrim);
      if (joinBecauseNextIsMath || joinBecausePrevIsMath) {
        out.length = anchor + 1; // поглощаем накопленные пустые строки
        out[anchor] = `${out[anchor].replace(/[ \t]+$/, "")} ${curTrim}`;
        continue;
      }
    }
    out.push(raw);
  }

  return out.join("\n");
}

export function preprocessLatex(text: string): string {
  // Convert LaTeX display mode \[...\] to $$...$$
  // '$$$$' needed because $$ is a special replacement pattern in String.replace
  text = text.replace(/\\\[/g, "$$$$");
  text = text.replace(/\\\]/g, "$$$$");
  // Convert LaTeX inline mode \(...\) to $...$
  text = text.replace(/\\\(/g, "$");
  text = text.replace(/\\\)/g, "$");
  // Fix \textfrac to \frac
  text = text.replace(/\\textfrac/g, "\\frac");

  // Pair-aware normalization — see normalizeBlockPairs comment.
  text = normalizeBlockPairs(text);

  // Втягиваем одиночную формулу в предложение, но НЕ склеиваем формулы между
  // собой (см. collapseMathHuggingNewlines — там же история про «точку»).
  text = collapseMathHuggingNewlines(text);

  return text;
}
