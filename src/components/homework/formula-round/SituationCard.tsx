import { memo, useMemo, Suspense } from 'react';
import { MathText } from '@/components/kb/ui/MathText';
import type { FormulaQuestion } from '@/lib/formulaEngine/types';

interface SituationCardProps {
  question: FormulaQuestion;
  onAnswer: (answer: string) => void;
}

/**
 * Layer 1 card: "Ситуация → Формула".
 * Shows a situation text (from whenToUse, no numbers) and 4 formula options.
 * Returns selected option string; correctness is determined by FormulaRoundScreen.
 *
 * GDD §4.8: description WITHOUT numbers, 4 options (correct + 3 distractors).
 * Options are already shuffled by questionGenerator.
 * AC-9 (P1): all 4 formulas rendered via MathText.
 * Bug fix: situation prompt text may contain LaTeX, rendered via MathText with Suspense.
 */
const SituationCard = memo(function SituationCard({ question, onAnswer }: SituationCardProps) {
  // Options come pre-shuffled from the generator, but re-shuffle on mount
  // to guarantee the correct answer isn't in a predictable position across renders
  const shuffledOptions = useMemo(() => {
    if (!question.options) return [];
    const arr = [...question.options];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  // Shuffle once per question id
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id]);

  const handleOptionClick = (option: string) => {
    onAnswer(option);
  };

  return (
    <div className="w-full max-w-md space-y-6">
      {/* Situation prompt */}
      <div className="bg-white rounded-lg border border-slate-200 p-6 space-y-3">
        <p className="text-sm font-medium text-slate-500">
          Какую формулу использовать?
        </p>
        <Suspense fallback={<p className="text-base text-slate-900 whitespace-pre-wrap">{question.prompt}</p>}>
          <MathText text={question.prompt} className="text-base text-slate-900 whitespace-pre-wrap" />
        </Suspense>
      </div>

      {/* Formula options */}
      <div className="space-y-2">
        {shuffledOptions.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => handleOptionClick(option)}
            className="w-full py-3 px-4 rounded-lg border border-slate-200 bg-white text-left text-base text-slate-700 transition-colors hover:border-accent hover:bg-accent/5 active:bg-accent/10"
            style={{ touchAction: 'manipulation' }}
          >
            <MathText text={option} as="span" />
          </button>
        ))}
      </div>
    </div>
  );
});

export { SituationCard };
