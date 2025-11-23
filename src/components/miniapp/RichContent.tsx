import { Suspense, lazy, useMemo, useEffect, useState } from 'react';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Math } from './Math';

const ReactMarkdown = lazy(() => import('react-markdown'));

interface RichContentProps {
  children: string;
  className?: string;
  inline?: boolean;
  style?: React.CSSProperties;
}

/**
 * Rich content renderer with LaTeX and Markdown support
 * Similar to ChatMessage but optimized for Mini App
 */
export function RichContent({ children, className = '', inline = false, style }: RichContentProps) {
  const [katexLoaded, setKatexLoaded] = useState(false);

  // Preprocess LaTeX to handle different formats
  const preprocessLatex = (text: string) => {
    return text
      // Display math: $$...$$ or \[...\]
      .replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => `\n$$${math.trim()}$$\n`)
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, math) => `\n$$${math.trim()}$$\n`)
      // Inline math: $...$ or \(...\)
      .replace(/\$([^\$\n]+?)\$/g, (_, math) => `$${math.trim()}$`)
      .replace(/\\\(([^\)]+?)\\\)/g, (_, math) => `$${math.trim()}$`);
  };

  const processedContent = useMemo(() => preprocessLatex(children), [children]);

  // Custom markdown components styled for Telegram Mini App
  const markdownComponents = useMemo(
    () => ({
      p: ({ children }: any) => (
        <p className="mb-3 leading-relaxed last:mb-0" style={{ color: 'var(--tg-theme-text-color, hsl(var(--foreground)))' }}>
          {children}
        </p>
      ),
      strong: ({ children }: any) => (
        <strong className="font-bold" style={{ color: 'var(--tg-theme-text-color, hsl(var(--foreground)))' }}>
          {children}
        </strong>
      ),
      em: ({ children }: any) => (
        <em className="italic" style={{ color: 'var(--tg-theme-hint-color, hsl(var(--muted-foreground)))' }}>
          {children}
        </em>
      ),
      ul: ({ children }: any) => (
        <ul className="list-disc list-inside mb-3 space-y-2" style={{ color: 'var(--tg-theme-text-color, hsl(var(--foreground)))' }}>
          {children}
        </ul>
      ),
      ol: ({ children }: any) => (
        <ol className="list-decimal list-inside mb-3 space-y-2" style={{ color: 'var(--tg-theme-text-color, hsl(var(--foreground)))' }}>
          {children}
        </ol>
      ),
      li: ({ children }: any) => (
        <li className="leading-relaxed" style={{ color: 'var(--tg-theme-text-color, hsl(var(--foreground)))' }}>
          {children}
        </li>
      ),
      code: ({ inline, children }: any) =>
        inline ? (
          <code
            className="px-2 py-0.5 rounded text-sm font-mono"
            style={{
              backgroundColor: 'var(--tg-theme-secondary-bg-color, hsl(var(--secondary)))',
              color: 'var(--tg-theme-text-color, hsl(var(--foreground)))',
            }}
          >
            {children}
          </code>
        ) : (
          <code
            className="block p-3 rounded-lg text-sm font-mono overflow-x-auto mb-3"
            style={{
              backgroundColor: 'var(--tg-theme-secondary-bg-color, hsl(var(--secondary)))',
              color: 'var(--tg-theme-text-color, hsl(var(--foreground)))',
            }}
          >
            {children}
          </code>
        ),
    }),
    []
  );

  // Load KaTeX CSS if there's math content
  useEffect(() => {
    if (processedContent.includes('$') && !katexLoaded) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.23/dist/katex.min.css';
      link.integrity = 'sha384-p2VkVBxIW6poXRz+CjEfTGYy0GnN0Bh7+uCh0xN6TG/qPfqBTUJjU4bQhWX3dh2T';
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
      setKatexLoaded(true);
    }
  }, [processedContent, katexLoaded]);

  // For inline rendering (like in titles)
  if (inline) {
    return (
      <span className={className} style={style}>
        <Suspense fallback={<span>{children}</span>}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={{
              ...markdownComponents,
              p: ({ children }: any) => <>{children}</>, // No <p> wrapper for inline
            }}
          >
            {processedContent}
          </ReactMarkdown>
        </Suspense>
      </span>
    );
  }

  // For block rendering
  return (
    <div className={className} style={style}>
      <Suspense
        fallback={
          <div className="animate-pulse" style={{ color: 'var(--tg-theme-hint-color, hsl(var(--muted-foreground)))' }}>
            Загрузка...
          </div>
        }
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={markdownComponents}
        >
          {processedContent}
        </ReactMarkdown>
      </Suspense>
    </div>
  );
}
