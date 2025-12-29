import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

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

interface DiagnosticSession {
  id: string;
  user_id: string;
  status: string;
  predicted_primary_score: number | null;
  predicted_test_score: number | null;
  topic_scores: unknown;
  weak_topics: number[] | null;
  strong_topics: number[] | null;
  recommended_start_topic: number | null;
  current_question: number;
  total_questions: number;
  started_at: string;
  completed_at: string | null;
  time_spent_seconds: number | null;
}

// Получение задач для диагностики
export const useDiagnosticProblems = () => {
  return useQuery({
    queryKey: ['diagnostic-problems'],
    queryFn: async (): Promise<DiagnosticProblem[]> => {
      // Получаем по одной задаче для каждого номера 1-12
      const { data, error } = await supabase
        .from('ege_problems')
        .select('id, ege_number, condition_text, condition_image_url, answer_type, correct_answer, topic, subtopic, difficulty')
        .eq('is_active', true)
        .gte('ege_number', 1)
        .lte('ege_number', 12)
        .order('ege_number');

      if (error) throw error;

      // Группируем по номеру и берём по одной случайной задаче
      const problemsByNumber: Record<number, DiagnosticProblem[]> = {};
      
      (data || []).forEach(problem => {
        if (!problemsByNumber[problem.ege_number]) {
          problemsByNumber[problem.ege_number] = [];
        }
        problemsByNumber[problem.ege_number].push(problem as DiagnosticProblem);
      });

      // Выбираем по одной случайной задаче для каждого номера
      const selectedProblems: DiagnosticProblem[] = [];
      
      for (let num = 1; num <= 12; num++) {
        const problems = problemsByNumber[num];
        if (problems && problems.length > 0) {
          const randomIndex = Math.floor(Math.random() * problems.length);
          selectedProblems.push(problems[randomIndex]);
        }
      }

      return selectedProblems;
    },
    staleTime: 0, // Всегда свежие данные для новой диагностики
  });
};

// Создание сессии диагностики
export const useDiagnosticSession = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('diagnostic_sessions')
        .insert({
          user_id: user.id,
          total_questions: 12,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['last-diagnostic'] });
    },
  });
};

// Получение последнего результата диагностики
export const useLastDiagnosticResult = () => {
  return useQuery({
    queryKey: ['last-diagnostic'],
    queryFn: async (): Promise<DiagnosticSession | null> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data, error } = await supabase
        .from('diagnostic_sessions')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data as DiagnosticSession | null;
    },
  });
};

// Получение всех результатов диагностики пользователя
export const useDiagnosticHistory = () => {
  return useQuery({
    queryKey: ['diagnostic-history'],
    queryFn: async (): Promise<DiagnosticSession[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from('diagnostic_sessions')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false });

      if (error) throw error;
      return (data || []) as DiagnosticSession[];
    },
  });
};
