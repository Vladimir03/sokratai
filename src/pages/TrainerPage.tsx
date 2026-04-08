import { useCallback, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { FormulaRoundScreen, RoundResultScreen } from '@/components/formula-round';
import { useTrainerSession } from '@/hooks/useTrainerSession';
import {
  generateRetryRound,
  generateRound,
  kinematicsFormulas,
  type FormulaQuestion,
  type RoundConfig,
  type RoundResult,
} from '@/lib/formulaEngine';
import { submitTrainerRound } from '@/lib/trainerApi';

type TrainerPageState = 'intro' | 'running' | 'result';

const TRAINER_ROUND_CONFIG: RoundConfig = {
  section: 'kinematics',
  questionCount: 10,
  lives: 0,
  formulaPool: kinematicsFormulas,
};

function createTrainerRound(): FormulaQuestion[] {
  return generateRound(TRAINER_ROUND_CONFIG);
}

function createRetryRound(result: RoundResult): FormulaQuestion[] {
  const retryQuestions = generateRetryRound(result.weakFormulas, TRAINER_ROUND_CONFIG);
  return retryQuestions.length > 0 ? retryQuestions : createTrainerRound();
}

export default function TrainerPage() {
  const { sessionId, startedAt } = useTrainerSession();
  const [state, setState] = useState<TrainerPageState>('intro');
  const [questions, setQuestions] = useState<FormulaQuestion[]>([]);
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [roundKey, setRoundKey] = useState(0);

  const handleStart = useCallback(() => {
    setRoundResult(null);
    setQuestions(createTrainerRound());
    setRoundKey((currentKey) => currentKey + 1);
    setState('running');
  }, []);

  const handleRetryWrong = useCallback(() => {
    if (!roundResult) {
      return;
    }

    setQuestions(createRetryRound(roundResult));
    setRoundKey((currentKey) => currentKey + 1);
    setState('running');
  }, [roundResult]);

  const handleComplete = useCallback(
    (result: RoundResult) => {
      setRoundResult(result);
      setState('result');

      void submitTrainerRound({
        session_id: sessionId,
        score: result.score,
        total: result.total,
        weak_formulas: result.weakFormulas.map((formula) => formula.formulaId),
        duration_ms: result.durationMs,
        client_started_at: startedAt,
      }).catch(() => undefined);
    },
    [sessionId, startedAt],
  );

  if (state === 'running' && questions.length > 0) {
    return (
      <FormulaRoundScreen
        key={roundKey}
        questions={questions}
        onComplete={handleComplete}
        onExit={() => setState('intro')}
      />
    );
  }

  if (state === 'result' && roundResult) {
    return (
      <RoundResultScreen
        result={roundResult}
        onRetryWrong={handleRetryWrong}
        onExit={() => setState('intro')}
      />
    );
  }

  return (
    <main className="min-h-[100dvh] bg-slate-50 font-sans text-slate-900">
      <div className="mx-auto flex min-h-[100dvh] max-w-4xl items-center px-4 py-8 md:px-6 lg:px-8">
        <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
          <div className="mx-auto max-w-2xl space-y-8">
            <header className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-600">
                <Sparkles className="h-4 w-4 text-accent" />
                Публичный демо-раунд
              </div>
              <div className="space-y-3">
                <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                  Тренажёр формул физики
                </h1>
                <p className="max-w-xl text-base leading-7 text-slate-600">
                  Пройдите короткий раунд по кинематике и сразу увидите, какие формулы
                  держатся уверенно, а какие стоит повторить. Всё работает без
                  регистрации и запускается в один тап.
                </p>
              </div>
            </header>

            <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-3">
              <div className="rounded-lg bg-white p-4">
                <p className="text-sm font-medium text-slate-500">Раздел</p>
                <p className="mt-2 text-lg font-semibold text-slate-900">Кинематика</p>
              </div>
              <div className="rounded-lg bg-white p-4">
                <p className="text-sm font-medium text-slate-500">Формат</p>
                <p className="mt-2 text-lg font-semibold text-slate-900">10 заданий</p>
              </div>
              <div className="rounded-lg bg-white p-4">
                <p className="text-sm font-medium text-slate-500">Результат</p>
                <p className="mt-2 text-lg font-semibold text-slate-900">Сразу после раунда</p>
              </div>
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-slate-500">
                Сессия создаётся анонимно и переиспользуется на этом устройстве.
              </p>
              <button
                type="button"
                onClick={handleStart}
                className="inline-flex items-center justify-center rounded-lg bg-accent px-6 py-3 text-base font-medium text-white transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                style={{ touchAction: 'manipulation' }}
              >
                Начать
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
