/**
 * Lightweight chat message renderer with Markdown + LaTeX support.
 * Based on ChatMessage.tsx patterns but without GraphRenderer/Pyodide.
 */

import { memo, lazy, Suspense, useEffect, useState, useMemo } from 'react';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

const ReactMarkdown = lazy(() => import('react-markdown'));

export interface GuidedMessageData {
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at?: string;
}

interface GuidedChatMessageProps {
  message: GuidedMessageData;
  isStreaming?: boolean;
}

/** Convert LaTeX delimiters to remark-math compatible format */
function preprocessLatex(text: string): string {
  // Convert \[...\] to $$...$$
  text = text.replace(/\\\[/g, '$$');
  text = text.replace(/\\\]/g, '$$');
  // Convert \(...\) to $...$
  text = text.replace(/\\\(/g, '$');
  text = text.replace(/\\\)/g, '$');
  // Fix \textfrac to \frac
  text = text.replace(/\\textfrac/g, '\\frac');
  return text;
}

function formatTime(isoString?: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

const GuidedChatMessage = memo(({ message, isStreaming }: GuidedChatMessageProps) => {
  const [katexLoaded, setKatexLoaded] = useState(false);
  const hasMath = message.content.includes('$');

  useEffect(() => {
    if (hasMath && !katexLoaded) {
      import('katex/dist/katex.min.css').then(() => {
        setKatexLoaded(true);
      });
    }
  }, [hasMath, katexLoaded]);

  const displayContent =
    message.role === 'assistant' ? preprocessLatex(message.content) : message.content;

  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  const markdownComponents = useMemo(
    () => ({
      p: ({ node, ...props }: any) => (
        <p
          className={`mb-3 leading-relaxed last:mb-0 break-words whitespace-pre-wrap ${
            isUser ? 'text-primary-foreground' : ''
          }`}
          {...props}
        />
      ),
      strong: ({ node, ...props }: any) => (
        <strong
          className={`font-bold ${isUser ? 'text-primary-foreground' : 'text-primary'}`}
          {...props}
        />
      ),
      ul: ({ node, ...props }: any) => (
        <ul className="list-disc ml-4 mb-3 space-y-1" {...props} />
      ),
      ol: ({ node, ...props }: any) => (
        <ol className="list-decimal ml-4 mb-3 space-y-2" {...props} />
      ),
      li: ({ node, ...props }: any) => (
        <li
          className={`ml-2 break-words ${isUser ? 'text-primary-foreground' : ''}`}
          {...props}
        />
      ),
      h3: ({ node, ...props }: any) => (
        <h3
          className={`font-bold text-lg mt-4 mb-2 break-words ${
            isUser ? 'text-primary-foreground' : ''
          }`}
          {...props}
        />
      ),
      pre: ({ node, children, ...props }: any) => (
        <pre
          className={`p-3 rounded-lg overflow-x-auto my-3 ${
            isUser ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted'
          }`}
          {...props}
        >
          {children}
        </pre>
      ),
      code: ({ node, inline, className, children, ...props }: any) => {
        if (inline) {
          return (
            <code
              className={`px-1.5 py-0.5 rounded text-sm break-words ${
                isUser ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted'
              }`}
              {...props}
            >
              {children}
            </code>
          );
        }
        return (
          <code className={`text-sm ${className || ''}`} {...props}>
            {children}
          </code>
        );
      },
    }),
    [isUser],
  );

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <div className="text-xs text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full max-w-[85%] text-center">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
          isUser
            ? 'bg-primary text-primary-foreground rounded-br-md'
            : 'bg-muted rounded-bl-md'
        }`}
      >
        <div className="text-sm">
          <Suspense
            fallback={
              <p className="whitespace-pre-wrap break-words">{displayContent}</p>
            }
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={hasMath && katexLoaded ? [rehypeKatex] : []}
              components={markdownComponents}
            >
              {displayContent}
            </ReactMarkdown>
          </Suspense>
          {isStreaming && (
            <span className="inline-block w-1.5 h-4 bg-current animate-pulse ml-0.5 align-text-bottom" />
          )}
        </div>
        {message.created_at && (
          <div
            className={`text-[10px] mt-1 ${
              isUser ? 'text-primary-foreground/60' : 'text-muted-foreground'
            }`}
          >
            {formatTime(message.created_at)}
          </div>
        )}
      </div>
    </div>
  );
});

GuidedChatMessage.displayName = 'GuidedChatMessage';

export default GuidedChatMessage;
