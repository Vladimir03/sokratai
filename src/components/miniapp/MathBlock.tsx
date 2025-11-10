import { useEffect, useRef } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface MathBlockProps {
  children: string;
  className?: string;
}

/**
 * MathBlock component for rendering LaTeX formulas in display mode
 */
export function MathBlock({ children, className = '' }: MathBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current && children) {
      try {
        katex.render(children, containerRef.current, {
          displayMode: true,
          throwOnError: false,
          output: 'html',
          trust: true,
        });
      } catch (error) {
        console.error('KaTeX rendering error:', error);
        if (containerRef.current) {
          containerRef.current.textContent = children;
        }
      }
    }
  }, [children]);

  return (
    <div
      ref={containerRef}
      className={`my-4 p-4 bg-secondary/10 rounded-lg overflow-x-auto ${className}`}
      style={{ fontSize: '1.2em' }}
    />
  );
}
