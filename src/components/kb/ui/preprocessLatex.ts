/**
 * Normalize LaTeX delimiters to remark-math compatible format.
 * Extracted from ChatMessage.tsx / GuidedChatMessage.tsx for reuse.
 *
 * KB tasks were imported with `$$variable=N$$` (block math) for short
 * variable assignments — KaTeX rendered them as centered blocks, breaking
 * the natural reading flow («С крыши высотой\n[H = 45]\nметров»). Vladimir's
 * call: short math (≤ INLINE_THRESHOLD chars on a single line) should always
 * render inline; only long / multiline expressions stay block.
 */

// Length cutoff for forcing inline. Picked to keep short variable assignments
// and simple fractions (e.g. `\frac{1}{2}`) inline while letting longer
// derivations stay on their own line.
const INLINE_THRESHOLD = 40;

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

  // Promote short single-line $$...$$ to inline $...$
  text = text.replace(/\$\$([^\n$]+?)\$\$/g, (_match, content: string) => {
    const trimmed = content.trim();
    if (trimmed.length > INLINE_THRESHOLD) {
      return `$$${content}$$`;
    }
    return `$${content}$`;
  });

  // Collapse newlines that hug the now-inline math so the variable flows
  // back into the surrounding sentence:
  //   "высотой\n$H = 45$\nметров" → "высотой $H = 45$ метров"
  // Only touches inline `$...$` (no `$$`), so block math layout is preserved.
  text = text.replace(/(\S)[ \t]*\n+[ \t]*(\$[^$\n]+\$)/g, "$1 $2");
  text = text.replace(/(\$[^$\n]+\$)[ \t]*\n+[ \t]*(\S)/g, "$1 $2");

  return text;
}
