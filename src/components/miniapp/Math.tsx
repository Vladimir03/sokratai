import { useEffect, useRef } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface MathProps {
  children: string;
  inline?: boolean;
  className?: string;
}

/**
 * Math component for rendering LaTeX formulas inline
 */
export function Math({ children, inline = true, className = '' }: MathProps) {
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (containerRef.current && children) {
      try {
        katex.render(children, containerRef.current, {
          displayMode: !inline,
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
  }, [children, inline]);

  return (
    <span
      ref={containerRef}
      className={`${inline ? 'inline-block' : 'block'} ${className}`}
      style={{ fontSize: inline ? '1em' : '1.2em' }}
    />
  );
}
