/**
 * Lightweight LaTeX-rendering component for KB task cards.
 * Lazy-loads KaTeX CSS and ReactMarkdown only when math is detected.
 * Job: A2 — верифицировать задачу (doc 16, принцип 16: "Физика — не plain text")
 */

import { memo, lazy, Suspense, useEffect, useState, useMemo, type ElementType } from 'react';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { preprocessLatex } from '@/components/kb/ui/preprocessLatex';
import { stripLatex } from '@/components/kb/ui/stripLatex';

const ReactMarkdown = lazy(() => import('react-markdown'));

interface MathTextProps {
  text: string;
  className?: string;
  as?: 'p' | 'div' | 'span';
}

const MathTextInner = memo(function MathTextInner({ text, className, as: Tag = 'div' }: MathTextProps) {
  const hasMath = text.includes('$') || text.includes('\\(') || text.includes('\\[');

  // Fast path: no math → plain text, zero KaTeX overhead
  if (!hasMath) {
    return <Tag className={className}>{text}</Tag>;
  }

  return <MathRenderer text={text} className={className} Tag={Tag} />;
});

MathTextInner.displayName = 'MathText';

/** Internal renderer — only mounted when hasMath is true */
function MathRenderer({ text, className, Tag }: { text: string; className?: string; Tag: ElementType }) {
  const [katexLoaded, setKatexLoaded] = useState(false);

  useEffect(() => {
    if (!katexLoaded) {
      void import('katex/dist/katex.min.css').then(() => {
        setKatexLoaded(true);
      });
    }
  }, [katexLoaded]);

  const processedText = useMemo(() => preprocessLatex(text), [text]);

  // Override ReactMarkdown's <p> to remove margins (enables line-clamp on parent).
  // When Tag is 'span', render inner paragraphs as <span> to avoid invalid block-in-inline HTML.
  const markdownComponents = useMemo(
    () => ({
      p: ({ node, ...props }: Record<string, unknown>) => {
        if (Tag === 'span') {
          return <span className="break-words whitespace-pre-wrap" {...(props as React.HTMLAttributes<HTMLSpanElement>)} />;
        }
        return <p className="mb-0 break-words whitespace-pre-wrap last:mb-0" {...(props as React.HTMLAttributes<HTMLParagraphElement>)} />;
      },
      a: ({ node, ...props }: Record<string, unknown>) => (
        <a target="_blank" rel="noopener noreferrer" {...(props as React.AnchorHTMLAttributes<HTMLAnchorElement>)} />
      ),
    }),
    [Tag],
  );

  return (
    <Tag className={className}>
      <Suspense fallback={<span>{stripLatex(text)}</span>}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={markdownComponents}
        >
          {processedText}
        </ReactMarkdown>
      </Suspense>
    </Tag>
  );
}

export { MathTextInner as MathText };
