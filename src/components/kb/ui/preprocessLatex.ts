/**
 * Normalize LaTeX delimiters to remark-math compatible format.
 * Extracted from ChatMessage.tsx / GuidedChatMessage.tsx for reuse.
 */
export function preprocessLatex(text: string): string {
  // Convert LaTeX display mode \[...\] to $$...$$
  // '$$$$' needed because $$ is a special replacement pattern in String.replace
  text = text.replace(/\\\[/g, '$$$$');
  text = text.replace(/\\\]/g, '$$$$');
  // Convert LaTeX inline mode \(...\) to $...$
  text = text.replace(/\\\(/g, '$');
  text = text.replace(/\\\)/g, '$');
  // Fix \textfrac to \frac
  text = text.replace(/\\textfrac/g, '\\frac');
  return text;
}
