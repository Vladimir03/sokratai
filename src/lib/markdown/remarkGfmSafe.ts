/**
 * remark-gfm БЕЗ autolink-literal — Safari-safe замена `remark-gfm`.
 *
 * Почему: `mdast-util-gfm-autolink-literal` (внутри remark-gfm) при КАЖДОМ
 * рендере ReactMarkdown конструирует email-регэксп с lookbehind-префиксом
 * («за началом строки/пробелом/пунктуацией») → на Safari/WebKit < 16.4 (iPhone ≤ 8 на iOS 15,
 * любой браузер на iOS ≤ 16.3 — включая Telegram in-app) это SyntaxError
 * «Invalid regular expression: invalid group specifier name» → падал рендер
 * всего экрана (инцидент Глеба, 2026-07-15). Rule 80: lookbehind запрещён.
 *
 * Что сохраняется на ВСЕХ браузерах: таблицы, зачёркивание, task-списки,
 * сноски. Что теряется (осознанно): авто-линковка ГОЛЫХ URL/email в тексте.
 * Явные `[текст](url)` и `<https://…>` — ядро CommonMark, работают как раньше.
 *
 * НИКОГДА не импортировать `remark-gfm` напрямую — только этот модуль.
 * Forward-guard: smoke-check §1/§2 фейлит любой lookbehind в src/ и dist/.
 */
import { gfmFootnote } from 'micromark-extension-gfm-footnote';
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough';
import { gfmTable } from 'micromark-extension-gfm-table';
import { gfmTaskListItem } from 'micromark-extension-gfm-task-list-item';
import { gfmFootnoteFromMarkdown } from 'mdast-util-gfm-footnote';
import { gfmStrikethroughFromMarkdown } from 'mdast-util-gfm-strikethrough';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { gfmTaskListItemFromMarkdown } from 'mdast-util-gfm-task-list-item';

interface UnifiedDataLike {
  micromarkExtensions?: unknown[];
  fromMarkdownExtensions?: unknown[];
}

// toMarkdown-сторона намеренно опущена: react-markdown только парсит,
// remark-stringify в наших пайплайнах не используется.
export default function remarkGfmSafe(this: { data: () => UnifiedDataLike }) {
  const data = this.data();
  const micromarkExtensions =
    data.micromarkExtensions || (data.micromarkExtensions = []);
  const fromMarkdownExtensions =
    data.fromMarkdownExtensions || (data.fromMarkdownExtensions = []);

  micromarkExtensions.push(
    gfmFootnote(),
    gfmStrikethrough(),
    gfmTable(),
    gfmTaskListItem(),
  );
  fromMarkdownExtensions.push([
    gfmFootnoteFromMarkdown(),
    gfmStrikethroughFromMarkdown(),
    gfmTableFromMarkdown(),
    gfmTaskListItemFromMarkdown(),
  ]);
}
