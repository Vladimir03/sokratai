import { useState } from 'react';
import { StepCard } from './StepCard';
import { MathBlock } from './MathBlock';
import { RichContent } from './RichContent';
import type { Solution } from '@/types/solution';
import { ChevronLeft, ChevronRight, CheckCircle2 } from 'lucide-react';

interface SolutionViewProps {
  solution: Solution;
}

/**
 * Full solution display component with step-by-step navigation
 */
export function SolutionView({ solution }: SolutionViewProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const goToPrevStep = () => {
    setCurrentStep((prev) => Math.max(0, prev - 1));
  };

  const goToNextStep = () => {
    setCurrentStep((prev) => Math.min(solution.steps.length - 1, prev + 1));
  };

  return (
    <div className="max-w-2xl mx-auto pb-8">
      {/* Problem statement */}
      <div
        className="rounded-2xl shadow-elegant p-6 mb-6 animate-fade-in"
        style={{
          backgroundColor: 'var(--tg-theme-bg-color, hsl(var(--card)))',
          borderWidth: '1px',
          borderStyle: 'solid',
          borderColor: 'var(--tg-theme-hint-color, hsl(var(--border)))',
        }}
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="text-2xl">📝</span>
          <h2 className="text-xl font-bold" style={{ color: 'var(--tg-theme-text-color, hsl(var(--foreground)))' }}>
            Задача
          </h2>
        </div>
        <RichContent className="text-base leading-relaxed">
          {solution.problem}
        </RichContent>
        {solution.subject && (
          <div 
            className="mt-4 inline-block px-4 py-2 rounded-full text-sm font-medium"
            style={{
              backgroundColor: 'var(--tg-theme-button-color, hsl(var(--primary)))',
              color: 'var(--tg-theme-button-text-color, hsl(var(--primary-foreground)))',
            }}
          >
            {solution.subject}
          </div>
        )}
      </div>

      {/* Progress indicator */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm font-medium" style={{ color: 'var(--tg-theme-hint-color, hsl(var(--muted-foreground)))' }}>
            Шаг {currentStep + 1} из {solution.steps.length}
          </span>
          <span 
            className="text-sm font-bold"
            style={{ 
              color: 'var(--tg-theme-button-color, hsl(var(--primary)))',
            }}
          >
            {Math.round(((currentStep + 1) / solution.steps.length) * 100)}%
          </span>
        </div>
        <div 
          className="w-full h-3 rounded-full overflow-hidden"
          style={{
            backgroundColor: 'var(--tg-theme-secondary-bg-color, hsl(var(--secondary)))',
          }}
        >
          <div
            className="h-full transition-all duration-500 ease-out rounded-full shadow-glow"
            style={{
              width: `${((currentStep + 1) / solution.steps.length) * 100}%`,
              background: 'var(--gradient-accent)',
            }}
          />
        </div>
      </div>

      {/* Current step */}
      <div className="mb-6">
        <StepCard step={solution.steps[currentStep]} isActive />
      </div>

      {/* Navigation buttons */}
      <div className="flex gap-3 mb-6">
        <button
          onClick={goToPrevStep}
          disabled={currentStep === 0}
          className="flex-1 py-3 px-4 rounded-xl font-medium flex items-center justify-center gap-2 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            backgroundColor: 'var(--tg-theme-secondary-bg-color, hsl(var(--secondary)))',
            color: 'var(--tg-theme-text-color, hsl(var(--foreground)))',
          }}
        >
          <ChevronLeft className="w-5 h-5" />
          Назад
        </button>
        <button
          onClick={goToNextStep}
          disabled={currentStep === solution.steps.length - 1}
          className="flex-1 py-3 px-4 rounded-xl font-medium flex items-center justify-center gap-2 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            backgroundColor: 'var(--tg-theme-button-color, hsl(var(--primary)))',
            color: 'var(--tg-theme-button-text-color, hsl(var(--primary-foreground)))',
          }}
        >
          Далее
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Final answer (visible when on last step) */}
      {currentStep === solution.steps.length - 1 && (
        <div
          className="rounded-2xl shadow-glow p-6 border-2 animate-fade-in"
          style={{
            backgroundColor: 'var(--tg-theme-bg-color, hsl(var(--card)))',
            borderColor: 'var(--tg-theme-button-color, hsl(var(--accent)))',
            background: 'linear-gradient(135deg, var(--tg-theme-bg-color, hsl(var(--card))) 0%, var(--tg-theme-secondary-bg-color, hsl(var(--secondary))) 100%)',
          }}
        >
          <div className="flex items-center gap-3 mb-4">
            <CheckCircle2 
              className="w-7 h-7" 
              style={{ color: 'var(--tg-theme-button-color, hsl(var(--accent)))' }}
            />
            <h3 className="text-xl font-bold" style={{ color: 'var(--tg-theme-text-color, hsl(var(--foreground)))' }}>
              Итоговый ответ
            </h3>
          </div>
          <div 
            className="p-4 rounded-xl"
            style={{
              backgroundColor: 'var(--tg-theme-secondary-bg-color, hsl(var(--secondary)))',
            }}
          >
            <MathBlock>{solution.finalAnswer}</MathBlock>
          </div>
        </div>
      )}

      {/* All steps preview (collapsed) */}
      <div className="mt-10">
        <h3 className="text-lg font-bold mb-5 flex items-center gap-2" style={{ color: 'var(--tg-theme-text-color, hsl(var(--foreground)))' }}>
          <span>🗂️</span>
          Все шаги решения
        </h3>
        <div className="space-y-3">
          {solution.steps.map((step, index) => (
            <button
              key={step.number}
              onClick={() => setCurrentStep(index)}
              className={`w-full text-left p-4 rounded-xl transition-all duration-300 ${
                index === currentStep ? 'shadow-glow scale-[1.02]' : 'hover:shadow-md'
              }`}
              style={{
                backgroundColor: index === currentStep
                  ? 'var(--tg-theme-secondary-bg-color, hsl(var(--secondary)))'
                  : 'var(--tg-theme-bg-color, hsl(var(--card)))',
                borderWidth: index === currentStep ? '2px' : '1px',
                borderStyle: 'solid',
                borderColor: index === currentStep
                  ? 'var(--tg-theme-button-color, hsl(var(--primary)))'
                  : 'var(--tg-theme-hint-color, hsl(var(--border)))',
              }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 shadow-sm transition-all duration-300"
                  style={{
                    backgroundColor: index <= currentStep
                      ? 'var(--tg-theme-button-color, hsl(var(--primary)))'
                      : 'var(--tg-theme-hint-color, hsl(var(--muted)))',
                    color: index <= currentStep
                      ? 'var(--tg-theme-button-text-color, hsl(var(--primary-foreground)))'
                      : 'var(--tg-theme-text-color, hsl(var(--muted-foreground)))',
                  }}
                >
                  {index < currentStep ? '✓' : step.number}
                </div>
                <RichContent 
                  inline 
                  className="text-sm font-medium flex-1"
                >
                  {step.title}
                </RichContent>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
