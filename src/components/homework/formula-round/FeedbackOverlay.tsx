import { CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface FeedbackOverlayProps {
  isCorrect: boolean;
  explanation: string;
  livesLost: number;
  onContinue: () => void;
}

export function FeedbackOverlay({
  isCorrect,
  explanation,
  livesLost,
  onContinue,
}: FeedbackOverlayProps) {
  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-[60] rounded-t-2xl px-5 py-5 shadow-lg border-t ${
        isCorrect
          ? 'bg-green-50 border-green-200'
          : 'bg-red-50 border-red-200'
      }`}
    >
      <div className="flex items-start gap-3 max-w-lg mx-auto">
        {isCorrect ? (
          <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
        ) : (
          <XCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <p
            className={`text-sm font-semibold ${
              isCorrect ? 'text-green-800' : 'text-red-800'
            }`}
          >
            {isCorrect ? 'Верно!' : 'Неверно'}
            {!isCorrect && livesLost > 0 && ` (−${livesLost} ❤️)`}
          </p>
          <p
            className={`text-sm mt-1 whitespace-pre-line ${
              isCorrect ? 'text-green-700' : 'text-red-700'
            }`}
          >
            {explanation}
          </p>
        </div>
      </div>
      <Button
        className="w-full mt-4 max-w-lg mx-auto block"
        variant={isCorrect ? 'default' : 'destructive'}
        onClick={onContinue}
      >
        Продолжить
      </Button>
    </div>
  );
}
