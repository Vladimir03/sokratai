/**
 * PWA install — захват `beforeinstallprompt` + детекция состояния установки.
 *
 * Реальность платформ (определяет весь UX «в один клик»):
 *  - Android/Chromium: браузер даёт `beforeinstallprompt` → наша кнопка вызывает
 *    НАТИВНЫЙ диалог установки (настоящий один клик). Событие фаерится РАНО,
 *    до маунта React — поэтому захват регистрируется в main.tsx через
 *    `initPwaInstallCapture()` и сташится на module-level.
 *  - iOS: программной установки НЕТ (Apple). Максимум — инструкция
 *    «Поделиться → На экран „Домой"» (InstallSheet). Web push на iOS работает
 *    ТОЛЬКО из установленной PWA (16.4+).
 *  - Desktop: install не предлагаем (ценность — телефон), push работает в браузере.
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallCapability =
  /** Уже открыто как установленная PWA (standalone). */
  | 'installed'
  /** Chromium стащил beforeinstallprompt — доступен нативный один клик. */
  | 'native-prompt'
  /** iOS в браузере — только ручная инструкция (sheet). */
  | 'ios-manual'
  /** Android/прочее без события (Яндекс.Браузер и т.п.) — ручная инструкция. */
  | 'mobile-manual'
  /** Desktop / не определить — install-надж не показываем. */
  | 'unsupported';

const INSTALLED_FLAG_KEY = 'sokrat-pwa-installed';

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((cb) => {
    try {
      cb();
    } catch {
      // listener не должен ронять остальных
    }
  });
}

/** Вызывать ОДИН раз в main.tsx — до рендера (beforeinstallprompt фаерится рано). */
export function initPwaInstallCapture(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // не показывать mini-infobar — промптим по нашей кнопке
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    try {
      localStorage.setItem(INSTALLED_FLAG_KEY, '1');
    } catch {
      // ignore
    }
    notify();
  });
}

/** Открыто как установленное приложение (standalone / iOS homescreen). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  // iOS Safari legacy signal
  return (window.navigator as { standalone?: boolean }).standalone === true;
}

export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS 13+ маскируется под Mac, но с тачем
  return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || isIosDevice();
}

/**
 * Была ли установка на ЭТОМ устройстве (standalone-запуск ИЛИ appinstalled-флаг).
 * Флаг из localStorage покрывает случай «установил, но сейчас читает во вкладке
 * браузера» — не наджим повторной установкой.
 */
export function isInstalledOnThisDevice(): boolean {
  if (isStandalone()) return true;
  try {
    return localStorage.getItem(INSTALLED_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

export function getInstallCapability(): InstallCapability {
  if (isInstalledOnThisDevice()) return 'installed';
  if (deferredPrompt) return 'native-prompt';
  if (isIosDevice()) return 'ios-manual';
  if (isMobileDevice()) return 'mobile-manual';
  return 'unsupported';
}

/** Подписка для React (usePwaInstall) — уведомляет о смене capability. */
export function subscribeInstallState(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Нативный install-промпт (Android/Chromium). Один вызов на стащенное событие. */
export async function promptNativeInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const prompt = deferredPrompt;
  if (!prompt) return 'unavailable';
  deferredPrompt = null; // событие одноразовое
  notify();
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === 'accepted') {
      try {
        localStorage.setItem(INSTALLED_FLAG_KEY, '1');
      } catch {
        // ignore
      }
      notify();
      return 'accepted';
    }
    return 'dismissed';
  } catch {
    return 'dismissed';
  }
}
