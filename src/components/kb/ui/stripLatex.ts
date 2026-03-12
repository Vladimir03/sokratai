/** Strip LaTeX delimiters and common commands, returning plain text. */
export function stripLatex(text: string): string {
  return text
    .replace(/\$\$(.*?)\$\$/g, '$1')   // $$...$$ → content
    .replace(/\$(.*?)\$/g, '$1')        // $...$ → content
    .replace(/\\[a-zA-Z]+/g, '')        // \frac, \cdot etc → remove
    .replace(/\{,\}/g, ',')             // {,} → , (LaTeX decimal comma)
    .replace(/[{}]/g, '');              // remaining braces → remove
}
