import { useState } from 'react';
import { Bell, Check, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { InstallSheet } from '@/components/pwa/InstallSheet';
import { useNotificationsSetup } from '@/hooks/useNotificationsSetup';

/**
 * Постоянная точка входа «Приложение и уведомления» в профиле (обе роли) —
 * кто закрыл баннер, всегда может вернуться сюда. Показывает состояние и
 * даёт тот же smart-CTA (один клик на платформу).
 */
export function AppNotificationsCard() {
  const setup = useNotificationsSetup();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const pushRow = (() => {
    if (setup.pushState === 'granted') {
      // granted без реальной PushSubscription = уведомления НЕ приходят
      // (ревью 5.6 P1: не показывать ложное «Включены»).
      if (setup.subscriptionMissing) {
        return { status: 'Требуется повторное включение', ok: false, cta: 'Включить' };
      }
      return { status: 'Включены', ok: true, cta: null as string | null };
    }
    if (setup.pushState === 'denied') {
      return { status: 'Заблокированы в настройках браузера', ok: false, cta: null };
    }
    if (setup.pushState === 'default') {
      return { status: 'Выключены', ok: false, cta: 'Включить' };
    }
    // unsupported: на iOS в браузере путь к уведомлениям = установка
    return {
      status: setup.isMobile && !setup.isInstalled ? 'Доступны после установки' : 'Недоступны в этом браузере',
      ok: false,
      cta: null,
    };
  })();

  const installRow = (() => {
    if (!setup.isMobile) return null; // desktop — установка не предлагается
    if (setup.isInstalled) return { status: 'Установлено', ok: true, cta: null as string | null };
    return { status: 'Не установлено', ok: false, cta: 'Установить' };
  })();

  const handlePush = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await setup.runPush();
      if (ok) toast.success('Уведомления включены!');
      else if ('Notification' in window && Notification.permission === 'denied') {
        toast.info('Уведомления заблокированы в настройках браузера');
      } else {
        toast.error('Не удалось включить уведомления. Попробуйте ещё раз.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleInstall = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (setup.capability === 'native-prompt') {
        const outcome = await setup.runNativeInstall();
        if (outcome === 'accepted') toast.success('Сократ добавлен на экран телефона!');
      } else {
        setSheetOpen(true);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-base font-semibold text-slate-900">Приложение и уведомления</h3>
      <div className="mt-3 space-y-3">
        {installRow && (
          <div className="flex items-center gap-3">
            <Smartphone className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900">Сократ на экране телефона</p>
              <p className="flex items-center gap-1 text-xs text-slate-500">
                {installRow.ok && <Check className="h-3 w-3 text-accent" aria-hidden="true" />}
                {installRow.status}
              </p>
            </div>
            {installRow.cta && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleInstall()}
                className="min-h-[36px] shrink-0 rounded-lg bg-accent px-3.5 text-sm font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-60"
                style={{ touchAction: 'manipulation' }}
              >
                {installRow.cta}
              </button>
            )}
          </div>
        )}
        <div className="flex items-center gap-3">
          <Bell className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-900">Уведомления</p>
            <p className="flex items-center gap-1 text-xs text-slate-500">
              {pushRow.ok && <Check className="h-3 w-3 text-accent" aria-hidden="true" />}
              {pushRow.status}
            </p>
          </div>
          {pushRow.cta && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handlePush()}
              className="min-h-[36px] shrink-0 rounded-lg bg-accent px-3.5 text-sm font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-60"
              style={{ touchAction: 'manipulation' }}
            >
              {pushRow.cta}
            </button>
          )}
        </div>
      </div>
      <InstallSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </div>
  );
}

export default AppNotificationsCard;
