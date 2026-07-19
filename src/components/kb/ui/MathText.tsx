/**
 * Lightweight LaTeX-rendering component for KB task cards.
 * Uses KaTeX directly so Cyrillic and mixed text can pass through without \text{} wrappers.
 * Job: A2 — верифицировать задачу (doc 16, принцип 16: "Физика — не plain text")
 */

import { Fragment, memo, useEffect, useMemo, type ElementType } from 'react';
import katex from 'katex';
import { containsChatUrl, linkifyEscapedHtml } from '@/lib/chatLinkify';
import { preprocessLatex } from '@/components/kb/ui/preprocessLatex';

interface MathTextProps {
  text: string;
  className?: string;
  as?: 'p' | 'div' | 'span';
  /**
   * Opt-in markdown-lite для AI-ответов чата: `**жирный**` → <strong>,
   * `` `код` `` → <code>. Default false — KB-карточки не затронуты.
   */
  markdownLite?: boolean;
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

/**
 * Markdown-lite поверх УЖЕ escapeHtml-нутого текста (безопасно: пользовательский
 * HTML экранирован до подстановки тегов). Только inline bold/code — без
 * заголовков/списков (AI-промпт просит их не использовать; это подстраховка).
 */
function applyMarkdownLite(escapedText: string): string {
  // Не матчим через границу строки (к этому моменту \n уже заменён плейсхолдером).
  const withinLine = (inner: string) => !inner.includes(LINEBREAK_PLACEHOLDER);
  return escapedText
    .replace(/\*\*([^*\n]+)\*\*/g, (m, inner: string) =>
      withinLine(inner) ? `<strong>${inner}</strong>` : m,
    )
    .replace(/`([^`\n]+)`/g, (m, inner: string) =>
      withinLine(inner) ? `<code>${inner}</code>` : m,
    );
}

function renderMixedLatexToHtml(text: string, markdownLite = false): string {
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

      let escaped = escapeHtml(segment);
      if (markdownLite) {
        // Порядок КРИТИЧЕН: сначала markdownLite (по чистому escaped-тексту),
        // потом ссылки. URL-класс символов останавливается на «<»/«>» уже
        // вставленных тегов → linkify не лезет внутрь разметки; обратный
        // порядок дал бы bold-регэкспу корёжить href с «**» в пути.
        // Построчно через плейсхолдер — `_` из ___LINEBREAK___ иначе засосало
        // бы в URL (запрос Елены 2026-07-13, канон — src/lib/chatLinkify.ts).
        escaped = linkifyEscapedHtml(applyMarkdownLite(escaped), LINEBREAK_PLACEHOLDER);
      }
      return escaped;
    })
    .join('');

  return renderedHtml.split(LINEBREAK_PLACEHOLDER).join('<br />');
}

const MathTextInner = memo(function MathTextInner({
  text,
  className,
  as: Tag = 'div',
  markdownLite = false,
}: MathTextProps) {
  const hasMath = text.includes('$') || text.includes('\\(') || text.includes('\\[');
  // markdownLite с реальной разметкой/ссылкой → HTML-рендерер даже без math
  // (чат-сообщения короткие, оверхед незаметен); иначе — zero-overhead путь.
  const hasLiteMarkdown = markdownLite &&
    (text.includes('**') || text.includes('`') || containsChatUrl(text));

  // Fast path: no math → plain text, zero KaTeX overhead.
  // Preserve newlines as <br /> (mirror the math path) so multi-line text —
  // e.g. numbered statements «1)… 2)… 3)…» (обществознание) — doesn't collapse
  // into one paragraph. Single-line text keeps the zero-overhead path.
  if (!hasMath && !hasLiteMarkdown) {
    if (!text.includes('\n') && !text.includes('\r')) {
      return <Tag className={className}>{text}</Tag>;
    }
    const lines = text.split(/\r\n?|\n/);
    return (
      <Tag className={className}>
        {lines.map((line, i) => (
          <Fragment key={i}>
            {i > 0 && <br />}
            {line}
          </Fragment>
        ))}
      </Tag>
    );
  }

  return <MathRenderer text={text} className={className} Tag={Tag} markdownLite={markdownLite} />;
});

MathTextInner.displayName = 'MathText';

/** Internal renderer — only mounted when hasMath is true */
function MathRenderer({
  text,
  className,
  Tag,
  markdownLite = false,
}: {
  text: string;
  className?: string;
  Tag: ElementType;
  markdownLite?: boolean;
}) {
  useEffect(() => {
    void import('katex/dist/katex.min.css');
  }, []);

  const renderedHtml = useMemo(
    () => renderMixedLatexToHtml(text, markdownLite),
    [text, markdownLite],
  );

  return (
    <Tag
      className={className}
      dangerouslySetInnerHTML={{ __html: renderedHtml }}
    />
  );
}

export { MathTextInner as MathText };
