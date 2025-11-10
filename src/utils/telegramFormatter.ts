/**
 * Telegram Bot Formatter Utility
 * Converts LaTeX formulas and markdown to Telegram-friendly format
 */

// LaTeX to Unicode symbol mappings
const LATEX_TO_UNICODE: Record<string, string> = {
  // Square roots
  '\\sqrt': '√',
  
  // Superscripts
  '^2': '²',
  '^3': '³',
  '^4': '⁴',
  
  // Math operators
  '\\pm': '±',
  '\\mp': '∓',
  '\\times': '×',
  '\\div': '÷',
  '\\cdot': '·',
  '\\approx': '≈',
  '\\neq': '≠',
  '\\leq': '≤',
  '\\geq': '≥',
  '\\infty': '∞',
  
  // Greek letters (lowercase)
  '\\alpha': 'α',
  '\\beta': 'β',
  '\\gamma': 'γ',
  '\\delta': 'δ',
  '\\epsilon': 'ε',
  '\\theta': 'θ',
  '\\lambda': 'λ',
  '\\mu': 'μ',
  '\\pi': 'π',
  '\\sigma': 'σ',
  '\\phi': 'φ',
  '\\omega': 'ω',
  
  // Greek letters (uppercase)
  '\\Delta': 'Δ',
  '\\Theta': 'Θ',
  '\\Lambda': 'Λ',
  '\\Sigma': 'Σ',
  '\\Phi': 'Φ',
  '\\Omega': 'Ω',
  
  // Fractions (common)
  '\\frac{1}{2}': '½',
  '\\frac{1}{3}': '⅓',
  '\\frac{2}{3}': '⅔',
  '\\frac{1}{4}': '¼',
  '\\frac{3}{4}': '¾',
};

/**
 * Converts LaTeX formulas to Unicode symbols
 */
function convertLatexToUnicode(text: string): string {
  let result = text;
  
  // Replace LaTeX commands with Unicode symbols
  for (const [latex, unicode] of Object.entries(LATEX_TO_UNICODE)) {
    result = result.replace(new RegExp(latex.replace(/[\\^{}]/g, '\\$&'), 'g'), unicode);
  }
  
  return result;
}

/**
 * Converts markdown to Telegram HTML format
 */
function convertMarkdownToTelegramHTML(text: string): string {
  let result = text;
  
  // Bold: **text** or __text__ → <b>text</b>
  result = result.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  result = result.replace(/__(.+?)__/g, '<b>$1</b>');
  
  // Italic: *text* or _text_ → <i>text</i>
  result = result.replace(/\*(.+?)\*/g, '<i>$1</i>');
  result = result.replace(/_(.+?)_/g, '<i>$1</i>');
  
  // Code: `text` → <code>text</code>
  result = result.replace(/`(.+?)`/g, '<code>$1</code>');
  
  // Strikethrough: ~~text~~ → <s>text</s>
  result = result.replace(/~~(.+?)~~/g, '<s>$1</s>');
  
  // Underline: (not standard markdown, but useful)
  result = result.replace(/<u>(.+?)<\/u>/g, '<u>$1</u>');
  
  return result;
}

/**
 * Escapes HTML special characters for Telegram
 */
function escapeHTMLForTelegram(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Main formatter function
 * Converts LaTeX and markdown to Telegram-friendly HTML format
 */
export function formatForTelegram(text: string): string {
  // Step 1: Convert LaTeX to Unicode
  let result = convertLatexToUnicode(text);
  
  // Step 2: Escape HTML special characters (but preserve markdown)
  // We need to be careful here to not escape markdown symbols
  
  // Step 3: Convert markdown to Telegram HTML
  result = convertMarkdownToTelegramHTML(result);
  
  return result;
}

/**
 * Generates Telegram inline keyboard JSON for Mini App button
 */
export function generateMiniAppButton(solutionId: string): string {
  const WEBAPP_URL = import.meta.env.VITE_WEBAPP_URL || window.location.origin;
  
  return JSON.stringify({
    inline_keyboard: [[{
      text: "📱 Открыть полное решение",
      web_app: {
        url: `${WEBAPP_URL}/miniapp/solution/${solutionId}`
      }
    }]]
  });
}

/**
 * Formats solution for Telegram message
 * Returns shortened version with button to open full solution
 */
export function formatSolutionPreview(
  problem: string,
  answer: string,
  solutionId: string
): { text: string; replyMarkup: string } {
  const text = formatForTelegram(`
📝 **Задача:**
${problem}

✅ **Ответ:** ${answer}

👇 Нажми кнопку ниже, чтобы увидеть подробное решение с формулами!
  `.trim());
  
  return {
    text,
    replyMarkup: generateMiniAppButton(solutionId)
  };
}
