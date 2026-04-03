import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MiniAppLayout } from '@/components/miniapp/MiniAppLayout';
import { RecentSolutionsList, type RecentSolutionItem } from '@/components/miniapp/RecentSolutionsList';
import { supabase } from '@/lib/supabaseClient';

/**
 * Main entry point for Telegram Mini App
 * Redirects to example solution or shows welcome screen
 */
export default function MiniApp() {
  const navigate = useNavigate();
  const [solutions, setSolutions] = useState<RecentSolutionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tg = useMemo(() => window.Telegram?.WebApp, []);
  const isTelegram = Boolean(tg?.initData);

  useEffect(() => {
    if (tg?.initDataUnsafe?.user) {
      console.log('Telegram user:', tg.initDataUnsafe.user);
    }
  }, [tg]);

  useEffect(() => {
    const loadRecentSolutions = async () => {
      if (!tg?.initData) {
        setSolutions([
          {
            id: 'example',
            created_at: new Date().toISOString(),
            problem_preview: 'Пример решения: квадратное уравнение',
            subject: 'Алгебра',
          },
        ]);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const { data, error } = await supabase.functions.invoke('telegram-webapp-recent-solutions', {
          body: { initData: tg.initData },
        });

        if (error) {
          throw new Error(error.message || 'Не удалось загрузить решения');
        }

        if (!data?.solutions) {
          throw new Error('Некорректный ответ сервера');
        }

        setSolutions(data.solutions as RecentSolutionItem[]);
      } catch (err) {
        console.error('MiniApp recent solutions error:', err);
        setError(err instanceof Error ? err.message : 'Не удалось загрузить решения');
      } finally {
        setLoading(false);
      }
    };

    loadRecentSolutions();
  }, [tg]);

  const goToExampleSolution = () => {
    navigate('/miniapp/solution/example');
  };

  return (
    <MiniAppLayout>
      <div className="max-w-2xl mx-auto py-8 space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--tg-theme-text-color, hsl(var(--foreground)))' }}>
            Сократ AI
          </h1>
          <p className="text-base" style={{ color: 'var(--tg-theme-hint-color, hsl(var(--muted-foreground)))' }}>
            Дашборд решений по математике и физике
          </p>
        </div>

        {/* Recent solutions */}
        <div
          className="rounded-2xl shadow-lg p-6"
          style={{
            backgroundColor: 'var(--tg-theme-bg-color, hsl(var(--card)))',
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: 'var(--tg-theme-hint-color, hsl(var(--border)))',
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold" style={{ color: 'var(--tg-theme-text-color, hsl(var(--foreground)))' }}>
              Последние решения
            </h2>
            {!isTelegram && (
              <span className="text-xs" style={{ color: 'var(--tg-theme-hint-color, hsl(var(--muted-foreground)))' }}>
                Открой Mini App из Telegram, чтобы увидеть свои решения
              </span>
            )}
          </div>
          <RecentSolutionsList
            items={solutions}
            loading={loading}
            error={error}
            onOpen={(solutionId) => navigate(`/miniapp/solution/${solutionId}`)}
          />
        </div>

        {/* Quick actions */}
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            onClick={goToExampleSolution}
            className="w-full py-4 px-5 rounded-xl font-semibold text-left shadow-sm transition-transform active:scale-95"
            style={{
              backgroundColor: 'var(--tg-theme-button-color, hsl(var(--primary)))',
              color: 'var(--tg-theme-button-text-color, hsl(var(--primary-foreground)))',
            }}
          >
            📱 Посмотреть пример решения
            <div className="text-xs mt-2 opacity-80">Быстрое знакомство с форматом</div>
          </button>
          <div
            className="w-full py-4 px-5 rounded-xl shadow-sm"
            style={{
              backgroundColor: 'var(--tg-theme-secondary-bg-color, hsl(var(--secondary)))',
              color: 'var(--tg-theme-text-color, hsl(var(--foreground)))',
            }}
          >
            <div className="font-semibold">📸 Отправь задачу боту</div>
            <div className="text-xs mt-2" style={{ color: 'var(--tg-theme-hint-color, hsl(var(--muted-foreground)))' }}>
              Получишь кнопку для открытия полного решения здесь
            </div>
          </div>
        </div>

        {/* How it works */}
        <div
          className="rounded-2xl shadow-sm p-6"
          style={{
            backgroundColor: 'var(--tg-theme-bg-color, hsl(var(--card)))',
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: 'var(--tg-theme-hint-color, hsl(var(--border)))',
          }}
        >
          <h3 className="text-lg font-bold mb-3" style={{ color: 'var(--tg-theme-text-color, hsl(var(--foreground)))' }}>
            Как это работает
          </h3>
          <ul className="space-y-2 text-sm">
            {[
              'Отправь задачу боту и получи краткий ответ',
              'Нажми кнопку «Открыть полное решение»',
              'Изучи шаги, формулы и итоговый ответ',
            ].map((item, index) => (
              <li key={index} className="flex items-start gap-2">
                <span>•</span>
                <span style={{ color: 'var(--tg-theme-text-color, hsl(var(--foreground)))' }}>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </MiniAppLayout>
  );
}
