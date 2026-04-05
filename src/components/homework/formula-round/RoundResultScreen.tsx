import { Trophy, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { RoundResult } from '@/lib/formulaEngine/types';

interface RoundResultScreenProps {
  result: RoundResult;
  onRetryErrors: () => void;
  onClose: () => void;
}

export function RoundResultScreen({ result, onRetryErrors, onClose }: RoundResultScreenProps) {
  const percent = result.total > 0 ? Math.round((result.score / result.total) * 100) : 0;
  const hasWeakFormulas = result.weakFormulas.length > 0;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent/10">
          <Trophy className="h-8 w-8 text-accent" />
        </div>

        <h2 className="text-xl font-bold text-foreground">
          {result.completed ? 'Раунд пройден!' : 'Раунд завершён'}
        </h2>

        <p className="mt-2 text-3xl font-extrabold text-accent">
          {result.score}/{result.total}
        </p>
        <p className="text-sm text-muted-foreground">{percent}% правильных</p>

        <div className="mt-4 flex justify-center gap-6 text-sm text-muted-foreground">
          <span>❤️ {result.livesRemaining} жизней</span>
          <span>⏱ {result.durationSeconds}с</span>
        </div>

        {hasWeakFormulas && (
          <div className="mt-4 rounded-xl bg-muted/50 p-3 text-left">
            <p className="text-xs font-semibold text-muted-foreground mb-1">
              Слабые формулы ({result.weakFormulas.length}):
            </p>
            <ul className="text-xs text-muted-foreground space-y-0.5">
              {result.weakFormulas.map((wf) => (
                <li key={wf.formulaId}>
                  • {wf.formulaId} — {wf.errorDescription}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2">
          {hasWeakFormulas && (
            <Button onClick={onRetryErrors} className="w-full gap-2">
              <RotateCcw className="h-4 w-4" />
              Повторить ошибки
            </Button>
          )}
          <Button variant="outline" onClick={onClose} className="w-full gap-2">
            <X className="h-4 w-4" />
            Закрыть
          </Button>
        </div>
      </div>
    </div>
  );
}
