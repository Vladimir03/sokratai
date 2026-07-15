/**
 * Детект in-app браузера (Telegram / Instagram / VK и т.п. webview) —
 * там нет push, нет установки PWA, сессии могут слетать (решение Vladimir
 * 2026-07-15: наджить «Открой в Safari / браузере» на iOS И Android).
 *
 * Эвристики (консервативные — лучше пропустить, чем наджить зря):
 *  - iOS: WKWebView внутри приложений НЕ несёт токен `Safari/` в UA
 *    (настоящий Safari и iOS-браузеры CriOS/FxiOS/EdgiOS/YaBrowser — несут
 *    свои маркеры). PWA standalone тоже без `Safari/` → исключаем явно.
 *  - Android: системный WebView несёт маркер `; wv)`; Telegram Android
 *    иногда добавляет `Telegram` в UA. Chrome Custom Tabs неотличимы от
 *    Chrome — и НЕ наджим (это почти полноценный браузер).
 *
 * Telegram MiniApp (/miniapp) — намеренно Telegram-поверхность, надж там
 * НЕ монтировать.
 */

export interface InAppBrowserInfo {
  inApp: boolean;
  os: 'ios' | 'android' | 'other';
}

export function detectInAppBrowser(): InAppBrowserInfo {
  try {
    const ua = navigator.userAgent || '';

    // Уже установленная PWA — цель достигнута, не наджим.
    const standalone =
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(display-mode: standalone)').matches);
    if (standalone) return { inApp: false, os: 'other' };

    if (/iPhone|iPad|iPod/.test(ua)) {
      const isRealBrowser =
        /Safari\//.test(ua) || /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|YaBrowser|DuckDuckGo/.test(ua);
      return { inApp: !isRealBrowser, os: 'ios' };
    }

    if (/Android/.test(ua)) {
      const isWebView = /; wv\)/.test(ua) || /Telegram/i.test(ua);
      return { inApp: isWebView, os: 'android' };
    }

    return { inApp: false, os: 'other' };
  } catch {
    return { inApp: false, os: 'other' };
  }
}

/** intent:// ссылка — из Android-webview открывает системный браузер. */
export function buildAndroidBrowserIntentUrl(): string {
  const { host, pathname, search } = window.location;
  return `intent://${host}${pathname}${search}#Intent;scheme=https;end`;
}
