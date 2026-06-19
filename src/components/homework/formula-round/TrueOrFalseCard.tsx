import { memo } from 'react';
import { MathText } from '@/components/kb/ui/MathText';
import { getFormulaById } from '@/lib/formulaEngine/formulas';
import type { FormulaQuestion } from '@/lib/formulaEngine/types';
import { FormulaHintPanel } from './FormulaHintPanel';

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

  const formula = getFormulaById(question.formulaId);

  return (
    <div className="w-full max-w-md space-y-4">
      <div className="bg-white rounded-lg border border-slate-200 p-6 text-center space-y-4">
        {formula?.name && (
          <p className="text-xs font-medium text-slate-400">{formula.name}</p>
        )}
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
      {/* Подсказка по желанию: только величины — «как рассуждать» спойлит ответ (req 7) */}
      {formula && formula.variables.length > 0 && (
        <FormulaHintPanel variables={formula.variables} />
      )}
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
