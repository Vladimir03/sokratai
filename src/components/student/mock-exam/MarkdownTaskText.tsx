import { lazy, Suspense, useEffect } from 'react';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { cn } from '@/lib/utils';

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
const tableComponents = {
  table: (props: { children?: React.ReactNode }) => (
    <table className="my-3 w-full border-collapse overflow-hidden rounded-md border border-slate-200 text-sm">
      {props.children}
    </table>
  ),
  thead: (props: { children?: React.ReactNode }) => (
    <thead className="bg-slate-100 text-slate-800">{props.children}</thead>
  ),
  th: (props: { children?: React.ReactNode }) => (
    <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold">
      {props.children}
    </th>
  ),
  td: (props: { children?: React.ReactNode }) => (
    <td className="border-b border-slate-100 px-3 py-2 align-top last:border-b-0">
      {props.children}
    </td>
  ),
  p: (props: { children?: React.ReactNode }) => (
    <p className="my-2 whitespace-pre-wrap leading-7">{props.children}</p>
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
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={tableComponents}
        >
          {text}
        </ReactMarkdown>
      </Suspense>
    </div>
  );
}
