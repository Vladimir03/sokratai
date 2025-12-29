import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AuthGuard from '@/components/AuthGuard';
import { PageContent } from '@/components/PageContent';
import { Loader2 } from 'lucide-react';
import {
  DiagnosticIntro,
  DiagnosticQuestion,
  DiagnosticResult,
} from '@/components/diagnostic';
import {
  useDiagnostic,
  useCanTakeDiagnostic,
  useExistingSession,
  useLastDiagnosticResult,
} from '@/hooks/useDiagnostic';

type DiagnosticView = 'intro' | 'question' | 'result' | 'loading';

const Diagnostic = () => {
  const navigate = useNavigate();
  const [view, setView] = useState<DiagnosticView>('loading');

  // Хуки данных
  const { data: canTakeData, isLoading: isLoadingCanTake } = useCanTakeDiagnostic();
  const { data: existingSession, isLoading: isLoadingExisting } = useExistingSession();
  const { data: lastResultSession, isLoading: isLoadingLast } = useLastDiagnosticResult();

  const {
    session,
    currentProblem,
    currentIndex,
    totalQuestions,
    isLoading,
    error,
    result,
    startDiagnostic,
    continueSession,
    submitAnswer,
  } = useDiagnostic();

  // Логика переключения экранов
  useEffect(() => {
    if (isLoadingCanTake || isLoadingExisting || isLoadingLast) {
      setView('loading');
      return;
    }

    // Если есть результат из хука (только что завершили)
    if (result) {
      setView('result');
      return;
    }

    // Если есть активная сессия в хуке (в процессе)
    if (session && currentProblem) {
      setView('question');
      return;
    }

    // Если в БД есть завершенная диагностика, а в хуке ничего нет - показываем результаты
    if (lastResultSession && !session) {
      setView('result');
      return;
    }

    // По умолчанию - интро
    setView('intro');
  }, [isLoadingCanTake, isLoadingExisting, isLoadingLast, result, session, currentProblem, lastResultSession]);

  if (view === 'loading') {
    return (
      <AuthGuard>
        <PageContent>
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        </PageContent>
      </AuthGuard>
    );
  }

  // Преобразуем данные из БД в формат DiagnosticResult для отображения, если нужно
  const displayResult = result || (lastResultSession ? {
    primaryScore: lastResultSession.predicted_primary_score || 0,
    testScore: lastResultSession.predicted_test_score || 0,
    totalQuestions: lastResultSession.total_questions || 12,
    correctAnswers: lastResultSession.predicted_primary_score || 0,
    timeSpentMinutes: Math.round((lastResultSession.time_spent_seconds || 900) / 60),
    topicScores: [],
    weakTopics: [],
    strongTopics: [],
    recommendedTopic: null,
    // При просмотре старых результатов breakdown может быть не заполнен, 
    // если мы не храним его в session object (но он есть в diagnostic_answers)
    answersBreakdown: [] 
  } : null);

  return (
    <AuthGuard>
      <PageContent>
        <div className="container mx-auto px-4 pb-6">
          {view === 'intro' && (
            <DiagnosticIntro
              onStart={startDiagnostic}
              onContinue={() => existingSession && continueSession(existingSession)}
              hasExistingSession={!!existingSession}
              remainingQuestions={existingSession ? (existingSession.total_questions - existingSession.current_question + 1) : 0}
              isLoading={isLoading}
              canRetake={canTakeData?.canTake}
              daysUntilRetake={canTakeData?.daysUntilRetake}
            />
          )}

          {view === 'question' && currentProblem && (
            <DiagnosticQuestion
              problem={currentProblem}
              questionNumber={currentIndex + 1}
              totalQuestions={totalQuestions}
              onSubmit={submitAnswer}
              onBack={() => navigate('/practice')}
              isSubmitting={isLoading}
            />
          )}

          {view === 'result' && displayResult && (
            <DiagnosticResult
              result={displayResult as any}
              onStartPractice={(num) => navigate('/practice', { state: { selectedNumber: num } })}
              onRetake={startDiagnostic}
              canRetake={canTakeData?.canTake}
              daysUntilRetake={canTakeData?.daysUntilRetake}
            />
          )}

          {error && (
            <div className="mt-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-center">
              <p className="text-destructive text-sm">{error}</p>
            </div>
          )}
        </div>
      </PageContent>
    </AuthGuard>
  );
};

export default Diagnostic;
