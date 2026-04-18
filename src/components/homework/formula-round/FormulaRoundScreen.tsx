import { useState, useRef, useCallback } from 'react';
import { ArrowLeft } from 'lucide-react';
import { RoundProgress } from './RoundProgress';
import { FeedbackOverlay } from './FeedbackOverlay';
import { TrueOrFalseCard } from './TrueOrFalseCard';
import { BuildFormulaCard } from './BuildFormulaCard';
import { SituationCard } from './SituationCard';
import { ComboIndicator } from './ComboIndicator';
import { generateFeedback, generateFeedbackPayload } from '@/lib/formulaEngine/questionGenerator';
import type {
  FormulaQuestion,
  BuildFormulaAnswer,
  RoundResult,
  AnswerRecord,
  WeakFormula,
} from '@/lib/formulaEngine/types';
import type { FeedbackPayload } from '@/lib/formulaEngine/questionGenerator';

type RoundPhase = 'playing' | 'feedback';

interface FormulaRoundScreenProps {
  questions: FormulaQuestion[];
  onComplete: (result: RoundResult) => void;
  onExit: () => void;
}

/**
 * Main round screen — fullscreen experience for formula drill.
 * State machine: playing → feedback (overlay) → next question → result.
 *
 * Dispatches to real card components per question.type:
 * TrueOrFalseCard (L3), BuildFormulaCard (L2), SituationCard (L1).
 * Correctness is determined here (CLAUDE.md §11), not inside cards.
 *
 * Phase 1 standalone trainer: no lives, no game-over — round always plays
 * until all questions answered. Timing via performance.now() (monotonic).
 */
export function FormulaRoundScreen({
  questions,
  onComplete,
  onExit,
}: FormulaRoundScreenProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [phase, setPhase] = useState<RoundPhase>('playing');
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const [feedbackPayload, setFeedbackPayload] = useState<FeedbackPayload | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<string | boolean | BuildFormulaAnswer | null>(null);
  const [currentCombo, setCurrentCombo] = useState(0);
  const [maxComboInRound, setMaxComboInRound] = useState(0);

  const startTimeRef = useRef(performance.now());
  const questionStartRef = useRef(performance.now());

  const currentQuestion = questions[currentIndex] as FormulaQuestion | undefined;

  const buildResult = useCallback(
    (updatedAnswers: AnswerRecord[], updatedScore: number): RoundResult => {
      const durationMs = Math.round(performance.now() - startTimeRef.current);
      const durationSeconds = Math.round(durationMs / 1000);

      // Compute weak formulas: any formula with at least one wrong answer
      const wrongByFormula = new Map<string, AnswerRecord>();
      for (const a of updatedAnswers) {
        if (!a.correct && !wrongByFormula.has(a.formulaId)) {
          wrongByFormula.set(a.formulaId, a);
        }
      }

      const weakFormulas: WeakFormula[] = Array.from(
        wrongByFormula.entries(),
      ).map(([formulaId, record]) => ({
        formulaId,
        weakLayer: record.layer,
        errorDescription: record.mutationType
          ? `mutation: ${record.mutationType}`
          : `wrong at layer ${record.layer}`,
      }));

      return {
        score: updatedScore,
        total: questions.length,
        livesRemaining: 0,
        completed: true,
        durationSeconds,
        durationMs,
        answers: updatedAnswers,
        weakFormulas,
        maxCombo: maxComboInRound,
      };
    },
    [questions.length, maxComboInRound],
  );

  const handleAnswer = useCallback(
    (selectedAnswer: string | boolean | BuildFormulaAnswer) => {
      if (!currentQuestion || phase !== 'playing') return;

      const responseMs = performance.now() - questionStartRef.current;

      // Determine correctness — single source of truth
      let correct = false;
      if (currentQuestion.type === 'true_or_false') {
        correct = selectedAnswer === currentQuestion.correctAnswer;
      } else if (currentQuestion.type === 'build_formula') {
        const answer = selectedAnswer as BuildFormulaAnswer;
        const expected = currentQuestion.correctAnswer as BuildFormulaAnswer;
        const numOk =
          answer.numerator.length === expected.numerator.length &&
          [...answer.numerator].sort().every((v, i) => v === [...expected.numerator].sort()[i]);
        const denOk =
          answer.denominator.length === expected.denominator.length &&
          [...answer.denominator].sort().every((v, i) => v === [...expected.denominator].sort()[i]);
        correct = numOk && denOk;
      } else {
        correct = selectedAnswer === currentQuestion.correctAnswer;
      }

      const newScore = correct ? score + 1 : score;
      const record: AnswerRecord = {
        questionId: currentQuestion.id,
        formulaId: currentQuestion.formulaId,
        questionType: currentQuestion.type,
        layer: currentQuestion.layer,
        correct,
        responseMs: Math.round(responseMs),
        selectedAnswer,
        expectedAnswer: currentQuestion.correctAnswer,
        mutationType: currentQuestion.mutationType,
      };

      const newAnswers = [...answers, record];
      const payload = generateFeedbackPayload(currentQuestion, correct, selectedAnswer);

      // Combo tracking — correctness is already determined above; we only
      // derive a visual streak from it without touching the source of truth.
      if (correct) {
        const nextCombo = currentCombo + 1;
        setCurrentCombo(nextCombo);
        if (nextCombo > maxComboInRound) setMaxComboInRound(nextCombo);
      } else {
        setCurrentCombo(0);
      }

      setScore(newScore);
      setAnswers(newAnswers);
      setLastCorrect(correct);
      setFeedbackPayload(payload);
      setSelectedAnswer(selectedAnswer);
      setPhase('feedback');
    },
    [currentQuestion, phase, score, answers, currentCombo, maxComboInRound],
  );

  const handleNext = useCallback(() => {
    const newIndex = currentIndex + 1;

    if (newIndex >= questions.length) {
      // All questions answered — complete round
      onComplete(buildResult(answers, score));
      return;
    }

    // Advance to next question
    setCurrentIndex(newIndex);
    setPhase('playing');
    setLastCorrect(null);
    setFeedbackPayload(null);
    setSelectedAnswer(null);
    questionStartRef.current = performance.now();
  }, [currentIndex, questions.length, answers, score, onComplete, buildResult]);

  if (!currentQuestion) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-50">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 bg-white border-b border-slate-200">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onExit}
            aria-label="Выйти из раунда"
            className="shrink-0 inline-flex h-11 w-11 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            style={{ touchAction: 'manipulation' }}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0">
            <RoundProgress
              current={currentIndex + (phase === 'feedback' ? 1 : 0)}
              total={questions.length}
            />
          </div>
          {/*
            key={currentCombo} re-mounts the pill on every increment so the
            zoom-in keyframe re-triggers. When combo drops below 2 the
            indicator returns null and disappears.
          */}
          <ComboIndicator key={currentCombo} combo={currentCombo} />
        </div>
      </div>

      {/* Question area */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-6 overflow-y-auto">
        {currentQuestion.type === 'true_or_false' && (
          <TrueOrFalseCard
            key={currentQuestion.id}
            question={currentQuestion}
            onAnswer={handleAnswer}
            disabled={phase === 'feedback'}
          />
        )}
        {currentQuestion.type === 'build_formula' && (
          <BuildFormulaCard
            key={currentQuestion.id}
            question={currentQuestion}
            onAnswer={handleAnswer}
          />
        )}
        {currentQuestion.type === 'situation_to_formula' && (
          <SituationCard
            key={currentQuestion.id}
            question={currentQuestion}
            onAnswer={handleAnswer}
          />
        )}
      </div>

      {/* Feedback overlay */}
      {phase === 'feedback' && feedbackPayload && (
        <FeedbackOverlay
          isCorrect={feedbackPayload.isCorrect}
          canonicalLatex={feedbackPayload.canonicalLatex}
          questionLatex={feedbackPayload.questionLatex}
          userAnswerLatex={feedbackPayload.userAnswerLatex}
          reasoning={feedbackPayload.reasoning}
          trap={feedbackPayload.trap}
          onContinue={handleNext}
        />
      )}
    </div>
  );
}
