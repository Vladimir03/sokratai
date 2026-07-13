import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, Smartphone, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { InstallSheet } from '@/components/pwa/InstallSheet';
import { useNotificationsSetup } from '@/hooks/useNotificationsSetup';

const DISMISS_KEY = 'sokrat-pwa-nudge-dismissed';
const DISMISS_DURATION_MS = 14 * 24 * 60 * 60 * 1000; // 14 дней (решение Vladimir)

function isDismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = parseInt(raw, 10);
    return Number.isFinite(ts) && Date.now() - ts < DISMISS_DURATION_MS;
  } catch {
    return false;
  }
}

export interface NotificationsNudgeProps {
  /** Куда смонтирован — телеметрия + сообщение по контексту. PII-free. */
  context: string;
  /** Копирайт первичного состояния. */
  message?: string;
  variant?: 'banner' | 'card';
  className?: string;
}

/**
 * Умный надж «уведомления + установка» — ОДНА кнопка, платформа решает сама:
 *   push не спрошен → нативный permission-prompt;
 *   Android без установки → нативный install-диалог (после push морфится в
 *   «Добавьте на экран телефона» — двухшаговый, но каждый шаг = один клик);
 *   iOS в браузере → bottom-sheet с 2 шагами (Apple не даёт программной установки).
 * Закрытие крестиком — пауза 14 дней (общий ключ на все поверхности);
 * постоянный вход остаётся в Профиле.
 */
export function NotificationsNudge({
  context,
  message,
  variant = 'banner',
  className,
}: NotificationsNudgeProps) {
  const setup = useNotificationsSetup();
  const [dismissed, setDismissed] = useState(true); // до эффекта — скрыт (SSR-safe)
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Морф после включения push на Android: предлагаем добить установку.
  const [stage, setStage] = useState<'initial' | 'post-push-install'>('initial');

  useEffect(() => {
    setDismissed(isDismissedRecently());
  }, []);

  const action = setup.nextAction;
  const visible = !dismissed && action !== null;

  useEffect(() => {
    if (visible) {
      console.info('[pwa-nudge] shown', { context, kind: action?.kind });
    }
    // намеренно только на смену видимости/вида
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, action?.kind]);

  const handleDismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore
    }
    setDismissed(true);
    console.info('[pwa-nudge] dismissed', { context });
  }, [context]);

  const handleAction = useCallback(async () => {
    if (!action || busy) return;
    setBusy(true);
    console.info('[pwa-nudge] clicked', { context, kind: action.kind });
    try {
      if (action.kind === 'push') {
        const res = await setup.runPush();
        if (res.ok) {
          if (setup.isMobile && !setup.isInstalled) {
            // Android: уведомления включены → добиваем иконку на экране.
            setStage('post-push-install');
            toast.success('Уведомления включены!');
          } else {
            toast.success('Уведомления включены!');
            setDismissed(true);
          }
        } else if (res.reason === 'permission') {
          if ('Notification' in window && Notification.permission === 'denied') {
            toast.info('Уведомления заблокированы в настройках браузера');
            setDismissed(true); // браузер заблокировал повторный запрос
          }
          // просто закрыл системный промпт — не ругаемся
        } else if (res.reason === 'push-service') {
          toast.error(
            'Браузер не смог подключиться к сервису уведомлений — в России Google-пуши бывают недоступны без VPN. Уведомления будут приходить в Telegram.',
            { duration: 8000 },
          );
        } else {
          toast.error('Не удалось сохранить подписку на сервере. Попробуйте ещё раз.');
        }
        return;
      }
      if (action.kind === 'install-native') {
        const outcome = await setup.runNativeInstall();
        if (outcome === 'accepted') {
          toast.success('Сократ добавлен на экран телефона!');
          setDismissed(true);
        }
        return;
      }
      // install-sheet (iOS / ручной Android)
      setSheetOpen(true);
    } finally {
      setBusy(false);
    }
  }, [action, busy, context, setup]);

  const text = useMemo(() => {
    if (stage === 'post-push-install') {
      return 'Уведомления включены! Добавьте Сократ на экран телефона — открывается как приложение';
    }
    return message ?? 'Включите уведомления, чтобы ничего не пропустить';
  }, [message, stage]);

  const ctaLabel = stage === 'post-push-install' ? 'Добавить на экран' : action?.label ?? '';
  const stageAction = useCallback(async () => {
    if (stage !== 'post-push-install') return handleAction();
    // после push-морфа: нативный install если есть, иначе sheet
    if (setup.capability === 'native-prompt') {
      const outcome = await setup.runNativeInstall();
      if (outcome === 'accepted') {
        toast.success('Сократ добавлен на экран телефона!');
      }
      setDismissed(true);
    } else {
      setSheetOpen(true);
    }
  }, [handleAction, setup, stage]);

  if (!visible && stage !== 'post-push-install') return null;
  if (dismissed) return null;

  const Icon = action?.kind === 'push' && stage === 'initial' ? Bell : Smartphone;

  return (
    <>
      {/* Колонка: строка «иконка + текст + ✕», под ней CTA на всю ширину —
          в узком сайдбаре (w-80) прежний однострочный flex ломал текст в
          столбик слов и наезжал кнопкой (баг превью 2026-07-13). */}
      <div
        className={cn(
          'flex flex-col gap-2.5 transition-all duration-300',
          variant === 'banner'
            ? 'mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 md:p-4'
            : 'mb-4 rounded-lg border border-slate-200 bg-white p-4',
          className,
        )}
      >
        <div className="flex items-start gap-2.5">
          <Icon
            className={cn(
              'mt-0.5 h-5 w-5 shrink-0',
              variant === 'banner' ? 'text-amber-600' : 'text-accent',
            )}
            aria-hidden="true"
          />
          <p
            className={cn(
              'min-w-0 flex-1 text-sm leading-snug md:text-base',
              variant === 'banner' ? 'text-amber-900' : 'text-slate-700',
            )}
          >
            {text}
          </p>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Закрыть"
            className={cn(
              '-m-2 flex h-9 w-9 shrink-0 items-center justify-center transition-colors',
              variant === 'banner'
                ? 'text-amber-500 hover:text-amber-700'
                : 'text-slate-400 hover:text-slate-600',
            )}
            style={{ touchAction: 'manipulation' }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void stageAction()}
          className={cn(
            // ≥44px — students mobile-first (rule 90; ревью 5.6 P2 touch targets)
            'min-h-[44px] w-full rounded-lg px-3.5 text-sm font-semibold text-white transition-colors md:text-base',
            variant === 'banner'
              ? 'bg-amber-600 hover:bg-amber-700'
              : 'bg-accent hover:bg-accent/90',
            busy && 'opacity-60',
          )}
          style={{ touchAction: 'manipulation' }}
        >
          {busy ? '…' : ctaLabel}
        </button>
      </div>

      <InstallSheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          // Посмотрел инструкцию → тот же 14-дневный dismiss, что и крестик
          // (ревью 5.6 P2: локальный setDismissed не персистился — надж тут же
          // всплывал на соседней поверхности).
          if (!open) handleDismiss();
        }}
        subtitle={message}
      />
    </>
  );
}

export default NotificationsNudge;
