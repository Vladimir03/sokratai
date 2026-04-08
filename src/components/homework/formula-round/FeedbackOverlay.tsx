import { memo, Suspense, lazy } from 'react';
import { AlertTriangle, Lightbulb, CheckCircle2, Sparkles } from 'lucide-react';

const MathText = lazy(() =>
  import('@/components/kb/ui/MathText').then((m) => ({ default: m.MathText })),
);

interface FeedbackOverlayProps {
  isCorrect: boolean;
  canonicalLatex: string;
  questionLatex: string | null;
  userAnswerLatex: string | null;
  reasoning: string;
  trap: string;
  onContinue: () => void;
}

/**
 * Feedback overlay with 4-block structure (PART D v2 overhaul).
 *
 * Block 1: Canonical LaTeX formula (centered, large)
 * Block 2: User's answer or verdict
 * Block 3: Reasoning (💡 icon for reasoning, or sparkles for memorization tips)
 * Block 4: Trap/Tip (⚠️ for incorrect, ✨ for correct)
 */
export const FeedbackOverlay = memo(function FeedbackOverlay({
  isCorrect,
  canonicalLatex,
  questionLatex,
  userAnswerLatex,
  reasoning,
  trap,
  onContinue,
}: FeedbackOverlayProps) {
  const bgColor = isCorrect ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200';
  const titleColor = isCorrect ? 'text-emerald-700' : 'text-red-700';
  const cardBg = 'bg-white border border-slate-200 rounded-lg p-3';
  const trapBg = isCorrect ? 'bg-emerald-50' : 'bg-amber-50';

  return (
    <div
      className={`absolute inset-x-0 bottom-0 px-4 py-5 border-t animate-in slide-in-from-bottom-4 duration-200 ${bgColor}`}
    >
      <div className="max-w-md mx-auto space-y-3">
        {/* Title */}
        <h2 className={`text-base font-semibold ${titleColor}`}>
          {isCorrect ? '✓ Верно!' : '✗ Неверно'}
        </h2>

        {questionLatex && questionLatex !== canonicalLatex && (
          <div className={cardBg}>
            <p className="text-xs font-medium text-slate-500 mb-1">
              В задании было:
            </p>
            <Suspense fallback={<span className="text-sm text-slate-700">{questionLatex}</span>}>
              <div className="text-center">
                <MathText text={`$${questionLatex}$`} className="text-lg text-slate-900" />
              </div>
            </Suspense>
          </div>
        )}

        {/* Block 1: Canonical LaTeX formula */}
        <div className={cardBg}>
          <p className="text-xs font-medium text-slate-500 mb-1">
            Правильная формула:
          </p>
          <Suspense fallback={<span className="text-sm text-slate-700">{canonicalLatex}</span>}>
            <div className="text-center">
              <MathText text={`$${canonicalLatex}$`} className="text-lg text-slate-900" />
            </div>
          </Suspense>
        </div>

        {/* Block 2: User's answer */}
        <div className={cardBg}>
          <p className="text-xs font-medium text-slate-500 mb-1">Твой ответ:</p>
          {userAnswerLatex === 'верно' || userAnswerLatex === 'неверно' ? (
            <p className="text-sm text-slate-700">{userAnswerLatex}</p>
          ) : userAnswerLatex ? (
            <Suspense fallback={<span className="text-sm text-slate-700">{userAnswerLatex}</span>}>
              <MathText text={`$${userAnswerLatex}$`} className="text-sm text-slate-700" />
            </Suspense>
          ) : (
            <p className="text-sm text-slate-500">✓ Собрано верно</p>
          )}
        </div>

        {/* Block 3: Reasoning */}
        <div className={cardBg}>
          <div className="flex items-start gap-2">
            {isCorrect ? (
              <Lightbulb className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <Lightbulb className="w-4 h-4 text-slate-600 shrink-0 mt-0.5" />
            )}
            <div>
              <p className="text-xs font-medium text-slate-500 mb-0.5">
                Как рассуждать:
              </p>
              <Suspense fallback={<span className="text-sm text-slate-700">{reasoning}</span>}>
                <MathText text={reasoning} className="text-sm text-slate-700" />
              </Suspense>
            </div>
          </div>
        </div>

        {/* Block 4: Trap/Tip */}
        <div className={`${cardBg} ${trapBg}`}>
          <div className="flex items-start gap-2">
            {isCorrect ? (
              <Sparkles className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            )}
            <div>
              <p className="text-xs font-medium text-slate-600 mb-0.5">
                {isCorrect ? 'Запомни:' : 'Частая ловушка:'}
              </p>
              <Suspense fallback={<span className="text-sm text-slate-700">{trap}</span>}>
                <MathText text={trap} className="text-sm text-slate-700" />
              </Suspense>
            </div>
          </div>
        </div>

        {/* Continue button */}
        <button
          type="button"
          onClick={onContinue}
          className="w-full py-3 rounded-lg border border-slate-200 bg-white text-slate-700 font-medium text-base transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
        >
          Далее →
        </button>
      </div>
    </div>
  );
});
