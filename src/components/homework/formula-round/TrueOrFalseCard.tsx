import { memo } from 'react';
import { MathText } from '@/components/kb/ui/MathText';
import type { FormulaQuestion } from '@/lib/formulaEngine/types';

interface TrueOrFalseCardProps {
  question: FormulaQuestion;
  onAnswer: (answer: boolean) => void;
  disabled?: boolean;
}

/**
 * Layer 3 card: "Формула верна?" — student judges if the displayed formula is correct.
 * Returns raw student choice; correctness is determined by FormulaRoundScreen.
 * Does NOT show feedback — that's FeedbackOverlay's job.
 */
export const TrueOrFalseCard = memo(function TrueOrFalseCard({
  question,
  onAnswer,
  disabled = false,
}: TrueOrFalseCardProps) {
  const handleChoice = (selected: boolean) => {
    if (disabled) return;
    onAnswer(selected);
  };

  return (
    <div className="w-full max-w-md space-y-6">
      <div className="bg-white rounded-lg border border-slate-200 p-6 text-center space-y-4">
        <MathText
          text={question.prompt}
          as="p"
          className="text-base font-medium text-slate-700"
        />
        {question.displayFormula && (
          <MathText
            text={question.displayFormula}
            className="text-xl text-slate-900"
          />
        )}
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => handleChoice(true)}
          className="flex-1 py-3 rounded-lg border-2 border-accent text-accent font-medium text-base transition-colors hover:bg-accent hover:text-white disabled:opacity-50"
        >
          Верно
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => handleChoice(false)}
          className="flex-1 py-3 rounded-lg border-2 border-slate-300 text-slate-700 font-medium text-base transition-colors hover:bg-slate-100 disabled:opacity-50"
        >
          Неверно
        </button>
      </div>
    </div>
  );
});
