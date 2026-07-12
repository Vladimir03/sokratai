import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePwaInstall } from '@/hooks/usePwaInstall';
import { isPushSupported, subscribeToPush } from '@/lib/pushApi';
import { isMobileDevice, promptNativeInstall } from '@/lib/pwaInstall';

export type PushState = 'granted' | 'default' | 'denied' | 'unsupported';

export interface NextNotificationsAction {
  kind: 'push' | 'install-native' | 'install-sheet';
  label: string;
}

/**
 * Единая логика «включить уведомления + установить на телефон» для всех
 * поверхностей (баннеры, карточка в профиле, чеклист, пост-сдача).
 *
 * Приоритет действий (value-first, каждое = один клик/тап):
 *   1. push доступен и не спрошен → «Включить уведомления» (нативный prompt);
 *   2. мобильный + не установлено + есть beforeinstallprompt → «Добавить на
 *      экран телефона» (нативный install-диалог, Android);
 *   3. мобильный + не установлено (iOS / браузер без события) → sheet с
 *      2 шагами (на iOS push вообще работает только из установленной PWA).
 * Всё сделано / desktop без push / permission denied → nextAction = null.
 */
export function useNotificationsSetup() {
  const capability = usePwaInstall();
  // Notification.permission нереактивен — бампаем после subscribeToPush.
  const [permissionTick, setPermissionTick] = useState(0);

  const pushState: PushState = useMemo(() => {
    void permissionTick;
    if (!('Notification' in window)) return 'unsupported';
    if (!isPushSupported()) return 'unsupported';
    return Notification.permission as PushState;
  }, [permissionTick]);

  // permission=granted ≠ «уведомления работают» (ревью 5.6 P1): подписка могла
  // не создаться / не сохраниться на бэке. granted БЕЗ PushSubscription →
  // actionable-состояние «завершить настройку» (runPush пересоздаст подписку —
  // permission уже есть, диалог не появится).
  const [subscriptionMissing, setSubscriptionMissing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (
        pushState !== 'granted' ||
        !('serviceWorker' in navigator)
      ) {
        if (!cancelled) setSubscriptionMissing(false);
        return;
      }
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const sub = await registration?.pushManager.getSubscription();
        if (!cancelled) setSubscriptionMissing(!sub);
      } catch {
        if (!cancelled) setSubscriptionMissing(false);
      }
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, [pushState, permissionTick]);

  const mobile = isMobileDevice();
  const installed = capability === 'installed';

  const nextAction: NextNotificationsAction | null = useMemo(() => {
    if (pushState === 'default' || (pushState === 'granted' && subscriptionMissing)) {
      return { kind: 'push', label: 'Включить уведомления' };
    }
    if (mobile && !installed) {
      if (capability === 'native-prompt') {
        return { kind: 'install-native', label: 'Добавить на экран телефона' };
      }
      // iOS: уведомления возможны ТОЛЬКО после установки → это и есть путь к ним.
      return {
        kind: 'install-sheet',
        label: pushState === 'unsupported' ? 'Включить уведомления' : 'Добавить на экран телефона',
      };
    }
    return null;
  }, [capability, installed, mobile, pushState, subscriptionMissing]);

  /** true = подписка создана (permission granted + сохранено на бэке). */
  const runPush = useCallback(async (): Promise<boolean> => {
    const ok = await subscribeToPush();
    setPermissionTick((t) => t + 1);
    return ok;
  }, []);

  const runNativeInstall = useCallback(() => promptNativeInstall(), []);

  return {
    capability,
    pushState,
    /** granted, но PushSubscription отсутствует — «включено» показывать нельзя. */
    subscriptionMissing,
    isMobile: mobile,
    isInstalled: installed,
    nextAction,
    runPush,
    runNativeInstall,
  };
}
