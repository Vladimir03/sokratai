import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MiniAppLayout } from '@/components/miniapp/MiniAppLayout';

/**
 * Main entry point for Telegram Mini App
 * Redirects to example solution or shows welcome screen
 */
export default function MiniApp() {
  const navigate = useNavigate();

  useEffect(() => {
    // Get user data from Telegram
    const tg = window.Telegram?.WebApp;
    if (tg?.initDataUnsafe?.user) {
      console.log('Telegram user:', tg.initDataUnsafe.user);
    }
  }, []);

  const goToExampleSolution = () => {
    navigate('/miniapp/solution/example');
  };

  return (
    <MiniAppLayout>
      <div className="max-w-2xl mx-auto py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-3" style={{ color: 'var(--tg-theme-text-color, hsl(var(--foreground)))' }}>
            🎓 Сократ
          </h1>
          <p className="text-lg" style={{ color: 'var(--tg-theme-hint-color, hsl(var(--muted-foreground)))' }}>
            Твой AI-помощник для подготовки к ЕГЭ
          </p>
        </div>

        {/* Welcome card */}
        <div
          className="rounded-2xl shadow-lg p-6 mb-6"
          style={{
            backgroundColor: 'var(--tg-theme-bg-color, hsl(var(--card)))',
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: 'var(--tg-theme-hint-color, hsl(var(--border)))',
          }}
        >
          <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--tg-theme-text-color, hsl(var(--foreground)))' }}>
            Добро пожаловать! 👋
          </h2>
          <p className="mb-4" style={{ color: 'var(--tg-theme-text-color, hsl(var(--foreground)))' }}>
            Здесь ты найдёшь подробные решения задач с пошаговым объяснением и красиво оформленными формулами.
          </p>
          <ul className="space-y-2 mb-6">
            {[
              'Пошаговое решение каждой задачи',
              'LaTeX формулы для лучшего понимания',
              'Объяснение методов решения',
              'Прогресс по шагам решения',
            ].map((feature, index) => (
              <li key={index} className="flex items-start gap-2">
                <span className="text-lg">✓</span>
                <span style={{ color: 'var(--tg-theme-text-color, hsl(var(--foreground)))' }}>
                  {feature}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Example solution button */}
        <button
          onClick={goToExampleSolution}
          className="w-full py-4 px-6 rounded-xl font-bold text-lg shadow-lg transition-transform active:scale-95"
          style={{
            backgroundColor: 'var(--tg-theme-button-color, hsl(var(--primary)))',
            color: 'var(--tg-theme-button-text-color, hsl(var(--primary-foreground)))',
          }}
        >
          📱 Посмотреть пример решения
        </button>

        {/* Info */}
        <p className="text-center mt-6 text-sm" style={{ color: 'var(--tg-theme-hint-color, hsl(var(--muted-foreground)))' }}>
          Отправь задачу боту в Telegram, и получи кнопку для открытия полного решения здесь!
        </p>
      </div>
    </MiniAppLayout>
  );
}
