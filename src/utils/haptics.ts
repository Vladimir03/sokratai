/**
 * Haptic Feedback Utility
 * Provides tactile feedback for user interactions on mobile devices
 */

/**
 * Типы вибрации для разных действий
 */
export type HapticType = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

/**
 * Проверяет поддержку Vibration API
 */
const isVibrationSupported = (): boolean => {
  return typeof navigator !== 'undefined' && 'vibrate' in navigator;
};

/**
 * Паттерны вибрации для разных типов (в миллисекундах)
 */
const HAPTIC_PATTERNS: Record<HapticType, number | number[]> = {
  light: 10,           // Очень короткий тап (скролл, переключение)
  medium: 20,          // Средний тап (нажатие кнопки)
  heavy: 40,           // Сильный тап (важное действие)
  success: [10, 50, 10], // Двойной тап (успех)
  warning: [20, 100, 20], // Предупреждение
  error: [50, 100, 50, 100, 50], // Ошибка (тройная вибрация)
};

/**
 * Основная функция для вызова haptic feedback
 */
export const triggerHaptic = (type: HapticType = 'light') => {
  if (!isVibrationSupported()) {
    // Silently fail on unsupported devices
    return;
  }

  const pattern = HAPTIC_PATTERNS[type];
  
  try {
    navigator.vibrate(pattern);
  } catch (error) {
    console.error('Failed to trigger haptic feedback:', error);
  }
};

/**
 * Специализированные функции для разных действий
 */
export const haptics = {
  // Лёгкое нажатие (кнопка скролла, свайп)
  tap: () => triggerHaptic('light'),
  
  // Обычное нажатие кнопки
  button: () => triggerHaptic('medium'),
  
  // Важное действие (отправка сообщения)
  impact: () => triggerHaptic('heavy'),
  
  // Успешное действие
  success: () => triggerHaptic('success'),
  
  // Предупреждение
  warning: () => triggerHaptic('warning'),
  
  // Ошибка
  error: () => triggerHaptic('error'),
};

