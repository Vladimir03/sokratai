import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import type { EgeProblem, EGENumber } from '@/types/practice';
import { EGE_NUMBERS } from '@/types/practice';

// Типы для диагностики
export type DiagnosticStatus = 'in_progress' | 'completed' | 'abandoned';

export interface TopicScore {
  ege_number: number;
  topic_name: string;
  correct: number;
  total: number;
  score: number; // 0-100%
  recommendation: 'strong' | 'average' | 'weak';
}

export interface DiagnosticResult {
  primaryScore: number;
  testScore: number;
  topicScores: TopicScore[];
  weakTopics: TopicScore[];
  strongTopics: TopicScore[];
  recommendedTopic: TopicScore | null;
  totalQuestions: number;
  correctAnswers: number;
  timeSpentMinutes: number;
  answersBreakdown?: Array<{
    problem: EgeProblem;
    userAnswer: string;
    isCorrect: boolean;
  }>;
}

export interface DiagnosticSession {
  id: string;
  user_id: string;
  status: DiagnosticStatus;
  predicted_primary_score: number | null;
  predicted_test_score: number | null;
  topic_scores: any;
  weak_topics: number[] | null;
  strong_topics: number[] | null;
  recommended_start_topic: number | null;
  current_question: number;
  total_questions: number;
  started_at: string;
  completed_at: string | null;
  time_spent_seconds: number | null;
}

const DIAGNOSTIC_TOTAL_QUESTIONS = 12;
const DIAGNOSTIC_COOLDOWN_DAYS = 14;

// Шкала 2025 года (Профиль, Часть 1)
export function primaryToTestScore(primary: number): number {
  const scale: Record<number, number> = {
    0: 0, 1: 5, 2: 11, 3: 18, 4: 25, 5: 34, 6: 40,
    7: 46, 8: 52, 9: 58, 10: 64, 11: 70, 12: 72,
  };
  return scale[primary] || 0;
}

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

// Проверка возможности прохождения
export const useCanTakeDiagnostic = () => {
  const { data: user } = useCurrentUser();
  return useQuery({
    queryKey: ['canTakeDiagnostic', user?.id],
    queryFn: async () => {
      if (!user) return { canTake: false, reason: 'not_authenticated', daysUntilRetake: 0 };
      const { data: lastSession } = await supabase
        .from('diagnostic_sessions')
        .select('completed_at')
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!lastSession) return { canTake: true, reason: 'never_taken', daysUntilRetake: 0 };
      const lastDate = new Date(lastSession.completed_at);
      const now = new Date();
      const daysSince = Math.floor((now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
      const daysUntilRetake = Math.max(0, DIAGNOSTIC_COOLDOWN_DAYS - daysSince);
      return { canTake: daysSince >= DIAGNOSTIC_COOLDOWN_DAYS, reason: daysSince >= DIAGNOSTIC_COOLDOWN_DAYS ? 'cooldown_passed' : 'cooldown_active', daysUntilRetake };
    },
    enabled: !!user,
  });
};

// Получение существующей сессии
export const useExistingSession = () => {
  const { data: user } = useCurrentUser();
  return useQuery({
    queryKey: ['existingDiagnosticSession', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from('diagnostic_sessions')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'in_progress')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as DiagnosticSession | null;
    },
    enabled: !!user,
  });
};

// Получение задач
export const useDiagnosticProblems = () => {
  return useQuery({
    queryKey: ['diagnostic-problems'],
    queryFn: async (): Promise<EgeProblem[]> => {
      const { data, error } = await supabase
        .from('ege_problems')
        .select('*')
        .eq('is_active', true)
        .gte('ege_number', 1)
        .lte('ege_number', 12);
      if (error) throw error;

      const problemsByNumber: Record<number, EgeProblem[]> = {};
      (data || []).forEach(p => {
        if (!problemsByNumber[p.ege_number]) problemsByNumber[p.ege_number] = [];
        problemsByNumber[p.ege_number].push(p as EgeProblem);
      });

      const selected: EgeProblem[] = [];
      for (let i = 1; i <= 12; i++) {
        const list = problemsByNumber[i] || [];
        if (list.length > 0) {
          selected.push(list[Math.floor(Math.random() * list.length)]);
        }
      }
      return selected;
    },
  });
};

// Основной хук управления диагностикой
export const useDiagnostic = () => {
  const { data: user } = useCurrentUser();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<DiagnosticSession | null>(null);
  const [problems, setProblems] = useState<EgeProblem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [results, setResults] = useState<Record<number, boolean>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DiagnosticResult | null>(null);

  const startDiagnostic = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const { data: newSession, error: sErr } = await supabase
        .from('diagnostic_sessions')
        .insert({ user_id: user.id, total_questions: DIAGNOSTIC_TOTAL_QUESTIONS })
        .select().single();
      if (sErr) throw sErr;

      const { data: pData } = await supabase.from('ege_problems').select('*').eq('is_active', true).gte('ege_number', 1).lte('ege_number', 12);
      const problemsByNumber: Record<number, EgeProblem[]> = {};
      pData?.forEach(p => {
        if (!problemsByNumber[p.ege_number]) problemsByNumber[p.ege_number] = [];
        problemsByNumber[p.ege_number].push(p as EgeProblem);
      });
      const selected: EgeProblem[] = [];
      for (let i = 1; i <= 12; i++) {
        const list = problemsByNumber[i] || [];
        if (list.length > 0) selected.push(list[Math.floor(Math.random() * list.length)]);
      }

      setSession(newSession as unknown as DiagnosticSession);
      setProblems(selected);
      setCurrentIndex(0);
      setAnswers({});
      setResults({});
      setResult(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  const continueSession = useCallback(async (existing: DiagnosticSession) => {
    setIsLoading(true);
    try {
      const { data: pData } = await supabase.from('ege_problems').select('*').eq('is_active', true).gte('ege_number', 1).lte('ege_number', 12);
      const problemsByNumber: Record<number, EgeProblem[]> = {};
      pData?.forEach(p => {
        if (!problemsByNumber[p.ege_number]) problemsByNumber[p.ege_number] = [];
        problemsByNumber[p.ege_number].push(p as EgeProblem);
      });
      const selected: EgeProblem[] = [];
      for (let i = 1; i <= 12; i++) {
        const list = problemsByNumber[i] || [];
        if (list.length > 0) selected.push(list[0]); // Временно так для простоты восстановления
      }

      const { data: ansData } = await supabase.from('diagnostic_answers').select('*').eq('session_id', existing.id).order('question_order');
      const ansMap: Record<number, string> = {};
      const resMap: Record<number, boolean> = {};
      ansData?.forEach((a, i) => {
        ansMap[i] = a.user_answer;
        resMap[i] = a.is_correct;
      });

      setSession(existing as unknown as DiagnosticSession);
      setProblems(selected);
      setCurrentIndex(existing.current_question - 1);
      setAnswers(ansMap);
      setResults(resMap);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const submitAnswer = useCallback(async (userAns: string) => {
    if (!session || !problems[currentIndex]) return;
    const problem = problems[currentIndex];
    const normalize = (s: string) => s.trim().toLowerCase().replace(/,/g, '.').replace(/\s+/g, '');
    const isCorrect = normalize(userAns) === normalize(problem.correct_answer);

    try {
      await supabase.from('diagnostic_answers').insert({
        session_id: session.id,
        problem_id: problem.id,
        ege_number: problem.ege_number,
        user_answer: userAns,
        is_correct: isCorrect,
        question_order: currentIndex + 1
      });

      const newAnswers = { ...answers, [currentIndex]: userAns };
      const newResults = { ...results, [currentIndex]: isCorrect };
      setAnswers(newAnswers);
      setResults(newResults);

      if (currentIndex < problems.length - 1) {
        const next = currentIndex + 1;
        setCurrentIndex(next);
        await supabase.from('diagnostic_sessions').update({ current_question: next + 1 }).eq('id', session.id);
      } else {
        // Complete
        const correctCount = Object.values(newResults).filter(Boolean).length;
        const testScore = primaryToTestScore(correctCount);
        const weak = problems.filter((_, i) => !newResults[i]).map(p => p.ege_number);
        
        await supabase.from('diagnostic_sessions').update({
          status: 'completed',
          predicted_primary_score: correctCount,
          predicted_test_score: testScore,
          completed_at: new Date().toISOString(),
          weak_topics: weak
        }).eq('id', session.id);

        if (user) {
          await supabase.from('profiles').update({
            diagnostic_completed: true,
            last_diagnostic_at: new Date().toISOString(),
            last_diagnostic_score: testScore
          }).eq('id', user.id);
        }

        setResult({
          primaryScore: correctCount,
          testScore,
          totalQuestions: problems.length,
          correctAnswers: correctCount,
          timeSpentMinutes: 15,
          topicScores: [], // Заполнить если нужно
          weakTopics: [],
          strongTopics: [],
          recommendedTopic: null,
          answersBreakdown: problems.map((p, i) => ({
            problem: p,
            userAnswer: newAnswers[i],
            isCorrect: newResults[i]
          }))
        });
      }
    } catch (err: any) {
      setError(err.message);
    }
  }, [session, problems, currentIndex, answers, results, user]);

  return { session, currentProblem: problems[currentIndex], currentIndex, totalQuestions: problems.length, answers, results, isLoading, error, result, startDiagnostic, continueSession, submitAnswer };
};

export const useLastDiagnosticResult = () => {
  const { data: user } = useCurrentUser();
  return useQuery({
    queryKey: ['lastDiagnosticResult', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from('diagnostic_sessions')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });
};

export const useDiagnosticSession = () => {
  // Mock for existing references
  return { mutateAsync: async () => {} };
};
