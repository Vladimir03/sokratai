/**
 * Хук для интеграции Яндекс.Метрики с React Router
 * 
 * Функции:
 * - Инициализация счётчика один раз при загрузке приложения
 * - Отслеживание всех переходов между страницами (SPA-навигация)
 * - Предотвращение дублирования хитов
 * - Асинхронная загрузка скрипта (не блокирует страницу)
 */

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { YA_METRIKA_ID, YA_METRIKA_ENABLED, YA_METRIKA_OPTIONS } from '@/config/analytics';

// Расширение типов для window.ym
declare global {
  interface Window {
    ym: ((id: number, action: string, ...args: unknown[]) => void) | undefined;
    yaCounterLoaded?: boolean;
  }
}

/**
 * Хук инициализации и отслеживания Яндекс.Метрики
 * Должен вызываться внутри BrowserRouter
 */
export const useYandexMetrika = () => {
  const location = useLocation();
  const prevPathRef = useRef<string | null>(null);
  const initializedRef = useRef(false);

  // Инициализация счётчика (выполняется один раз)
  useEffect(() => {
    if (!YA_METRIKA_ENABLED) {
      console.log('[Yandex.Metrika] Отключена в режиме разработки');
      return;
    }

    if (initializedRef.current || window.yaCounterLoaded) {
      return;
    }

    try {
      // Создаём inline-скрипт инициализации Метрики
      const initScript = document.createElement('script');
      initScript.type = 'text/javascript';
      initScript.innerHTML = `
        (function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
        m[i].l=1*new Date();
        for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
        k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
        (window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");

        ym(${YA_METRIKA_ID}, "init", ${JSON.stringify(YA_METRIKA_OPTIONS)});
      `;
      
      document.head.appendChild(initScript);
      
      initializedRef.current = true;
      window.yaCounterLoaded = true;
      
      console.log('[Yandex.Metrika] Счётчик инициализирован, ID:', YA_METRIKA_ID);
    } catch (error) {
      console.error('[Yandex.Metrika] Ошибка инициализации:', error);
    }
  }, []);

  // Отслеживание переходов между страницами (SPA-навигация)
  useEffect(() => {
    if (!YA_METRIKA_ENABLED) return;

    const currentPath = location.pathname + location.search + location.hash;

    // Предотвращаем дублирование хитов для одной и той же страницы
    if (prevPathRef.current === currentPath) {
      return;
    }

    // Отправляем хит с небольшой задержкой для гарантии загрузки ym
    const timeoutId = setTimeout(() => {
      if (window.ym) {
        window.ym(YA_METRIKA_ID, 'hit', currentPath, {
          title: document.title,
          referer: prevPathRef.current || document.referrer,
        });
        console.log('[Yandex.Metrika] Hit:', currentPath);
      }
    }, 100);

    prevPathRef.current = currentPath;

    return () => clearTimeout(timeoutId);
  }, [location.pathname, location.search, location.hash]);
};

export default useYandexMetrika;
