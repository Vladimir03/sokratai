import { memo, Suspense, lazy, useMemo } from 'react';
import { Heart, AlertTriangle } from 'lucide-react';
import type { RoundResult, Layer } from '@/lib/formulaEngine/types';
import { kinematicsFormulas } from '@/lib/formulaEngine/formulas';

const MathText = lazy(() =>
  import('@/components/kb/ui/MathText').then((m) => ({ default: m.MathText })),
);

const MAX_LIVES = 3;

const LAYER_LABELS: Record<Layer, string> = {
  3: 'путает структуру',
  2: 'не собирает',
  1: 'не узнаёт в задаче',
};

interface RoundResultScreenProps {
  result: RoundResult;
  onRetryErrors: () => void;
  onClose: () => void;
}

/**
 * Result screen shown after round ends (AC-5: lives=0, AC-6: all 10 answered).
 * Displays score, remaining lives, weak formulas with layer descriptions,
 * and retry/close CTAs (AC-8).
 *
 * Layout matches FormulaRoundScreen (fullscreen z-50, bg-slate-50).
 * Design: doc 17 — one primary CTA, Lucide icons, accent palette.
 * GDD §2.3 — wireframe reference.
 */
export const RoundResultScreen = memo(function RoundResultScreen({
  result,
  onRetryErrors,
  onClose,
}: RoundResultScreenProps) {
  const percentage = Math.round((result.score / result.total) * 100);

  const formulaMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of kinematicsFormulas) {
      map.set(f.id, f.formula);
    }
    return map;
  }, []);

  const hasWeakFormulas = result.weakFormulas.length > 0;

  const scoreColor =
    percentage >= 80
      ? 'text-accent'
      : percentage >= 50
        ? 'text-amber-500'
        : 'text-red-500';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-50">
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-8">
        <div className="max-w-md mx-auto space-y-6 animate-in fade-in duration-300">
          {/* Title */}
          <h1 className="text-2xl font-semibold text-slate-900 text-center">
            Раунд завершён!
          </h1>

          {/* Score card */}
          <div className="bg-white rounded-lg border border-slate-200 p-6 space-y-4">
            <div className="text-center">
              <p className={`text-4xl font-bold tabular-nums ${scoreColor}`}>
                {result.score}/{result.total}
              </p>
              <p className="text-sm text-slate-500 mt-1">
                {percentage}% правильных
              </p>
            </div>

            {/* Lives remaining */}
            <div className="flex items-center justify-center gap-2">
              <div className="flex items-center gap-0.5">
                {Array.from({ length: MAX_LIVES }, (_, i) => (
                  <Heart
                    key={i}
                    className={`w-5 h-5 ${
                      i < result.livesRemaining
                        ? 'fill-red-500 text-red-500'
                        : 'fill-slate-200 text-slate-200'
                    }`}
                  />
                ))}
              </div>
              <span className="text-sm text-slate-500">
                Осталось жизней: {result.livesRemaining}
              </span>
            </div>
          </div>

          {/* Weak formulas list */}
          {hasWeakFormulas && (
            <div className="space-y-3">
              <h2 className="text-base font-medium text-slate-700">
                Проблемные формулы:
              </h2>
              <div className="space-y-2">
                {result.weakFormulas.map((wf) => {
                  const latex = formulaMap.get(wf.formulaId);
                  return (
                    <div
                      key={wf.formulaId}
                      className="flex items-start gap-3 bg-white rounded-lg border border-slate-200 px-4 py-3"
                    >
                      <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        {latex ? (
                          <Suspense
                            fallback={
                              <span className="text-sm font-medium text-slate-800">
                                {latex}
                              </span>
                            }
                          >
                            <MathText
                              text={`$${latex}$`}
                              className="text-sm font-medium text-slate-800"
                            />
                          </Suspense>
                        ) : (
                          <span className="text-sm font-medium text-slate-800">
                            {wf.formulaId}
                          </span>
                        )}
                        <p className="text-sm text-slate-500">
                          {LAYER_LABELS[wf.weakLayer]}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="px-4 py-4 bg-white border-t border-slate-200">
        <div className="max-w-md mx-auto flex gap-3">
          {hasWeakFormulas && (
            <button
              type="button"
              onClick={onRetryErrors}
              className="flex-1 py-3 rounded-lg bg-accent text-white font-medium text-base transition-colors hover:bg-accent/90"
            >
              Повторить ошибки
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className={`py-3 rounded-lg border border-slate-200 bg-white text-slate-700 font-medium text-base transition-colors hover:bg-slate-50 ${
              hasWeakFormulas ? 'flex-1' : 'w-full'
            }`}
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
});
