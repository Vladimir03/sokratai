/**
 * Lightweight LaTeX-rendering component for KB task cards.
 * Uses KaTeX directly so Cyrillic and mixed text can pass through without \text{} wrappers.
 * Job: A2 — верифицировать задачу (doc 16, принцип 16: "Физика — не plain text")
 */

import { memo, useEffect, useMemo, type ElementType } from 'react';
import katex from 'katex';
import { preprocessLatex } from '@/components/kb/ui/preprocessLatex';

interface MathTextProps {
  text: string;
  className?: string;
  as?: 'p' | 'div' | 'span';
}

const LINEBREAK_PLACEHOLDER = '___LINEBREAK___';
const MATH_SEGMENT_REGEX = /(\$\$[\s\S]+?\$\$|\$[^$\n]+\$)/g;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMathSegment(segment: string): string {
  const isDisplay = segment.startsWith('$$') && segment.endsWith('$$');
  const rawLatex = isDisplay
    ? segment.slice(2, -2)
    : segment.slice(1, -1);

  try {
    return katex.renderToString(rawLatex, {
      displayMode: isDisplay,
      throwOnError: false,
      output: 'html',
    });
  } catch {
    return escapeHtml(segment);
  }
}

function renderMixedLatexToHtml(text: string): string {
  const normalizedText = preprocessLatex(text).replace(/\r\n?/g, '\n');
  const textWithPlaceholders = normalizedText.replace(/\n/g, LINEBREAK_PLACEHOLDER);
  const segments = textWithPlaceholders.split(MATH_SEGMENT_REGEX);

  const renderedHtml = segments
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      if (
        (segment.startsWith('$$') && segment.endsWith('$$')) ||
        (segment.startsWith('$') && segment.endsWith('$'))
      ) {
        return renderMathSegment(segment);
      }

      return escapeHtml(segment);
    })
    .join('');

  return renderedHtml.split(LINEBREAK_PLACEHOLDER).join('<br />');
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
  useEffect(() => {
    void import('katex/dist/katex.min.css');
  }, []);

  const renderedHtml = useMemo(() => renderMixedLatexToHtml(text), [text]);

  return (
    <Tag
      className={className}
      dangerouslySetInnerHTML={{ __html: renderedHtml }}
    />
  );
}

export { MathTextInner as MathText };
