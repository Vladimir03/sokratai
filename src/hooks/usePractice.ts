import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import type { EGENumber, EgeProblem, CheckAnswerResult, UserEgeProgress, TodayStats } from '@/types/practice';

// Хук для получения текущего пользователя
const useCurrentUser = () => {
  return useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    },
  });
};

// Основной хук для практики
export const usePractice = (egeNumber: EGENumber | null) => {
  const [currentProblem, setCurrentProblem] = useState<EgeProblem | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionStats, setSessionStats] = useState({ attempted: 0, correct: 0 });
  const startTimeRef = useRef<Date | null>(null);
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUser();

  const loadNextProblem = useCallback(async () => {
    if (!egeNumber) return;
    
    setIsLoading(true);
    try {
      // Получаем случайную задачу для данного номера ЕГЭ
      const { data, error } = await supabase
        .from('ege_problems')
        .select('*')
        .eq('ege_number', egeNumber)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      if (data && data.length > 0) {
        // Фильтруем задачи, где текст ссылается на рисунок, но картинки нет
        const validProblems = data.filter(p => {
          const needsImage = p.condition_text?.toLowerCase().includes('на рисунке') ||
                             p.condition_text?.toLowerCase().includes('изображён') ||
                             p.condition_text?.toLowerCase().includes('показан');
          const hasImage = !!p.condition_image_url;
          return !needsImage || hasImage;
        });
        
        if (validProblems.length === 0) {
          setCurrentProblem(null);
          return;
        }
        
        // Выбираем случайную задачу из валидных
        const randomIndex = Math.floor(Math.random() * validProblems.length);
        const problem = validProblems[randomIndex];
        
        // Преобразуем hints из JSONB в массив строк
        const hints = Array.isArray(problem.hints) 
          ? problem.hints 
          : typeof problem.hints === 'string' 
            ? JSON.parse(problem.hints)
            : [];
            
        setCurrentProblem({
          ...problem,
          hints,
          ege_number: problem.ege_number as EGENumber,
          answer_type: problem.answer_type as EgeProblem['answer_type'],
          difficulty: problem.difficulty as 1 | 2 | 3,
          tags: problem.tags || [],
        });
        startTimeRef.current = new Date();
      } else {
        setCurrentProblem(null);
      }
    } catch (error) {
      console.error('Error loading problem:', error);
      setCurrentProblem(null);
    } finally {
      setIsLoading(false);
    }
  }, [egeNumber]);

  const submitAnswer = useCallback(async (
    answer: string,
    hintsUsed: number,
    askedAi: boolean
  ): Promise<CheckAnswerResult | null> => {
    if (!currentProblem || !user) return null;

    const startedAt = startTimeRef.current || new Date();
    const submittedAt = new Date();

    try {
      // Нормализация и проверка ответа
      const normalizedUserAnswer = normalizeAnswer(answer);
      const normalizedCorrectAnswer = normalizeAnswer(currentProblem.correct_answer);
      
      let isCorrect = false;
      
      if (currentProblem.answer_type === 'integer') {
        isCorrect = parseInt(normalizedUserAnswer) === parseInt(normalizedCorrectAnswer);
      } else if (currentProblem.answer_type === 'decimal') {
        const userNum = parseFloat(normalizedUserAnswer);
        const correctNum = parseFloat(normalizedCorrectAnswer);
        const tolerance = currentProblem.answer_tolerance || 0.001;
        isCorrect = Math.abs(userNum - correctNum) <= tolerance;
      } else {
        isCorrect = normalizedUserAnswer === normalizedCorrectAnswer;
      }

      // Записываем попытку в базу
      const { error: attemptError } = await supabase
        .from('practice_attempts')
        .insert({
          user_id: user.id,
          problem_id: currentProblem.id,
          user_answer: answer,
          is_correct: isCorrect,
          started_at: startedAt.toISOString(),
          submitted_at: submittedAt.toISOString(),
          hints_used: hintsUsed,
          asked_ai: askedAi,
        });

      if (attemptError) {
        console.error('Error saving attempt:', attemptError);
      }

      // Проверяем и обновляем стрейк
      const { data: newStreak, error: streakError } = await supabase
        .rpc('check_and_update_streak', { p_user_id: user.id });

      if (streakError) {
        console.error('Error checking streak:', streakError);
      } else {
        console.log('Streak checked:', newStreak);
      }

      // Обновляем локальную статистику сессии
      setSessionStats(prev => ({
        attempted: prev.attempted + 1,
        correct: prev.correct + (isCorrect ? 1 : 0),
      }));

      // Инвалидируем кеш прогресса
      queryClient.invalidateQueries({ queryKey: ['userProgress'] });
      queryClient.invalidateQueries({ queryKey: ['todayStats'] });

      // Вызываем функцию обновления стрейка
      supabase.rpc('check_and_update_streak', { p_user_id: user.id })
        .then(({ data }) => {
          if (data) queryClient.invalidateQueries({ queryKey: ['todayStats'] });
        });

      return {
        is_correct: isCorrect,
        correct_answer: currentProblem.correct_answer,
        solution_text: currentProblem.solution_text,
        hints: currentProblem.hints,
      };
    } catch (error) {
      console.error('Error submitting answer:', error);
      return null;
    }
  }, [currentProblem, user, queryClient]);

  // Автозагрузка задачи при смене номера ЕГЭ
  useEffect(() => {
    if (egeNumber) {
      loadNextProblem();
    }
  }, [egeNumber, loadNextProblem]);

  return {
    currentProblem,
    isLoading,
    sessionStats,
    loadNextProblem,
    submitAnswer,
  };
};

// Хук для получения прогресса пользователя
// Вычисляет статистику напрямую из practice_attempts
export const useUserProgress = () => {
  const { data: user } = useCurrentUser();
  const { data: problemCounts = {} } = useProblemCounts();

  return useQuery({
    queryKey: ['userProgress', user?.id],
    queryFn: async () => {
      if (!user) return {};

      // Получаем все попытки пользователя с информацией о задаче
      const { data: attempts, error } = await supabase
        .from('practice_attempts')
        .select(`
          problem_id,
          is_correct,
          created_at,
          problem:ege_problems(ege_number)
        `)
        .eq('user_id', user.id);

      if (error) throw error;

      // Группируем по номеру ЕГЭ и вычисляем статистику
      const progressMap: Record<number, UserEgeProgress> = {};
      
      attempts?.forEach((attempt: any) => {
        const egeNumber = attempt.problem?.ege_number;
        const problemId = attempt.problem_id;
        if (!egeNumber) return;

        if (!progressMap[egeNumber]) {
          progressMap[egeNumber] = {
            ege_number: egeNumber as EGENumber,
            total_attempts: 0,
            correct_attempts: 0,
            accuracy: 0,
            current_difficulty: 1,
            last_practiced_at: attempt.created_at,
            problem_statuses: {}
          };
        }

        progressMap[egeNumber].total_attempts += 1;
        
        // Статус задачи: если хоть раз решена верно - зеленая (correct)
        // Если была решена неверно и верных попыток пока нет - красная (incorrect)
        const currentStatus = progressMap[egeNumber].problem_statuses[problemId];
        if (attempt.is_correct) {
          progressMap[egeNumber].problem_statuses[problemId] = 'correct';
          progressMap[egeNumber].correct_attempts += 1;
        } else if (currentStatus !== 'correct') {
          progressMap[egeNumber].problem_statuses[problemId] = 'incorrect';
        }
        
        // Обновляем last_practiced_at если эта попытка новее
        if (attempt.created_at > progressMap[egeNumber].last_practiced_at) {
          progressMap[egeNumber].last_practiced_at = attempt.created_at;
        }
      });

      // Вычисляем процент завершения и current_difficulty
      Object.values(progressMap).forEach(progress => {
        const totalProblemsInNumber = problemCounts[progress.ege_number] || 10;
        const uniqueSolvedOrAttempted = Object.keys(progress.problem_statuses).length;
        
        // Процент - это отношение кол-ва "тронутых" задач к общему кол-ву задач в этом номере
        progress.accuracy = Math.round((uniqueSolvedOrAttempted / totalProblemsInNumber) * 100);
        
        // Адаптивная сложность на основе точности решенных задач (не "тронутых")
        const accuracyRate = progress.total_attempts > 0 
          ? (progress.correct_attempts / progress.total_attempts) * 100 
          : 0;

        if (accuracyRate >= 80 && progress.total_attempts >= 5) {
          progress.current_difficulty = 3;
        } else if (accuracyRate >= 50 && progress.total_attempts >= 3) {
          progress.current_difficulty = 2;
        } else {
          progress.current_difficulty = 1;
        }
      });

      return progressMap;
    },
    enabled: !!user && !!Object.keys(problemCounts).length,
  });
};

// Хук для статистики за сегодня
export const useTodayStats = () => {
  const { data: user } = useCurrentUser();

  return useQuery({
    queryKey: ['todayStats', user?.id],
    queryFn: async (): Promise<TodayStats> => {
      if (!user) {
        return {
          current_streak: 0,
          problems_solved_today: 0,
          correct_today: 0,
          daily_goal_problems: 10,
          xp_today: 0,
        };
      }

      const today = new Date().toISOString().split('T')[0];

      // Получаем попытки за сегодня
      const { data: attempts, error } = await supabase
        .from('practice_attempts')
        .select('is_correct')
        .eq('user_id', user.id)
        .gte('created_at', `${today}T00:00:00`)
        .lte('created_at', `${today}T23:59:59`);

      if (error) throw error;

      const problemsSolved = attempts?.length || 0;
      const correctToday = attempts?.filter(a => a.is_correct).length || 0;
      const xpToday = correctToday * 10 + (problemsSolved - correctToday) * 2;

      // Получаем streak из profiles (обновляется функцией check_and_update_streak)
      const { data: profile } = await supabase
        .from('profiles')
        .select('current_streak')
        .eq('id', user.id)
        .maybeSingle();

      return {
        current_streak: profile?.current_streak || 0,
        problems_solved_today: problemsSolved,
        correct_today: correctToday,
        daily_goal_problems: 10,
        xp_today: xpToday,
      };
    },
    enabled: !!user,
    refetchInterval: 30000, // Обновляем каждые 30 секунд
  });
};

// Хук для подсчёта задач по номерам
export const useProblemCounts = () => {
  return useQuery({
    queryKey: ['problemCounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ege_problems')
        .select('ege_number')
        .eq('is_active', true);

      if (error) throw error;

      const counts: Record<number, number> = {};
      data?.forEach(item => {
        counts[item.ege_number] = (counts[item.ege_number] || 0) + 1;
      });

      return counts;
    },
  });
};

// Вспомогательная функция нормализации ответа
function normalizeAnswer(answer: string): string {
  return answer
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/,/g, '.')
    .replace(/−/g, '-')
    .replace(/–/g, '-');
}

