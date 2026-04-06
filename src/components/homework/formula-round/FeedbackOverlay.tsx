import { memo, Suspense, lazy } from 'react';
import { Heart } from 'lucide-react';

const MathText = lazy(() =>
  import('@/components/kb/ui/MathText').then((m) => ({ default: m.MathText })),
);

interface FeedbackOverlayProps {
  isCorrect: boolean;
  explanation: string;
  livesLost: 0 | 1;
  onContinue: () => void;
}

/**
 * Feedback overlay shown after every answer (GDD §7.1: feedback ALWAYS).
 *
 * Correct: green background, "Верно!" + explanation (≤2 lines).
 * Incorrect: red background, "Неверно" + explanation (2-4 lines) + lives lost.
 *
 * "Далее →" button = secondary (doc 17: answer button is primary CTA,
 * navigation is secondary).
 */
export const FeedbackOverlay = memo(function FeedbackOverlay({
  isCorrect,
  explanation,
  livesLost,
  onContinue,
}: FeedbackOverlayProps) {
  return (
    <div
      className={`absolute inset-x-0 bottom-0 px-4 py-5 border-t animate-in slide-in-from-bottom-4 duration-200 ${
        isCorrect
          ? 'bg-green-50 border-green-200'
          : 'bg-red-50 border-red-200'
      }`}
    >
      <div className="max-w-md mx-auto space-y-3">
        {/* Header: verdict + lives lost */}
        <div className="flex items-center justify-between">
          <span
            className={`text-base font-semibold ${
              isCorrect ? 'text-green-700' : 'text-red-600'
            }`}
          >
            {isCorrect ? '\u2713 \u0412\u0435\u0440\u043D\u043E!' : '\u2717 \u041D\u0435\u0432\u0435\u0440\u043D\u043E'}
          </span>

          {!isCorrect && livesLost > 0 && (
            <span className="flex items-center gap-1 text-sm font-medium text-red-500">
              <Heart className="w-4 h-4 fill-red-500 text-red-500" />
              <span>&minus;{livesLost}</span>
            </span>
          )}
        </div>

        {/* Explanation — MathText for formulas in feedback (GDD §7.2) */}
        <Suspense
          fallback={
            <p className="text-sm text-slate-600 whitespace-pre-wrap">
              {explanation}
            </p>
          }
        >
          <MathText
            text={explanation}
            className={`text-sm leading-relaxed ${
              isCorrect ? 'text-green-800' : 'text-red-800'
            }`}
          />
        </Suspense>

        {/* "Далее →" = secondary button (doc 17: one primary CTA per screen) */}
        <button
          type="button"
          onClick={onContinue}
          className="w-full py-3 rounded-md border border-slate-200 bg-white text-slate-800 font-medium text-base transition-colors hover:bg-slate-50"
        >
          {'\u0414\u0430\u043B\u0435\u0435 \u2192'}
        </button>
      </div>
    </div>
  );
});
