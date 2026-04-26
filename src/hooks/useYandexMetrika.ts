/**
 * Хук для отслеживания SPA-навигации в Яндекс.Метрике
 * 
 * Скрипт Метрики загружается в index.html (основной счётчик).
 * Этот хук только отправляет хиты при смене роутов.
 */

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { YA_METRIKA_ID, YA_METRIKA_ENABLED } from '@/config/analytics';

// Расширение типов для window.ym
declare global {
  interface Window {
    ym?: (id: number, action: string, ...args: unknown[]) => void;
  }
}

/**
 * Хук отслеживания SPA-навигации
 * Должен вызываться внутри BrowserRouter
 */
export const useYandexMetrika = () => {
  const location = useLocation();
  const prevPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!YA_METRIKA_ENABLED) return;

    const currentPath = location.pathname + location.search + location.hash;

    // Предотвращаем дублирование хитов
    if (prevPathRef.current === currentPath) {
      return;
    }

    // Отправляем хит с задержкой для гарантии загрузки ym из index.html
    const timeoutId = setTimeout(() => {
      if (window.ym) {
        window.ym(YA_METRIKA_ID, 'hit', currentPath, {
          title: document.title,
          referer: prevPathRef.current || document.referrer,
        });
      }
    }, 150);

    prevPathRef.current = currentPath;

    return () => clearTimeout(timeoutId);
  }, [location.pathname, location.search, location.hash]);
};

export default useYandexMetrika;
