import { memo, useState, useMemo, useCallback } from 'react';
import { MathText } from '@/components/kb/ui/MathText';
import type { FormulaQuestion, BuildFormulaAnswer } from '@/lib/formulaEngine/types';
import { joinTokensWithOperators } from '@/lib/formulaEngine/questionGenerator';
import { getFormulaById } from '@/lib/formulaEngine/formulas';
import { FormulaHintPanel } from './FormulaHintPanel';

interface BuildFormulaCardProps {
  question: FormulaQuestion;
  onAnswer: (answer: BuildFormulaAnswer) => void;
}

/**
 * Один вариант пула = instance с уникальным `key`. Это позволяет размещать
 * повторяющиеся токены независимо — формула вида `A + B + C` нуждается в ДВУХ
 * токенах `+`, а сравнение по значению (Set) их бы схлопнуло.
 */
interface TokenInstance {
  key: string;
  token: string;
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
  const [numerator, setNumerator] = useState<TokenInstance[]>([]);
  const [denominator, setDenominator] = useState<TokenInstance[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const formula = getFormulaById(question.formulaId);

  // Каждый вариант пула — отдельный instance с уникальным key (по позиции),
  // чтобы повторяющиеся токены (напр. два `+`) размещались независимо.
  const optionInstances = useMemo<TokenInstance[]>(
    () => (question.options ?? []).map((token, index) => ({ key: `${index}::${token}`, token })),
    [question.options],
  );

  const placedKeys = useMemo(
    () => new Set([...numerator, ...denominator].map((inst) => inst.key)),
    [numerator, denominator],
  );

  // Pool = instances minus placed ones.
  const pool = useMemo(
    () => optionInstances.filter((inst) => !placedKeys.has(inst.key)),
    [optionInstances, placedKeys],
  );

  const handlePoolTap = useCallback((key: string) => {
    if (submitted) return;
    setSelectedKey((prev) => (prev === key ? null : key));
  }, [submitted]);

  const placeToken = useCallback((zone: 'numerator' | 'denominator') => {
    if (!selectedKey || submitted) return;
    const inst = optionInstances.find((i) => i.key === selectedKey);
    if (!inst) return;
    if (zone === 'numerator') {
      setNumerator((prev) => [...prev, inst]);
    } else {
      setDenominator((prev) => [...prev, inst]);
    }
    setSelectedKey(null);
  }, [selectedKey, submitted, optionInstances]);

  const removeToken = useCallback((key: string, zone: 'numerator' | 'denominator') => {
    if (submitted) return;
    if (zone === 'numerator') {
      setNumerator((prev) => prev.filter((inst) => inst.key !== key));
    } else {
      setDenominator((prev) => prev.filter((inst) => inst.key !== key));
    }
  }, [submitted]);

  const leftSideLatex = useMemo(() => {
    if (!question.displayFormula) {
      return null;
    }

    const unwrapped = question.displayFormula
      .replace(/^\\\(/u, '')
      .replace(/\\\)$/u, '');

    if (!unwrapped.includes('=')) {
      return null;
    }

    const [leftSide] = unwrapped.split('=');
    return `${leftSide.trim()} =`;
  }, [question.displayFormula]);

  // Build LaTeX preview from placed tokens (AC-9).
  // Использует joinTokensWithOperators — между операторами (+/−) ставится
  // пробел, между множителями — неявный `\\cdot`.
  const assembledLatex = useMemo(() => {
    if (numerator.length === 0 && denominator.length === 0) return null;
    const numStr = joinTokensWithOperators(numerator.map((inst) => inst.token));
    const denStr = joinTokensWithOperators(denominator.map((inst) => inst.token));

    let rightSide = '';
    if (denStr && numStr) {
      rightSide = `\\frac{${numStr}}{${denStr}}`;
    } else if (denStr) {
      rightSide = `\\frac{1}{${denStr}}`;
    } else {
      rightSide = numStr;
    }

    return leftSideLatex
      ? `$${leftSideLatex} ${rightSide}$`
      : `$${rightSide}$`;
  }, [leftSideLatex, numerator, denominator]);

  const hasTokensPlaced = numerator.length > 0 || denominator.length > 0;

  const handleCheck = useCallback(() => {
    if (submitted) return;
    setSubmitted(true);
    setSelectedKey(null);
    onAnswer({
      numerator: numerator.map((inst) => inst.token),
      denominator: denominator.map((inst) => inst.token),
    });
  }, [submitted, numerator, denominator, onAnswer]);

  return (
    <div className="w-full max-w-md space-y-5">
      {/* Prompt */}
      <div className="bg-white rounded-lg border border-slate-200 p-5 space-y-4">
        <div>
          <MathText
            text={question.prompt}
            as="p"
            className="text-base font-medium text-slate-900"
          />
          <p className="text-sm text-slate-500 mt-1">
            Собери правую часть формулы
          </p>
          {leftSideLatex && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs font-medium text-slate-500 mb-1">
                Нужно получить
              </p>
              <MathText text={`$${leftSideLatex}$`} className="text-lg text-slate-900" />
            </div>
          )}
        </div>

        {/* Token pool */}
        <div className="flex flex-wrap gap-2 justify-center">
          {pool.map((inst) => (
            <button
              key={inst.key}
              type="button"
              disabled={submitted}
              onClick={() => handlePoolTap(inst.key)}
              className={`px-3 py-2 rounded-lg border-2 text-base font-medium transition-colors ${
                selectedKey === inst.key
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-slate-200 text-slate-700 hover:border-slate-300'
              } disabled:opacity-50`}
              style={{ touchAction: 'manipulation' }}
            >
              <MathText text={`$${inst.token}$`} as="span" />
            </button>
          ))}
          {pool.length === 0 && hasTokensPlaced && (
            <p className="text-sm text-slate-400">Все элементы размещены</p>
          )}
        </div>

        {/* Case-collision легенда: показывается когда в пуле есть два
            токена одной буквы разного регистра (T/t, N/n и т.п.) — чтобы
            ученик не спутал похожие символы. */}
        {question.tokenLegend && question.tokenLegend.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-amber-50/60 px-3 py-2 space-y-1">
            {question.tokenLegend.map(({ token, label }) => (
              <div key={token} className="flex items-baseline gap-2 text-xs text-slate-700">
                <MathText text={`$${token}$`} as="span" className="font-medium" />
                <span>— {label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Placement buttons — visible when token selected */}
        {selectedKey && !submitted && (
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

      {/* Подсказки по желанию: величины + как рассуждать (req 5/7) */}
      {formula && (formula.variables.length > 0 || formula.physicalMeaning) && (
        <FormulaHintPanel
          variables={formula.variables}
          reasoning={formula.physicalMeaning}
        />
      )}

      {/* Assembly zones */}
      <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
        {/* Numerator */}
        <div className="min-h-[44px]">
          <p className="text-xs font-medium text-slate-400 mb-1.5">Числитель</p>
          <div className="flex flex-wrap gap-1.5">
            {numerator.length > 0 ? (
              numerator.map((inst) => (
                <button
                  key={inst.key}
                  type="button"
                  disabled={submitted}
                  onClick={() => removeToken(inst.key, 'numerator')}
                  className="px-3 py-1.5 rounded-md bg-accent/10 border border-accent/30 text-accent text-sm font-medium transition-colors hover:bg-accent/20 disabled:opacity-50"
                  style={{ touchAction: 'manipulation' }}
                >
                  <MathText text={`$${inst.token}$`} as="span" />
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
              denominator.map((inst) => (
                <button
                  key={inst.key}
                  type="button"
                  disabled={submitted}
                  onClick={() => removeToken(inst.key, 'denominator')}
                  className="px-3 py-1.5 rounded-md bg-slate-100 border border-slate-300 text-slate-600 text-sm font-medium transition-colors hover:bg-slate-200 disabled:opacity-50"
                  style={{ touchAction: 'manipulation' }}
                >
                  <MathText text={`$${inst.token}$`} as="span" />
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
