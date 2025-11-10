/**
 * Type definitions for solution data structure
 */

export interface SolutionStep {
  number: number;
  title: string;
  content: string;
  formula?: string;
  method?: string;
}

export interface Solution {
  id: string;
  problem: string;
  steps: SolutionStep[];
  finalAnswer: string;
  subject?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  createdAt?: string;
}

/**
 * Telegram WebApp types
 */
export interface TelegramWebApp {
  ready: () => void;
  expand: () => void;
  close: () => void;
  BackButton: {
    show: () => void;
    hide: () => void;
    onClick: (callback: () => void) => void;
    offClick: (callback: () => void) => void;
  };
  themeParams: {
    bg_color?: string;
    text_color?: string;
    hint_color?: string;
    link_color?: string;
    button_color?: string;
    button_text_color?: string;
    secondary_bg_color?: string;
  };
  colorScheme: 'light' | 'dark';
  initDataUnsafe: {
    user?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
    };
  };
}

declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp;
    };
  }
}
