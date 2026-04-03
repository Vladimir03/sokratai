import { memo } from 'react';
import { MathBlock } from './MathBlock';
import { RichContent } from './RichContent';
import type { SolutionStep } from '@/types/solution';

interface StepCardProps {
  step: SolutionStep;
  isActive?: boolean;
}

/**
 * Individual solution step card component with rich markdown and LaTeX rendering
 */
export const StepCard = memo(function StepCard({ step, isActive = false }: StepCardProps) {
  return (
    <div
      className={`
        rounded-2xl shadow-elegant p-6 mb-6 transition-all duration-300 animate-fade-in
        ${isActive ? 'shadow-glow' : ''}
      `}
      style={{
        backgroundColor: isActive 
          ? 'var(--tg-theme-secondary-bg-color, hsl(var(--card)))'
          : 'var(--tg-theme-bg-color, hsl(var(--card)))',
        borderWidth: isActive ? '2px' : '1px',
        borderStyle: 'solid',
        borderColor: isActive 
          ? 'var(--tg-theme-button-color, hsl(var(--primary)))'
          : 'var(--tg-theme-hint-color, hsl(var(--border)))',
      }}
    >
      {/* Step number and title */}
      <div className="flex items-center gap-3 mb-5">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shadow-md"
          style={{
            backgroundColor: 'var(--tg-theme-button-color, hsl(var(--primary)))',
            color: 'var(--tg-theme-button-text-color, hsl(var(--primary-foreground)))',
          }}
        >
          {step.number}
        </div>
        <h3 className="text-lg font-bold flex-1">
          <RichContent inline style={{ color: 'var(--tg-theme-text-color, hsl(var(--foreground)))' }}>
            {step.title}
          </RichContent>
        </h3>
      </div>

      {/* Content with rich markdown/LaTeX rendering */}
      <RichContent className="mb-5 text-base">
        {step.content}
      </RichContent>

      {/* Formula (display mode) */}
      {step.formula && (
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xl">📐</span>
            <span className="text-sm font-medium" style={{ color: 'var(--tg-theme-hint-color, hsl(var(--muted-foreground)))' }}>
              Формула:
            </span>
          </div>
          <MathBlock>{step.formula}</MathBlock>
        </div>
      )}

      {/* Method description */}
      {step.method && (
        <div 
          className="mt-5 p-4 rounded-xl shadow-sm"
          style={{
            backgroundColor: 'var(--tg-theme-secondary-bg-color, hsl(var(--secondary)))',
            borderLeft: '4px solid',
            borderLeftColor: 'var(--tg-theme-button-color, hsl(var(--accent)))',
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xl">💡</span>
            <p className="text-sm font-bold" style={{ color: 'var(--tg-theme-text-color, hsl(var(--foreground)))' }}>
              Метод:
            </p>
          </div>
          <RichContent className="text-sm">
            {step.method}
          </RichContent>
        </div>
      )}
    </div>
  );
});
