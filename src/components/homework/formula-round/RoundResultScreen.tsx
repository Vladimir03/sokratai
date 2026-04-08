import { memo, Suspense, lazy, useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { RoundResult, Layer } from '@/lib/formulaEngine/types';
import { kinematicsFormulas } from '@/lib/formulaEngine/formulas';

const MathText = lazy(() =>
  import('@/components/kb/ui/MathText').then((m) => ({ default: m.MathText })),
);

const LAYER_LABELS: Record<Layer, string> = {
  3: 'путает структуру',
  2: 'не собирает',
  1: 'не узнаёт в задаче',
};

interface RoundResultScreenProps {
  result: RoundResult;
  onRetryWrong: () => void;
  onExit: () => void;
}

/**
 * Result screen shown after round ends. Displays score, weak formulas
 * with layer descriptions, and retry/exit CTAs.
 *
 * Phase 1 standalone trainer: no lives display. One primary CTA
 * («Пройти ещё раз», only when weakFormulas > 0) + «Назад» per doc 17
 * and design system rules.
 */
export const RoundResultScreen = memo(function RoundResultScreen({
  result,
  onRetryWrong,
  onExit,
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
          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <div className="text-center">
              <p className={`text-4xl font-bold tabular-nums ${scoreColor}`}>
                {result.score}/{result.total}
              </p>
              <p className="text-sm text-slate-500 mt-1">
                {percentage}% правильных
              </p>
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
              onClick={onRetryWrong}
              className="flex-1 py-3 rounded-lg bg-accent text-white font-medium text-base transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
              style={{ touchAction: 'manipulation' }}
            >
              Пройти ещё раз
            </button>
          )}
          <button
            type="button"
            onClick={onExit}
            className={`py-3 rounded-lg border border-slate-200 bg-white text-slate-700 font-medium text-base transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 ${
              hasWeakFormulas ? 'flex-1' : 'w-full'
            }`}
            style={{ touchAction: 'manipulation' }}
          >
            Назад
          </button>
        </div>
      </div>
    </div>
  );
});
