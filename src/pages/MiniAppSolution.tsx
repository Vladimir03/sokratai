import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MiniAppLayout } from '@/components/miniapp/MiniAppLayout';
import { SolutionView } from '@/components/miniapp/SolutionView';
import { BackButton } from '@/components/miniapp/BackButton';
import { supabase } from '@/integrations/supabase/client';
import type { Solution } from '@/types/solution';

/**
 * Example solution data for testing
 */
const EXAMPLE_SOLUTION: Solution = {
  id: 'example',
  problem: 'Решите уравнение: x² - 5x + 6 = 0',
  subject: 'Алгебра',
  difficulty: 'medium',
  steps: [
    {
      number: 1,
      title: 'Определяем коэффициенты',
      content: 'В квадратном уравнении ax² + bx + c = 0 определим коэффициенты:',
      formula: 'a = 1, \\quad b = -5, \\quad c = 6',
      method: 'Стандартная форма квадратного уравнения'
    },
    {
      number: 2,
      title: 'Вычисляем дискриминант',
      content: 'Используем формулу дискриминанта для определения количества корней:',
      formula: 'D = b^2 - 4ac = (-5)^2 - 4 \\cdot 1 \\cdot 6 = 25 - 24 = 1',
      method: 'Формула дискриминанта: D = b² - 4ac'
    },
    {
      number: 3,
      title: 'Анализируем результат',
      content: 'Так как дискриминант D = 1 > 0, уравнение имеет два различных действительных корня.',
      method: 'Критерий существования корней'
    },
    {
      number: 4,
      title: 'Находим первый корень',
      content: 'Применяем формулу корней квадратного уравнения:',
      formula: 'x_1 = \\frac{-b + \\sqrt{D}}{2a} = \\frac{5 + \\sqrt{1}}{2 \\cdot 1} = \\frac{5 + 1}{2} = 3',
      method: 'Формула корней: x = (-b ± √D) / 2a'
    },
    {
      number: 5,
      title: 'Находим второй корень',
      content: 'Используем ту же формулу с другим знаком:',
      formula: 'x_2 = \\frac{-b - \\sqrt{D}}{2a} = \\frac{5 - \\sqrt{1}}{2 \\cdot 1} = \\frac{5 - 1}{2} = 2',
      method: 'Формула корней: x = (-b ± √D) / 2a'
    },
  ],
  finalAnswer: 'x_1 = 3, \\quad x_2 = 2',
};

/**
 * Solution detail page for Telegram Mini App
 */
export default function MiniAppSolution() {
  const { id } = useParams<{ id: string }>();
  const [solution, setSolution] = useState<Solution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSolution = async () => {
      console.log('MiniAppSolution: Starting fetch for ID:', id);
      console.log('MiniAppSolution: Current URL:', window.location.href);
      
      try {
        setLoading(true);

        if (id === 'example') {
          // Use example solution for testing
          await new Promise(resolve => setTimeout(resolve, 500)); // Simulate loading
          setSolution(EXAMPLE_SOLUTION);
        } else {
          console.log('🔍 MiniAppSolution: Calling edge function get-solution with ID:', id);

          try {
            // Fetch from edge function (bypasses RLS)
            const { data, error } = await supabase.functions.invoke('get-solution', {
              body: { id }
            });

            console.log('🔍 MiniAppSolution: Edge function response received');
            console.log('🔍 MiniAppSolution: Has data:', !!data);
            console.log('🔍 MiniAppSolution: Has error:', !!error);
            console.log('🔍 MiniAppSolution: Data success:', data?.success);
            console.log('🔍 MiniAppSolution: Error details:', error);
            console.log('🔍 MiniAppSolution: Response data:', data);

            if (error) {
              console.error('❌ MiniAppSolution: Edge function error:', error);
              throw new Error(`Ошибка при загрузке: ${error.message || 'Решение не найдено'}`);
            }

            if (!data?.success || !data?.data) {
              console.error('❌ MiniAppSolution: Invalid response structure:', { data });
              throw new Error('Решение не найдено (неверная структура ответа)');
            }

          const dbData = data.data;
          
          console.log('✅ MiniAppSolution: Got solution data from DB');
          console.log('✅ MiniAppSolution: Solution ID:', dbData.id);
          console.log('✅ MiniAppSolution: Problem text:', dbData.problem_text?.substring(0, 50));
          console.log('✅ MiniAppSolution: Solution data keys:', Object.keys(dbData.solution_data || {}));
          console.log('✅ MiniAppSolution: Steps count:', dbData.solution_data?.solution_steps?.length || 0);
          
          // Transform database structure to Solution type
          const solutionData = dbData.solution_data as any;
          
          if (!solutionData) {
            console.error('❌ MiniAppSolution: solution_data is null or undefined');
            throw new Error('Некорректные данные решения');
          }
          
          const transformedSolution: Solution = {
            id: dbData.id,
            problem: dbData.problem_text || 'Задача не указана',
            steps: solutionData.solution_steps || [],
            finalAnswer: solutionData.final_answer || '',
            createdAt: dbData.created_at,
          };

          console.log('✅ MiniAppSolution: Transformed solution:', {
            id: transformedSolution.id,
            problemLength: transformedSolution.problem.length,
            stepsCount: transformedSolution.steps.length,
            hasFinalAnswer: !!transformedSolution.finalAnswer
          });

          setSolution(transformedSolution);
          } catch (fetchError) {
            console.error('❌ MiniAppSolution: Error in fetch block:', fetchError);
            throw fetchError;
          }
        }
      } catch (err) {
        console.error('Error fetching solution:', err);
        setError(err instanceof Error ? err.message : 'Не удалось загрузить решение');
      } finally {
        setLoading(false);
      }
    };

    fetchSolution();
  }, [id]);

  if (loading) {
    return (
      <MiniAppLayout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 mx-auto mb-4"
                 style={{ borderColor: 'var(--tg-theme-button-color, hsl(var(--primary)))' }} />
            <p style={{ color: 'var(--tg-theme-text-color, hsl(var(--foreground)))' }}>
              Загрузка решения...
            </p>
          </div>
        </div>
      </MiniAppLayout>
    );
  }

  if (error || !solution) {
    return (
      <MiniAppLayout>
        <BackButton />
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center max-w-md">
            <div className="text-6xl mb-4">😕</div>
            <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--tg-theme-text-color, hsl(var(--foreground)))' }}>
              Решение не найдено
            </h2>
            <p style={{ color: 'var(--tg-theme-hint-color, hsl(var(--muted-foreground)))' }}>
              {error || 'Попробуйте открыть другое решение'}
            </p>
          </div>
        </div>
      </MiniAppLayout>
    );
  }

  return (
    <MiniAppLayout>
      <BackButton />
      <div className="py-6">
        <SolutionView solution={solution} />
      </div>
    </MiniAppLayout>
  );
}
