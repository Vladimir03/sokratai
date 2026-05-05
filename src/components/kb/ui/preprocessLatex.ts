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

  // Collapse newlines that hug the now-inline math so the variable flows
  // back into the surrounding sentence:
  //   "высотой\n$H = 45$\nметров" → "высотой $H = 45$ метров"
  // Only touches inline `$...$` (no `$$`), so block math layout is preserved.
  text = text.replace(/(\S)[ \t]*\n+[ \t]*(\$[^$\n]+\$)/g, "$1 $2");
  text = text.replace(/(\$[^$\n]+\$)[ \t]*\n+[ \t]*(\S)/g, "$1 $2");

  return text;
}
