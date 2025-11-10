import { Math } from './Math';
import { MathBlock } from './MathBlock';
import type { SolutionStep } from '@/types/solution';

interface StepCardProps {
  step: SolutionStep;
  isActive?: boolean;
}

/**
 * Individual solution step card component
 */
export function StepCard({ step, isActive = false }: StepCardProps) {
  return (
    <div
      className={`
        rounded-2xl shadow-sm p-6 mb-4 transition-all duration-300
        ${isActive ? 'bg-primary/5 border-2 border-primary' : 'bg-card border border-border'}
      `}
      style={{
        backgroundColor: isActive 
          ? 'var(--tg-theme-secondary-bg-color, hsl(var(--card)))'
          : 'var(--tg-theme-bg-color, hsl(var(--card)))',
      }}
    >
      {/* Step number */}
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
          style={{
            backgroundColor: 'var(--tg-theme-button-color, hsl(var(--primary)))',
            color: 'var(--tg-theme-button-text-color, hsl(var(--primary-foreground)))',
          }}
        >
          {step.number}
        </div>
        <h3 className="text-lg font-bold" style={{ color: 'var(--tg-theme-text-color, hsl(var(--foreground)))' }}>
          {step.title}
        </h3>
      </div>

      {/* Content */}
      <div className="mb-4 text-base leading-relaxed" style={{ color: 'var(--tg-theme-text-color, hsl(var(--foreground)))' }}>
        {step.content}
      </div>

      {/* Formula (display mode) */}
      {step.formula && (
        <MathBlock>{step.formula}</MathBlock>
      )}

      {/* Method description */}
      {step.method && (
        <div className="mt-4 p-3 bg-accent/20 rounded-lg">
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--tg-theme-hint-color, hsl(var(--muted-foreground)))' }}>
            💡 Метод:
          </p>
          <p className="text-sm" style={{ color: 'var(--tg-theme-text-color, hsl(var(--foreground)))' }}>
            {step.method}
          </p>
        </div>
      )}
    </div>
  );
}
