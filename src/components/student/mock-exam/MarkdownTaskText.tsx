import { lazy, Suspense, useEffect } from 'react';
import remarkGfmSafe from '@/lib/markdown/remarkGfmSafe';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { cn } from '@/lib/utils';
import MarkdownErrorBoundary from '@/components/MarkdownErrorBoundary';

// Only mounted for KIM 6/10/15/17 (matching tasks). React-markdown + plugins
// are heavy (~80 KB gz), so this whole module is lazy-imported by MathBlock.
const ReactMarkdown = lazy(() => import('react-markdown'));

interface MarkdownTaskTextProps {
  text: string;
  className?: string;
}

// Sokrat-flavoured table styling mirrors the brand surface tokens.
// Cells stretched vertically (align-top) so 3-row option list aligns with
// 2-row physical quantities column.
//
// Mobile invariant (TASK-15 fix, ChatGPT-5.5 review): wide tables (KIM 14 —
// 2-row × 11-col t/q data) overflow iPhone X viewport. Wrap table в
// `<div overflow-x-auto touch-pan-x>` + `min-w-max` чтобы получить
// horizontal scroll. `touch-pan-x` обязателен — без него scroll blocked
// (см. .claude/rules/80-cross-browser.md).
const tableComponents = {
  table: (props: { children?: React.ReactNode }) => (
    <div className="my-3 -mx-2 overflow-x-auto touch-pan-x px-2 sm:mx-0 sm:px-0">
      <table className="min-w-max border-collapse overflow-hidden rounded-md border border-slate-200 text-sm">
        {props.children}
      </table>
    </div>
  ),
  thead: (props: { children?: React.ReactNode }) => (
    <thead className="bg-slate-100 text-slate-800">{props.children}</thead>
  ),
  th: (props: { children?: React.ReactNode }) => (
    <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2 text-left font-semibold">
      {props.children}
    </th>
  ),
  td: (props: { children?: React.ReactNode }) => (
    <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2 align-top last:border-b-0">
      {props.children}
    </td>
  ),
  p: (props: { children?: React.ReactNode }) => (
    <p className="my-2 whitespace-pre-wrap leading-7">{props.children}</p>
  ),
  // 2026-05-23 fix: Tailwind Preflight reset убирает list-style для <ol>/<ul>.
  // Без этого override KIM 14 / 18 / 20 etc. (где варианты ответа записаны
  // как `1)`, `2)` — GFM ordered list) теряют нумерацию: text «Период
  // колебаний равен» вместо «1) Период колебаний равен». Возвращаем
  // list-decimal для <ol> и list-disc для <ul>. Padding-left = 6 (≈24px)
  // для отступа маркера от текста.
  ol: (props: { children?: React.ReactNode }) => (
    <ol className="my-2 list-decimal pl-6 leading-7 marker:text-slate-500">
      {props.children}
    </ol>
  ),
  ul: (props: { children?: React.ReactNode }) => (
    <ul className="my-2 list-disc pl-6 leading-7 marker:text-slate-500">
      {props.children}
    </ul>
  ),
  li: (props: { children?: React.ReactNode }) => (
    <li className="my-1">{props.children}</li>
  ),
};

export function MarkdownTaskText({ text, className }: MarkdownTaskTextProps) {
  useEffect(() => {
    // KaTeX CSS — same lazy import path as MathText uses.
    void import('katex/dist/katex.min.css');
  }, []);

  return (
    <div className={cn('text-base leading-7 text-slate-800', className)}>
      <Suspense fallback={<div className="whitespace-pre-wrap">{text}</div>}>
        <MarkdownErrorBoundary fallbackText={text}>
          <ReactMarkdown
            remarkPlugins={[remarkGfmSafe, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={tableComponents}
          >
            {text}
          </ReactMarkdown>
        </MarkdownErrorBoundary>
      </Suspense>
    </div>
  );
}
