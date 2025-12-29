import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import AuthGuard from '@/components/AuthGuard';
import { PageContent } from '@/components/PageContent';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { ArrowLeft, ArrowRight, Clock, Target, CheckCircle2, XCircle, Loader2, Trophy } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { useDiagnosticSession, useDiagnosticProblems } from '@/hooks/useDiagnostic';
import type { EGENumber } from '@/types/practice';
import { EGE_NUMBERS } from '@/types/practice';

interface DiagnosticProblem {
  id: string;
  ege_number: number;
  condition_text: string;
  condition_image_url: string | null;
  answer_type: string;
  correct_answer: string;
  topic: string;
  subtopic: string | null;
  difficulty: number;
}

const Diagnostic = () => {
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [results, setResults] = useState<Record<number, boolean>>({});
  const [userAnswer, setUserAnswer] = useState('');
  const [startTime, setStartTime] = useState<number>(Date.now());
  const [questionStartTime, setQuestionStartTime] = useState<number>(Date.now());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [finalScore, setFinalScore] = useState<{ primary: number; test: number } | null>(null);
  const [weakTopics, setWeakTopics] = useState<number[]>([]);

  const { data: problems = [], isLoading: isLoadingProblems } = useDiagnosticProblems();
  const { mutateAsync: createSession } = useDiagnosticSession();

  // Создаём сессию при загрузке
  useEffect(() => {
    const initSession = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data, error } = await supabase
          .from('diagnostic_sessions')
          .insert({
            user_id: user.id,
            total_questions: 12,
          })
          .select('id')
          .single();

        if (error) throw error;
        setSessionId(data.id);
        setStartTime(Date.now());
        setQuestionStartTime(Date.now());
      } catch (error) {
        console.error('Error creating diagnostic session:', error);
        toast.error('Ошибка создания сессии');
      }
    };

    initSession();
  }, []);

  const currentProblem = problems[currentIndex] as DiagnosticProblem | undefined;
  const progressPercent = problems.length > 0 ? ((currentIndex + 1) / problems.length) * 100 : 0;

  // Проверка ответа
  const checkAnswer = (userAns: string, correctAns: string, answerType: string): boolean => {
    const normalizeAnswer = (ans: string) => ans.trim().toLowerCase().replace(/,/g, '.').replace(/\s+/g, '');
    const userNormalized = normalizeAnswer(userAns);
    const correctNormalized = normalizeAnswer(correctAns);
    
    if (answerType === 'integer' || answerType === 'decimal') {
      const userNum = parseFloat(userNormalized);
      const correctNum = parseFloat(correctNormalized);
      return Math.abs(userNum - correctNum) < 0.01;
    }
    
    return userNormalized === correctNormalized;
  };

  // Обработчик ответа
  const handleSubmitAnswer = async () => {
    if (!currentProblem || !sessionId || !userAnswer.trim()) return;

    setIsSubmitting(true);
    const timeSpent = Math.round((Date.now() - questionStartTime) / 1000);
    const isCorrect = checkAnswer(userAnswer, currentProblem.correct_answer, currentProblem.answer_type);

    try {
      // Сохраняем ответ
      await supabase.from('diagnostic_answers').insert({
        session_id: sessionId,
        problem_id: currentProblem.id,
        ege_number: currentProblem.ege_number,
        user_answer: userAnswer,
        is_correct: isCorrect,
        time_spent_seconds: timeSpent,
        question_order: currentIndex + 1,
      });

      setAnswers(prev => ({ ...prev, [currentIndex]: userAnswer }));
      setResults(prev => ({ ...prev, [currentIndex]: isCorrect }));

      // Переход к следующему вопросу или завершение
      if (currentIndex < problems.length - 1) {
        setCurrentIndex(prev => prev + 1);
        setUserAnswer('');
        setQuestionStartTime(Date.now());
      } else {
        // Завершаем диагностику
        await completeDiagnostic();
      }
    } catch (error) {
      console.error('Error saving answer:', error);
      toast.error('Ошибка сохранения ответа');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Завершение диагностики
  const completeDiagnostic = async () => {
    if (!sessionId) return;

    const totalTimeSpent = Math.round((Date.now() - startTime) / 1000);
    
    // Подсчёт результатов по номерам
    const topicResults: Record<number, { correct: number; total: number }> = {};
    
    problems.forEach((problem, index) => {
      const p = problem as DiagnosticProblem;
      if (!topicResults[p.ege_number]) {
        topicResults[p.ege_number] = { correct: 0, total: 0 };
      }
      topicResults[p.ege_number].total++;
      if (results[index]) {
        topicResults[p.ege_number].correct++;
      }
    });

    // Подсчёт первичного балла (за каждый правильный ответ 1-12 — по 1 баллу)
    const correctAnswers = Object.values(results).filter(Boolean).length;
    const primaryScore = correctAnswers;
    
    // Приблизительный перевод в тестовые баллы (упрощённая формула)
    const testScore = Math.round(primaryScore * 8.3);

    // Определяем слабые темы (менее 50% правильных)
    const weak: number[] = [];
    const strong: number[] = [];
    
    Object.entries(topicResults).forEach(([numStr, data]) => {
      const num = parseInt(numStr);
      const accuracy = data.total > 0 ? data.correct / data.total : 0;
      if (accuracy < 0.5) {
        weak.push(num);
      } else if (accuracy >= 0.8) {
        strong.push(num);
      }
    });

    try {
      // Обновляем сессию
      await supabase
        .from('diagnostic_sessions')
        .update({
          status: 'completed',
          predicted_primary_score: primaryScore,
          predicted_test_score: testScore,
          topic_scores: topicResults,
          weak_topics: weak,
          strong_topics: strong,
          recommended_start_topic: weak[0] || 1,
          completed_at: new Date().toISOString(),
          time_spent_seconds: totalTimeSpent,
        })
        .eq('id', sessionId);

      // Обновляем профиль
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from('profiles')
          .update({
            diagnostic_completed: true,
            last_diagnostic_at: new Date().toISOString(),
            last_diagnostic_score: testScore,
          })
          .eq('id', user.id);
      }

      setFinalScore({ primary: primaryScore, test: testScore });
      setWeakTopics(weak);
      setIsComplete(true);
    } catch (error) {
      console.error('Error completing diagnostic:', error);
      toast.error('Ошибка завершения диагностики');
    }
  };

  // Начать практику по слабой теме
  const handleStartPractice = (egeNumber?: number) => {
    if (egeNumber) {
      navigate('/practice', { state: { selectedNumber: egeNumber } });
    } else {
      navigate('/practice');
    }
  };

  if (isLoadingProblems) {
    return (
      <AuthGuard>
        <PageContent>
          <div className="flex items-center justify-center min-h-[60vh]">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        </PageContent>
      </AuthGuard>
    );
  }

  if (isComplete && finalScore) {
    return (
      <AuthGuard>
        <PageContent>
          <div className="container mx-auto px-4 py-6 max-w-2xl">
            <Card className="border-2 border-primary/20">
              <CardHeader className="text-center">
                <Trophy className="w-16 h-16 mx-auto text-yellow-500 mb-4" />
                <CardTitle className="text-2xl">Диагностика завершена!</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-2 gap-4 text-center">
                  <div className="p-4 bg-muted rounded-lg">
                    <div className="text-3xl font-bold text-primary">{finalScore.primary}/12</div>
                    <div className="text-sm text-muted-foreground">Первичный балл</div>
                  </div>
                  <div className="p-4 bg-muted rounded-lg">
                    <div className="text-3xl font-bold text-primary">~{finalScore.test}</div>
                    <div className="text-sm text-muted-foreground">Тестовый балл</div>
                  </div>
                </div>

                {weakTopics.length > 0 && (
                  <div>
                    <h3 className="font-semibold mb-3">📚 Рекомендуем подтянуть:</h3>
                    <div className="space-y-2">
                      {weakTopics.slice(0, 3).map(num => (
                        <Button
                          key={num}
                          variant="outline"
                          className="w-full justify-between"
                          onClick={() => handleStartPractice(num as EGENumber)}
                        >
                          <span>№{num}: {EGE_NUMBERS[num as EGENumber]?.name || 'Задание'}</span>
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-3">
                  <Button 
                    variant="outline" 
                    className="flex-1"
                    onClick={() => navigate('/practice')}
                  >
                    К тренажёру
                  </Button>
                  <Button 
                    className="flex-1"
                    onClick={() => handleStartPractice(weakTopics[0] as EGENumber)}
                  >
                    Начать практику
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </PageContent>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <PageContent>
        <div className="container mx-auto px-4 py-6 max-w-2xl">
          {/* Заголовок */}
          <div className="flex items-center gap-3 mb-6">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/practice')}
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="flex-1">
              <h1 className="text-xl font-bold">Диагностика уровня</h1>
              <p className="text-sm text-muted-foreground">
                Вопрос {currentIndex + 1} из {problems.length}
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="w-4 h-4" />
              <span>~15 мин</span>
            </div>
          </div>

          {/* Прогресс */}
          <Progress value={progressPercent} className="mb-6" />

          {/* Задача */}
          {currentProblem && (
            <Card className="mb-6">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">
                    №{currentProblem.ege_number}: {currentProblem.topic}
                  </span>
                  {results[currentIndex] !== undefined && (
                    results[currentIndex] ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-500" />
                    )
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-lg whitespace-pre-wrap">{currentProblem.condition_text}</p>
                
                {currentProblem.condition_image_url && (
                  <img 
                    src={currentProblem.condition_image_url} 
                    alt="Условие задачи"
                    className="mt-4 max-w-full rounded-lg"
                  />
                )}
              </CardContent>
            </Card>
          )}

          {/* Ввод ответа */}
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Ваш ответ:</label>
              <Input
                type="text"
                value={userAnswer}
                onChange={(e) => setUserAnswer(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmitAnswer()}
                placeholder="Введите ответ..."
                className="text-lg"
                autoFocus
              />
            </div>

            <Button
              className="w-full"
              size="lg"
              onClick={handleSubmitAnswer}
              disabled={!userAnswer.trim() || isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
              ) : currentIndex < problems.length - 1 ? (
                <>
                  Далее
                  <ArrowRight className="w-5 h-5 ml-2" />
                </>
              ) : (
                <>
                  <Target className="w-5 h-5 mr-2" />
                  Завершить диагностику
                </>
              )}
            </Button>
          </div>
        </div>
      </PageContent>
    </AuthGuard>
  );
};

export default Diagnostic;
