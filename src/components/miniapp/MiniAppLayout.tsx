import { useEffect, ReactNode } from 'react';

interface MiniAppLayoutProps {
  children: ReactNode;
}

/**
 * Layout wrapper for Telegram Mini App
 * Handles initialization and theme integration
 */
export function MiniAppLayout({ children }: MiniAppLayoutProps) {
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    
    if (tg) {
      // Initialize Telegram Web App
      tg.ready();
      tg.expand();

      // Apply Telegram theme colors to CSS variables
      const themeParams = tg.themeParams;
      if (themeParams) {
        const root = document.documentElement;
        
        if (themeParams.bg_color) {
          root.style.setProperty('--tg-theme-bg-color', themeParams.bg_color);
        }
        if (themeParams.text_color) {
          root.style.setProperty('--tg-theme-text-color', themeParams.text_color);
        }
        if (themeParams.hint_color) {
          root.style.setProperty('--tg-theme-hint-color', themeParams.hint_color);
        }
        if (themeParams.link_color) {
          root.style.setProperty('--tg-theme-link-color', themeParams.link_color);
        }
        if (themeParams.button_color) {
          root.style.setProperty('--tg-theme-button-color', themeParams.button_color);
        }
        if (themeParams.button_text_color) {
          root.style.setProperty('--tg-theme-button-text-color', themeParams.button_text_color);
        }
        if (themeParams.secondary_bg_color) {
          root.style.setProperty('--tg-theme-secondary-bg-color', themeParams.secondary_bg_color);
        }
      }

      // Set background color
      document.body.style.backgroundColor = themeParams.bg_color || '#ffffff';
    }
  }, []);

  return (
    <div
      className="min-h-screen p-4"
      style={{
        backgroundColor: 'var(--tg-theme-bg-color, hsl(var(--background)))',
        color: 'var(--tg-theme-text-color, hsl(var(--foreground)))',
      }}
    >
      {children}
    </div>
  );
}
