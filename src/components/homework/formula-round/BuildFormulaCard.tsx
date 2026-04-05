import { memo, useState, useMemo, useCallback } from 'react';
import { MathText } from '@/components/kb/ui/MathText';
import type { FormulaQuestion, BuildFormulaAnswer } from '@/lib/formulaEngine/types';

interface BuildFormulaCardProps {
  question: FormulaQuestion;
  onAnswer: (answer: BuildFormulaAnswer) => void;
}

/**
 * Layer 2 card: "Собери формулу" — student assembles a formula from token blocks.
 *
 * GDD §4.5: tap-to-select (mobile-first, no drag-and-drop).
 * Tap pool token → two placement buttons appear (Числитель / Знаменатель).
 * Tap placed token → returns to pool.
 * "Проверить" compares placed tokens (numerator ∪ denominator) with correctAnswer.
 * AC-9 (P1): assembled formula rendered via MathText.
 *
 * Does NOT show feedback — that's FeedbackOverlay's job.
 */
const BuildFormulaCard = memo(function BuildFormulaCard({
  question,
  onAnswer,
}: BuildFormulaCardProps) {
  const [numerator, setNumerator] = useState<string[]>([]);
  const [denominator, setDenominator] = useState<string[]>([]);
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Pool = options minus placed tokens
  const pool = useMemo(() => {
    const placed = new Set([...numerator, ...denominator]);
    return (question.options ?? []).filter((t) => !placed.has(t));
  }, [question.options, numerator, denominator]);

  const handlePoolTap = useCallback((token: string) => {
    if (submitted) return;
    setSelectedToken((prev) => (prev === token ? null : token));
  }, [submitted]);

  const placeToken = useCallback((zone: 'numerator' | 'denominator') => {
    if (!selectedToken || submitted) return;
    if (zone === 'numerator') {
      setNumerator((prev) => [...prev, selectedToken]);
    } else {
      setDenominator((prev) => [...prev, selectedToken]);
    }
    setSelectedToken(null);
  }, [selectedToken, submitted]);

  const removeToken = useCallback((token: string, zone: 'numerator' | 'denominator') => {
    if (submitted) return;
    if (zone === 'numerator') {
      setNumerator((prev) => prev.filter((t) => t !== token));
    } else {
      setDenominator((prev) => prev.filter((t) => t !== token));
    }
  }, [submitted]);

  // Build LaTeX preview from placed tokens (AC-9)
  const assembledLatex = useMemo(() => {
    if (numerator.length === 0 && denominator.length === 0) return null;
    const numStr = numerator.length > 0
      ? numerator.join(' \\cdot ')
      : '';
    const denStr = denominator.length > 0
      ? denominator.join(' \\cdot ')
      : '';

    if (denStr && numStr) return `$\\frac{${numStr}}{${denStr}}$`;
    if (denStr) return `$\\frac{1}{${denStr}}$`;
    return `$${numStr}$`;
  }, [numerator, denominator]);

  const hasTokensPlaced = numerator.length > 0 || denominator.length > 0;

  const handleCheck = useCallback(() => {
    if (submitted) return;
    setSubmitted(true);
    setSelectedToken(null);
    onAnswer({ numerator, denominator });
  }, [submitted, numerator, denominator, onAnswer]);

  return (
    <div className="w-full max-w-md space-y-5">
      {/* Prompt */}
      <div className="bg-white rounded-lg border border-slate-200 p-5 space-y-4">
        <p className="text-base font-medium text-slate-700">
          {question.prompt}
        </p>

        {/* Token pool */}
        <div className="flex flex-wrap gap-2 justify-center">
          {pool.map((token) => (
            <button
              key={token}
              type="button"
              disabled={submitted}
              onClick={() => handlePoolTap(token)}
              className={`px-3 py-2 rounded-lg border-2 text-base font-medium transition-colors ${
                selectedToken === token
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-slate-200 text-slate-700 hover:border-slate-300'
              } disabled:opacity-50`}
              style={{ touchAction: 'manipulation' }}
            >
              <MathText text={`$${token}$`} as="span" />
            </button>
          ))}
          {pool.length === 0 && hasTokensPlaced && (
            <p className="text-sm text-slate-400">Все элементы размещены</p>
          )}
        </div>

        {/* Placement buttons — visible when token selected */}
        {selectedToken && !submitted && (
          <div className="flex gap-2 justify-center animate-in fade-in duration-150">
            <button
              type="button"
              onClick={() => placeToken('numerator')}
              className="px-4 py-2 rounded-lg border border-accent text-accent text-sm font-medium transition-colors hover:bg-accent/5 active:bg-accent/10"
              style={{ touchAction: 'manipulation' }}
            >
              В числитель
            </button>
            <button
              type="button"
              onClick={() => placeToken('denominator')}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-medium transition-colors hover:bg-slate-50 active:bg-slate-100"
              style={{ touchAction: 'manipulation' }}
            >
              В знаменатель
            </button>
          </div>
        )}
      </div>

      {/* Assembly zones */}
      <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
        {/* Numerator */}
        <div className="min-h-[44px]">
          <p className="text-xs font-medium text-slate-400 mb-1.5">Числитель</p>
          <div className="flex flex-wrap gap-1.5">
            {numerator.length > 0 ? (
              numerator.map((token) => (
                <button
                  key={token}
                  type="button"
                  disabled={submitted}
                  onClick={() => removeToken(token, 'numerator')}
                  className="px-3 py-1.5 rounded-md bg-accent/10 border border-accent/30 text-accent text-sm font-medium transition-colors hover:bg-accent/20 disabled:opacity-50"
                  style={{ touchAction: 'manipulation' }}
                >
                  <MathText text={`$${token}$`} as="span" />
                </button>
              ))
            ) : (
              <span className="text-sm text-slate-300 py-1.5">—</span>
            )}
          </div>
        </div>

        {/* Fraction bar */}
        <div className="border-t-2 border-slate-300" />

        {/* Denominator */}
        <div className="min-h-[44px]">
          <p className="text-xs font-medium text-slate-400 mb-1.5">Знаменатель</p>
          <div className="flex flex-wrap gap-1.5">
            {denominator.length > 0 ? (
              denominator.map((token) => (
                <button
                  key={token}
                  type="button"
                  disabled={submitted}
                  onClick={() => removeToken(token, 'denominator')}
                  className="px-3 py-1.5 rounded-md bg-slate-100 border border-slate-300 text-slate-600 text-sm font-medium transition-colors hover:bg-slate-200 disabled:opacity-50"
                  style={{ touchAction: 'manipulation' }}
                >
                  <MathText text={`$${token}$`} as="span" />
                </button>
              ))
            ) : (
              <span className="text-sm text-slate-300 py-1.5">—</span>
            )}
          </div>
        </div>

        {/* Assembled formula preview (AC-9) */}
        {assembledLatex && (
          <div className="pt-2 border-t border-slate-100 text-center">
            <MathText
              text={assembledLatex}
              className="text-lg text-slate-900"
            />
          </div>
        )}
      </div>

      {/* Check button */}
      <button
        type="button"
        disabled={submitted || !hasTokensPlaced}
        onClick={handleCheck}
        className="w-full py-3 rounded-lg bg-accent text-white font-medium text-base transition-colors hover:bg-accent/90 disabled:opacity-50"
        style={{ touchAction: 'manipulation' }}
      >
        Проверить
      </button>
    </div>
  );
});

export { BuildFormulaCard };
