/**
 * DIAGNOSTIC PAGE - VERSION 2.1 (Modular)
 * If Lovable shows a different UI, please sync with GitHub main branch.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AuthGuard from '@/components/AuthGuard';
import { PageContent } from '@/components/PageContent';
import { Button } from '@/components/ui/button';
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

// Состояния экрана диагностики
type DiagnosticView = 'loading' | 'intro' | 'question' | 'result';

const Diagnostic = () => {
  const navigate = useNavigate();
  const [view, setView] = useState<DiagnosticView>('loading');
  const [showResultsManually, setShowResultsManually] = useState(false);

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
    // Ждем загрузки всех начальных данных
    if (isLoadingCanTake || isLoadingExisting || isLoadingLast) {
      return;
    }

    // 1. Если только что завершили (есть свежий результат в стейте хука)
    if (result) {
      setView('result');
      return;
    }

    // 2. Если в хуке уже активна сессия (после нажатия "Начать" или "Продолжить")
    if (session && currentProblem) {
      setView('question');
      return;
    }

    // 3. Если пользователь вручную нажал "Посмотреть результаты"
    if (showResultsManually && lastResultSession) {
      setView('result');
      return;
    }

    // 4. По умолчанию ВСЕГДА показываем интро, даже если есть старый результат
    setView('intro');
  }, [isLoadingCanTake, isLoadingExisting, isLoadingLast, result, session, currentProblem, lastResultSession, isLoading, showResultsManually]);

  if (view === 'loading') {
    return (
      <AuthGuard>
        <PageContent>
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground text-center animate-pulse">
                Загрузка диагностики...
              </p>
            </div>
          </div>
        </PageContent>
      </AuthGuard>
    );
  }

  // Данные для отображения результата (lastResultSession уже содержит полную структуру)
  const displayResult = result || lastResultSession || null;

  return (
    <AuthGuard>
      <PageContent>
        <div className="container mx-auto px-4 pb-6 max-w-4xl">
          {view === 'intro' && (
            <DiagnosticIntro
              onStart={startDiagnostic}
              onContinue={() => existingSession && continueSession(existingSession)}
              onViewResults={() => setShowResultsManually(true)}
              hasExistingSession={!!existingSession}
              hasLastResult={!!lastResultSession}
              remainingQuestions={existingSession ? (existingSession.total_questions - existingSession.current_question + 1) : 0}
              isLoading={isLoading}
              canRetake={canTakeData?.canTake}
              daysUntilRetake={canTakeData?.daysUntilRetake}
            />
          )}

          {view === 'question' && currentProblem && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <DiagnosticQuestion
                problem={currentProblem}
                questionNumber={currentIndex + 1}
                totalQuestions={totalQuestions}
                onSubmit={submitAnswer}
                onBack={() => navigate('/practice')}
                isSubmitting={isLoading}
              />
            </div>
          )}

          {view === 'result' && displayResult && (
            <div className="animate-in fade-in zoom-in-95 duration-500">
              <DiagnosticResult
                result={displayResult as any}
                onStartPractice={(num) => navigate(num ? `/practice?task=${num}` : '/practice')}
                onRetake={startDiagnostic}
                canRetake={canTakeData?.canTake}
                daysUntilRetake={canTakeData?.daysUntilRetake}
              />
            </div>
          )}

          {error && (
            <div className="mt-6 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-center">
              <p className="text-destructive font-medium">{error}</p>
              <Button 
                variant="outline" 
                size="sm" 
                className="mt-3" 
                onClick={() => window.location.reload()}
              >
                Обновить страницу
              </Button>
            </div>
          )}
        </div>
      </PageContent>
    </AuthGuard>
  );
};

export default Diagnostic;

