import { useState, useRef, useCallback, useMemo } from 'react';
import { RoundProgress } from './RoundProgress';
import { FeedbackOverlay } from './FeedbackOverlay';
import { TrueOrFalseCard } from './TrueOrFalseCard';
import { BuildFormulaCard } from './BuildFormulaCard';
import { SituationCard } from './SituationCard';
import { generateFeedback } from '@/lib/formulaEngine/questionGenerator';
import type {
  FormulaQuestion,
  BuildFormulaAnswer,
  RoundConfig,
  RoundResult,
  AnswerRecord,
  WeakFormula,
} from '@/lib/formulaEngine/types';

type RoundPhase = 'playing' | 'feedback';

interface FormulaRoundScreenProps {
  roundConfig: RoundConfig;
  questions: FormulaQuestion[];
  onComplete: (result: RoundResult) => void;
}

/**
 * Main round screen — fullscreen experience for formula drill.
 * State machine: playing → feedback (overlay) → next question → result.
 *
 * Dispatches to real card components per question.type:
 * TrueOrFalseCard (L3), BuildFormulaCard (L2), SituationCard (L1).
 * Correctness is determined here, not inside cards.
 */
export function FormulaRoundScreen({
  roundConfig,
  questions,
  onComplete,
}: FormulaRoundScreenProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [lives, setLives] = useState(roundConfig.lives);
  const [score, setScore] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [phase, setPhase] = useState<RoundPhase>('playing');
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const [feedbackText, setFeedbackText] = useState('');

  const startTimeRef = useRef(Date.now());
  const questionStartRef = useRef(Date.now());

  const currentQuestion = questions[currentIndex] as FormulaQuestion | undefined;

  const buildResult = useCallback(
    (
      updatedAnswers: AnswerRecord[],
      updatedScore: number,
      updatedLives: number,
      completed: boolean,
    ): RoundResult => {
      const durationSeconds = Math.round(
        (Date.now() - startTimeRef.current) / 1000,
      );

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
        livesRemaining: updatedLives,
        completed,
        durationSeconds,
        answers: updatedAnswers,
        weakFormulas,
      };
    },
    [questions.length],
  );

  const handleAnswer = useCallback(
    (selectedAnswer: string | boolean | BuildFormulaAnswer) => {
      if (!currentQuestion || phase !== 'playing') return;

      const responseMs = Date.now() - questionStartRef.current;

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
      const newLives = correct ? lives : lives - 1;
      const record: AnswerRecord = {
        questionId: currentQuestion.id,
        formulaId: currentQuestion.formulaId,
        questionType: currentQuestion.type,
        layer: currentQuestion.layer,
        correct,
        responseMs,
        selectedAnswer,
        expectedAnswer: currentQuestion.correctAnswer,
        mutationType: currentQuestion.mutationType,
      };

      const newAnswers = [...answers, record];

      setScore(newScore);
      setLives(newLives);
      setAnswers(newAnswers);
      setLastCorrect(correct);
      setFeedbackText(generateFeedback(currentQuestion, correct));
      setPhase('feedback');
    },
    [currentQuestion, phase, score, lives, answers],
  );

  const handleNext = useCallback(() => {
    const newIndex = currentIndex + 1;

    // Check end conditions
    if (lives <= 0) {
      // Lives exhausted during feedback — end round
      onComplete(buildResult(answers, score, 0, false));
      return;
    }

    if (newIndex >= questions.length) {
      // All questions answered
      onComplete(buildResult(answers, score, lives, true));
      return;
    }

    // Advance to next question
    setCurrentIndex(newIndex);
    setPhase('playing');
    setLastCorrect(null);
    setFeedbackText('');
    questionStartRef.current = Date.now();
  }, [currentIndex, lives, questions.length, answers, score, onComplete, buildResult]);

  // Section title from config
  const sectionTitle = useMemo(() => {
    const sectionMap: Record<string, string> = {
      kinematics: 'Кинематика',
      'Кинематика': 'Кинематика',
    };
    return sectionMap[roundConfig.section] ?? roundConfig.section;
  }, [roundConfig.section]);

  if (!currentQuestion) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-50">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 bg-white border-b border-slate-200">
        <p className="text-sm font-medium text-slate-500 mb-2">
          {sectionTitle} — Формулы
        </p>
        <RoundProgress
          current={currentIndex + (phase === 'feedback' ? 1 : 0)}
          total={questions.length}
          lives={lives}
          maxLives={roundConfig.lives}
        />
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
      {phase === 'feedback' && (
        <FeedbackOverlay
          isCorrect={lastCorrect ?? false}
          explanation={feedbackText}
          livesLost={lastCorrect ? 0 : 1}
          onContinue={handleNext}
        />
      )}
    </div>
  );
}

