import { useMemo, useState } from 'react';
import { Compass, Copy, Check, X, ExternalLink } from 'lucide-react';
import { detectInAppBrowser, buildAndroidBrowserIntentUrl } from '@/lib/inAppBrowser';
import { copyTextToClipboard } from '@/lib/copyToClipboard';

/**
 * Надж «Открой в браузере» при заходе из in-app webview (Telegram и т.п.) —
 * там нет push/установки PWA, сессии слетают (решение Vladimir 2026-07-15).
 *
 * Self-gating: рендерит null вне webview / после dismiss (14 дней, общий
 * паттерн PWA-наджей). iOS: программного выхода в Safari нет — инструкция
 * (в Telegram кнопка-«компас»/меню ⋯ открывает Safari) + «Скопировать
 * ссылку». Android: intent:// открывает системный браузер + copy-fallback.
 *
 * Монтаж: Login, StudentSchedule, StudentHomework, StudentClaimPage.
 * НЕ монтировать в /miniapp (намеренно Telegram) и fullBleed-экраны
 * (HomeworkProblem — layout-чувствителен, rule 80).
 */

const DISMISS_KEY = 'sokrat-inapp-browser-nudge-dismissed';
const DISMISS_DAYS = 14;

function isDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export function InAppBrowserNudge() {
  const info = useMemo(() => detectInAppBrowser(), []);
  const [hidden, setHidden] = useState(() => isDismissed());
  const [copied, setCopied] = useState(false);

  if (!info.inApp || hidden) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // localStorage может быть недоступен в приватном режиме — просто скрываем
    }
    setHidden(true);
  };

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(window.location.href);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
      <div className="flex items-start gap-2.5">
        <Compass className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">Ты во встроенном браузере</p>
          <p className="mt-0.5 text-xs leading-relaxed text-amber-800">
            {info.os === 'ios'
              ? 'Здесь могут не работать уведомления и слетать вход. Нажми ⋯ (или значок компаса) и выбери «Открыть в Safari».'
              : 'Здесь могут не работать уведомления и слетать вход. Открой Сократ в обычном браузере.'}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {info.os === 'android' && (
              <a
                href={buildAndroidBrowserIntentUrl()}
                className="inline-flex min-h-[44px] items-center gap-1 rounded-md bg-amber-600 px-3 text-xs font-medium text-white"
                style={{ touchAction: 'manipulation' }}
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                Открыть в браузере
              </a>
            )}
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex min-h-[44px] items-center gap-1 rounded-md border border-amber-300 bg-white px-3 text-xs font-medium text-amber-900"
              style={{ touchAction: 'manipulation' }}
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Скопировано
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  Скопировать ссылку
                </>
              )}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Скрыть подсказку"
          className="-m-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-amber-700 hover:bg-amber-100"
          style={{ touchAction: 'manipulation' }}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
