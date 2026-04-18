import { useCallback, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { FormulaRoundScreen, RoundResultScreen } from '@/components/formula-round';
import { useTrainerSession } from '@/hooks/useTrainerSession';
import {
  generateRetryRound,
  generateRound,
  kinematicsFormulas,
  dynamicsFormulas,
  conservationFormulas,
  staticsFormulas,
  hydrostaticsFormulas,
  mechanicsFormulas,
  type FormulaQuestion,
  type RoundConfig,
  type RoundResult,
} from '@/lib/formulaEngine';
import { submitTrainerRound } from '@/lib/trainerApi';
import { BestScoreCard } from '@/components/homework/formula-round/gamification/BestScoreCard';
import { StreakCard } from '@/components/homework/formula-round/gamification/StreakCard';
import { XpCard } from '@/components/homework/formula-round/gamification/XpCard';
import {
  useTrainerGamificationStore,
  type AppliedOutcome,
  type SectionKey,
} from '@/stores/trainerGamificationStore';
import { trackTrainerEvent } from '@/lib/trainerGamification/telemetry';

type TrainerPageState = 'intro' | 'running' | 'result';
type SectionType = 'mechanics' | 'kinematics' | 'dynamics' | 'conservation' | 'statics' | 'hydrostatics';

const SECTION_TO_GAMIFICATION_KEY: Record<SectionType, SectionKey> = {
  mechanics: 'all',
  kinematics: 'kinematics',
  dynamics: 'dynamics',
  conservation: 'conservation',
  statics: 'statics',
  hydrostatics: 'hydrostatics',
};

const SECTION_POOLS: Record<SectionType, { formulas: typeof kinematicsFormulas; label: string }> = {
  mechanics: { formulas: mechanicsFormulas, label: 'Вся механика' },
  kinematics: { formulas: kinematicsFormulas, label: 'Кинематика' },
  dynamics: { formulas: dynamicsFormulas, label: 'Динамика' },
  conservation: { formulas: conservationFormulas, label: 'Законы сохранения' },
  statics: { formulas: staticsFormulas, label: 'Статика' },
  hydrostatics: { formulas: hydrostaticsFormulas, label: 'Гидростатика' },
};

function createTrainerRound(section: SectionType): FormulaQuestion[] {
  const pool = SECTION_POOLS[section].formulas;
  const questionCount = Math.min(10, Math.max(3, pool.length * 3));
  const config: RoundConfig = {
    section,
    questionCount,
    lives: 0,
    formulaPool: pool,
  };
  return generateRound(config);
}

function createRetryRound(result: RoundResult, section: SectionType): FormulaQuestion[] {
  const pool = SECTION_POOLS[section].formulas;
  const questionCount = Math.min(10, Math.max(3, pool.length * 3));
  const config: RoundConfig = {
    section,
    questionCount,
    lives: 0,
    formulaPool: pool,
  };
  const retryQuestions = generateRetryRound(result.weakFormulas, config);
  return retryQuestions.length > 0 ? retryQuestions : createTrainerRound(section);
}

// Job: P1 — Top-of-funnel / привлечение учеников через /trainer (standalone demo).
// Sub-jobs: reason-to-return школьнику ЕГЭ/ОГЭ; демо-артефакт репетитору для sharing.
// Segment: B2C, школьники 9–11 класс, mobile-first. Wedge: питает funnel, не меняет его.
export default function TrainerPage() {
  const { sessionId, startedAt } = useTrainerSession();
  const [state, setState] = useState<TrainerPageState>('intro');
  const [selectedSection, setSelectedSection] = useState<SectionType>('mechanics');
  const [questions, setQuestions] = useState<FormulaQuestion[]>([]);
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [appliedOutcome, setAppliedOutcome] = useState<AppliedOutcome | null>(null);
  const [isRetryMode, setIsRetryMode] = useState(false);
  const [roundKey, setRoundKey] = useState(0);
  /** Snapshot of the last-started questions set — used by «Пройти ещё раз». */
  const lastQuestionsRef = useRef<FormulaQuestion[] | null>(null);
  const totalXp = useTrainerGamificationStore((s) => s.totalXp);
  const currentStreak = useTrainerGamificationStore((s) => s.currentStreak);
  const lastPlayedDate = useTrainerGamificationStore((s) => s.lastPlayedDate);
  const dailyRoundsCount = useTrainerGamificationStore((s) => s.dailyRoundsCount);
  const bestScoreBySection = useTrainerGamificationStore((s) => s.bestScoreBySection);
  const applyRoundResult = useTrainerGamificationStore((s) => s.applyRoundResult);

  const handleStart = useCallback(() => {
    const fresh = createTrainerRound(selectedSection);
    lastQuestionsRef.current = fresh;
    setRoundResult(null);
    setAppliedOutcome(null);
    setIsRetryMode(false);
    setQuestions(fresh);
    setRoundKey((currentKey) => currentKey + 1);
    setState('running');
  }, [selectedSection]);

  const handleReplaySame = useCallback(() => {
    const snapshot = lastQuestionsRef.current;
    if (!snapshot || snapshot.length === 0) {
      return;
    }
    setRoundResult(null);
    setAppliedOutcome(null);
    setIsRetryMode(false);
    setQuestions(snapshot);
    setRoundKey((currentKey) => currentKey + 1);
    setState('running');
  }, []);

  const handleRetryWrong = useCallback(() => {
    if (!roundResult) {
      return;
    }
    const retryQuestions = createRetryRound(roundResult, selectedSection);
    lastQuestionsRef.current = retryQuestions;
    setRoundResult(null);
    setAppliedOutcome(null);
    setIsRetryMode(true);
    setQuestions(retryQuestions);
    setRoundKey((currentKey) => currentKey + 1);
    setState('running');
  }, [roundResult, selectedSection]);

  const handleExit = useCallback(() => {
    setRoundResult(null);
    setAppliedOutcome(null);
    setIsRetryMode(false);
    setState('intro');
  }, []);

  const handleComplete = useCallback(
    (result: RoundResult) => {
      const sectionKey = SECTION_TO_GAMIFICATION_KEY[selectedSection];
      const outcome = applyRoundResult({
        section: sectionKey,
        correctCount: result.score,
        totalCount: result.total,
        bestComboInRound: result.maxCombo,
        isRetryMode,
      });

      setRoundResult(result);
      setAppliedOutcome(outcome);
      setState('result');

      // ── Telemetry (spec §5.5) — no PII, no task_text ──────────────────────
      // trainer_streak_broken fires inside applyRoundResult — do NOT duplicate.
      trackTrainerEvent('trainer_round_completed', {
        section: sectionKey,
        accuracy: result.total > 0 ? result.score / result.total : 0,
        bestCombo: result.maxCombo,
        xpEarned: outcome.xpEarned,
        isNewBest: outcome.isNewBest,
        isRetry: isRetryMode,
      });

      if (outcome.streakGained) {
        trackTrainerEvent('trainer_streak_incremented', {
          streakBefore: outcome.streakAfter - 1,
          streakAfter: outcome.streakAfter,
          dailyRounds: outcome.dailyRoundsCount,
        });
      }

      if (outcome.isDailyGoalReached) {
        trackTrainerEvent('trainer_daily_goal_reached', {
          streak: outcome.streakAfter,
          totalXp: useTrainerGamificationStore.getState().totalXp,
        });
      }

      if (outcome.isNewBest) {
        trackTrainerEvent('trainer_new_best', {
          section: sectionKey,
          newBest: outcome.xpEarned,
        });
      }

      void submitTrainerRound({
        session_id: sessionId,
        score: result.score,
        total: result.total,
        weak_formulas: result.weakFormulas.map((formula) => formula.formulaId),
        duration_ms: result.durationMs,
        client_started_at: startedAt,
      }).catch(() => undefined);
    },
    [applyRoundResult, isRetryMode, selectedSection, sessionId, startedAt],
  );

  if (state === 'running' && questions.length > 0) {
    return (
      <FormulaRoundScreen
        key={roundKey}
        questions={questions}
        onComplete={handleComplete}
        onExit={handleExit}
      />
    );
  }

  if (state === 'result' && roundResult && appliedOutcome) {
    return (
      <RoundResultScreen
        result={roundResult}
        appliedOutcome={appliedOutcome}
        onReplaySame={handleReplaySame}
        onRetryWrong={handleRetryWrong}
        onExit={handleExit}
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
                  Выбери раздел механики и пройди раунд. Увидишь, какие формулы
                  держатся уверенно, а какие стоит повторить. Всё работает без
                  регистрации.
                </p>
              </div>
            </header>

            <div className="-mx-4 px-4 md:mx-0 md:px-0">
              <div className="flex gap-4 overflow-x-auto touch-pan-x snap-x snap-mandatory pb-2 md:grid md:grid-cols-3 md:overflow-visible md:pb-0">
                <StreakCard
                  currentStreak={currentStreak}
                  lastPlayedDate={lastPlayedDate}
                />
                <XpCard totalXp={totalXp} dailyRoundsCount={dailyRoundsCount} />
                <BestScoreCard
                  bestScoreBySection={bestScoreBySection}
                  initialSection={SECTION_TO_GAMIFICATION_KEY[selectedSection]}
                />
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-3">
                  Выбери раздел механики
                </label>
                <div className="flex flex-wrap gap-2">
                  {(Object.entries(SECTION_POOLS) as Array<[SectionType, typeof SECTION_POOLS[SectionType]]>).map(
                    ([section, { label }]) => (
                      <button
                        key={section}
                        type="button"
                        onClick={() => setSelectedSection(section)}
                        className={`min-h-[44px] rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-accent ${
                          selectedSection === section
                            ? 'bg-accent text-white'
                            : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                        }`}
                        style={{ touchAction: 'manipulation', fontSize: '16px' }}
                      >
                        {label}
                      </button>
                    ),
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-3">
              <div className="rounded-lg bg-white p-4">
                <p className="text-sm font-medium text-slate-500">Раздел</p>
                <p className="mt-2 text-lg font-semibold text-slate-900">
                  {SECTION_POOLS[selectedSection].label}
                </p>
              </div>
              <div className="rounded-lg bg-white p-4">
                <p className="text-sm font-medium text-slate-500">Формат</p>
                <p className="mt-2 text-lg font-semibold text-slate-900">
                  {Math.min(10, Math.max(3, SECTION_POOLS[selectedSection].formulas.length * 3))} заданий
                </p>
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
                Начать раунд
              </button>
            </div>

            <p className="text-xs text-slate-400 text-center mt-8">
              Прогресс сохраняется в браузере. При смене устройства серия может сброситься.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
