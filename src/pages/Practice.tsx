import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import AuthGuard from '@/components/AuthGuard';
import { PageContent } from '@/components/PageContent';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { 
  ProblemCard, 
  AnswerInput, 
  ResultCard, 
  HintsDisplay, 
  EgeNumberGrid,
  TodayStatsCard,
  GoalReachedModal 
} from '@/components/practice';
import { DiagnosticBanner } from '@/components/diagnostic';
import { usePractice, useUserProgress, useTodayStats, useProblemCounts } from '@/hooks/usePractice';
import { useLastDiagnosticResult } from '@/hooks/useDiagnostic';
import type { EGENumber, CheckAnswerResult } from '@/types/practice';
import { EGE_NUMBERS } from '@/types/practice';

const Practice = () => {
  console.log('🎯 Practice page rendered');
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  
  // Получаем выбранный номер из query param (?task=7) или state
  const taskFromQuery = searchParams.get('task');
  const initialNumber = taskFromQuery 
    ? (parseInt(taskFromQuery, 10) as EGENumber) 
    : (location.state as { selectedNumber?: number } | null)?.selectedNumber as EGENumber | undefined;
  
  const [selectedEgeNumber, setSelectedEgeNumber] = useState<EGENumber | null>(initialNumber || null);
  const [showResult, setShowResult] = useState(false);
  const [checkResult, setCheckResult] = useState<CheckAnswerResult | null>(null);
  const [userAnswer, setUserAnswer] = useState('');
  const [hintsUsedCount, setHintsUsedCount] = useState(0);
  const [askedAiForProblem, setAskedAiForProblem] = useState(false);
  const [showGoalCelebration, setShowGoalCelebration] = useState(false);
  const [celebrationShownToday, setCelebrationShownToday] = useState(false);

  const { currentProblem, isLoading, sessionStats, loadNextProblem, submitAnswer } = usePractice(selectedEgeNumber);
  const { data: userProgress = {}, isLoading: isLoadingProgress } = useUserProgress();
  const { data: todayStats, isLoading: isLoadingStats } = useTodayStats();
  const { data: problemCounts = {} } = useProblemCounts();
  const { data: lastDiagnostic } = useLastDiagnosticResult();

  // Очищаем state после использования
  useEffect(() => {
    if (initialNumber && location.state) {
      window.history.replaceState({}, document.title);
    }
  }, [initialNumber, location.state]);

  // Следим за достижением цели
  useEffect(() => {
    if (
      todayStats && 
      todayStats.problems_solved_today >= todayStats.daily_goal_problems && 
      !celebrationShownToday
    ) {
      setShowGoalCelebration(true);
      setCelebrationShownToday(true);
    }
  }, [todayStats, celebrationShownToday]);

  // Определяем рекомендуемый номер (самый слабый из доступных)
  const recommendedNumber = useMemo((): EGENumber | undefined => {
    const enabledNumbers: EGENumber[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    
    // Находим номер с минимальной точностью
    let minAccuracy = 101;
    let recommended: EGENumber | undefined;
    
    for (const num of enabledNumbers) {
      const progress = userProgress[num];
      const accuracy = progress?.accuracy ?? 0;
      if (accuracy < minAccuracy) {
        minAccuracy = accuracy;
        recommended = num;
      }
    }
    
    return recommended;
  }, [userProgress]);

  // Обработчик выбора номера ЕГЭ
  const handleSelectEgeNumber = (num: EGENumber) => {
    setSelectedEgeNumber(num);
    setShowResult(false);
    setCheckResult(null);
    setHintsUsedCount(0);
    setAskedAiForProblem(false);
  };

  // Обработчик проверки ответа
  const handleCheckAnswer = async (answer: string) => {
    if (!currentProblem) return;
    
    setUserAnswer(answer);
    const result = await submitAnswer(answer, hintsUsedCount, askedAiForProblem);
    
    if (result) {
      setCheckResult(result);
      setShowResult(true);
    }
  };

  // Обработчик показа подсказки
  const handleShowHint = () => {
    if (currentProblem && hintsUsedCount < currentProblem.hints.length) {
      setHintsUsedCount(prev => prev + 1);
    }
  };

  // Обработчик пропуска задачи
  const handleSkip = () => {
    loadNextProblem();
    setShowResult(false);
    setCheckResult(null);
    setHintsUsedCount(0);
    setAskedAiForProblem(false);
  };

  // Обработчик перехода к следующей задаче
  const handleNextProblem = () => {
    loadNextProblem();
    setShowResult(false);
    setCheckResult(null);
    setHintsUsedCount(0);
    setAskedAiForProblem(false);
  };

  // Обработчик "Спроси Сократа"
  const handleAskSocrat = () => {
    if (!currentProblem) return;
    
    setAskedAiForProblem(true);
    
    // Формируем контекст для чата
    const context = `
Я решаю задачу №${currentProblem.ege_number} ЕГЭ по математике.

**Условие задачи:**
${currentProblem.condition_text}

**Мой ответ:** ${userAnswer}
**Правильный ответ:** ${checkResult?.correct_answer || currentProblem.correct_answer}

Помоги мне понять, где я ошибся. Объясни теорию по этой теме и покажи подробное пошаговое решение этой задачи.
    `.trim();

    // Переходим в чат с контекстом
    navigate('/chat', { 
      state: { 
        initialMessage: context,
        chatType: 'practice_help',
        problemContext: {
          ege_number: currentProblem.ege_number,
          topic: currentProblem.topic,
          condition: currentProblem.condition_text,
        }
      } 
    });
  };

  // Обработчик возврата к списку
  const handleBack = () => {
    setSelectedEgeNumber(null);
    setShowResult(false);
    setCheckResult(null);
    setHintsUsedCount(0);
  };

  return (
    <AuthGuard>
      <PageContent>
        <div className="container mx-auto px-4 py-6 max-w-2xl">
          {/* Заголовок и статистика */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-center mb-4">
              🎯 Тренажёр ЕГЭ
            </h1>
            
            {todayStats && !isLoadingStats && (
              <TodayStatsCard stats={todayStats} />
            )}
          </div>

          {/* Выбор номера ЕГЭ или практика */}
          {!selectedEgeNumber ? (
            <>
              {/* Баннер диагностики для тех, кто не прошёл */}
              <DiagnosticBanner
                onNavigate={() => navigate('/diagnostic')}
                lastScore={lastDiagnostic?.testScore}
                hasCompletedDiagnostic={!!lastDiagnostic}
              />
              
              {/* Сетка выбора номера */}
              <EgeNumberGrid
              userProgress={userProgress}
              problemCounts={problemCounts}
              onSelect={handleSelectEgeNumber}
              recommendedNumber={recommendedNumber}
              enabledNumbers={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]}
            />
            </>
          ) : (
            // Режим практики
            <div className="space-y-4">
              {/* Кнопка назад и информация о номере */}
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleBack}
                >
                  <ArrowLeft className="w-5 h-5" />
                </Button>
                <div>
                  <h2 className="font-semibold">
                    Номер {selectedEgeNumber}: {EGE_NUMBERS[selectedEgeNumber].name}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Сессия: {sessionStats.correct}/{sessionStats.attempted} правильно
                  </p>
                </div>
              </div>

              {/* Загрузка */}
              {isLoading && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              )}

              {/* Нет задач */}
              {!isLoading && !currentProblem && (
                <div className="text-center py-12">
                  <p className="text-muted-foreground mb-4">
                    Задачи для этого номера пока не добавлены.
                  </p>
                  <Button onClick={handleBack}>
                    Выбрать другой номер
                  </Button>
                </div>
              )}

              {/* Задача */}
              {!isLoading && currentProblem && (
                <>
                  <ProblemCard problem={currentProblem} />

                  {/* Подсказки */}
                  {hintsUsedCount > 0 && (
                    <HintsDisplay 
                      hints={currentProblem.hints} 
                      revealedCount={hintsUsedCount} 
                    />
                  )}

                  {/* Результат или ввод ответа */}
                  {showResult && checkResult ? (
                    <ResultCard
                      result={checkResult}
                      userAnswer={userAnswer}
                      onNext={handleNextProblem}
                      onAskSocrat={handleAskSocrat}
                    />
                  ) : (
                    <AnswerInput
                      answerType={currentProblem.answer_type}
                      onSubmit={handleCheckAnswer}
                      onHint={handleShowHint}
                      onSkip={handleSkip}
                      hintsAvailable={currentProblem.hints.length}
                      hintsUsed={hintsUsedCount}
                      isChecking={false}
                    />
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {todayStats && (
          <GoalReachedModal 
            isOpen={showGoalCelebration} 
            onClose={() => setShowGoalCelebration(false)}
            stats={{
              streak: todayStats.current_streak,
              solved: todayStats.problems_solved_today,
              xp: todayStats.xp_today
            }}
          />
        )}
      </PageContent>
    </AuthGuard>
  );
};

export default Practice;

