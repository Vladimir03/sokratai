import { supabase } from '@/lib/supabaseClient';
import { isProductionHost } from '@/registerServiceWorker';

// HARDCODED fallback (2026-07-13): VITE_VAPID_PUBLIC_KEY не задан ни в Lovable-env,
// ни на VPS (в бандле компилировался в undefined → subscribeToPush всегда false,
// кнопка «Включить уведомления» выглядела мёртвой). VAPID public key НЕ секрет —
// он по спецификации отдаётся каждому браузеру (mirror паттерна supabaseClient.ts
// с anon-ключом). ДОЛЖЕН совпадать с edge-секретом VAPID_PUBLIC_KEY (пара с
// VAPID_PRIVATE_KEY) — иначе push-сервисы отвергнут отправку (VAPID mismatch).
const VAPID_PUBLIC_KEY =
  (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ||
  'BPlP4vc8XYPsqFhfQUBgpvjYyRNvTJtpQbHq91MJI8DHFXO0QSNzkJgEZPip_2bjqlcYLs6SuCowwLn7W92EbQk';

/** Есть ли VAPID public key в сборке (без него подписка невозможна). */
export function hasVapidKey(): boolean {
  return Boolean(VAPID_PUBLIC_KEY);
}

/** Convert URL-safe base64 string to Uint8Array (for applicationServerKey). */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Check if Web Push is available.
 * Returns false on non-prod hosts (SW registers only on PROD_HOSTS — see registerServiceWorker.ts).
 */
export function isPushSupported(): boolean {
  return (
    isProductionHost() &&
    'PushManager' in window &&
    'serviceWorker' in navigator &&
    'Notification' in window
  );
}

/** Get current notification permission state, or null if unsupported. */
export function getPushPermissionState(): NotificationPermission | null {
  if (!('Notification' in window)) return null;
  return Notification.permission;
}

/**
 * Типизированный исход подписки — тосты различают причины (баг превью
 * 2026-07-13: generic «не удалось» не даёт понять, сеть это, браузер или бэк).
 *  - permission     — пользователь не разрешил (или browser auto-deny);
 *  - push-service   — браузер не достучался до пуш-сервиса (Chrome = Google FCM,
 *                     в РФ бывает заблокирован DPI без VPN; AbortError);
 *  - save-failed    — подписка создана, но бэкенд не сохранил (edge недоступна);
 *  - unsupported    — нет ключа/API/prod-хоста.
 */
export type PushSubscribeReason = 'permission' | 'push-service' | 'save-failed' | 'unsupported';
export interface PushSubscribeResult {
  ok: boolean;
  reason?: PushSubscribeReason;
}

/**
 * Request notification permission, subscribe to push, and save to backend.
 */
export async function subscribeToPush(): Promise<PushSubscribeResult> {
  if (!isPushSupported() || !VAPID_PUBLIC_KEY) {
    console.warn('Push not supported or VAPID key missing');
    return { ok: false, reason: 'unsupported' };
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { ok: false, reason: 'permission' };
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription: PushSubscription;
    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
    } catch (err) {
      // InvalidStateError = существующая подписка с ДРУГИМ applicationServerKey
      // (после ротации VAPID-пары) — отписываем и пробуем один раз заново.
      if (err instanceof DOMException && err.name === 'InvalidStateError') {
        try {
          const existing = await registration.pushManager.getSubscription();
          await existing?.unsubscribe();
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
          });
        } catch (retryErr) {
          console.error('subscribeToPush resubscribe error:', retryErr);
          return { ok: false, reason: 'push-service' };
        }
      } else {
        // AbortError «push service error» — FCM недоступен (типично для РФ без VPN)
        console.error('subscribeToPush subscribe error:', err);
        return { ok: false, reason: 'push-service' };
      }
    }

    const subJson = subscription.toJSON();
    if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
      console.error('Push subscription missing required fields');
      return { ok: false, reason: 'push-service' };
    }

    // Pass expirationTime if the browser provides it
    const expiresAt = subscription.expirationTime
      ? new Date(subscription.expirationTime).toISOString()
      : undefined;

    const { error } = await supabase.functions.invoke('push-subscribe', {
      method: 'POST',
      body: {
        endpoint: subJson.endpoint,
        keys: {
          p256dh: subJson.keys.p256dh,
          auth: subJson.keys.auth,
        },
        user_agent: navigator.userAgent,
        ...(expiresAt && { expires_at: expiresAt }),
      },
    });

    if (error) {
      console.error('Failed to save push subscription:', error);
      return { ok: false, reason: 'save-failed' };
    }

    return { ok: true };
  } catch (err) {
    console.error('subscribeToPush error:', err);
    return { ok: false, reason: 'push-service' };
  }
}

/**
 * Persist a renewed push subscription sent from the service worker
 * via postMessage after a pushsubscriptionchange event.
 */
async function handleSubscriptionChanged(data: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime: number | null;
}): Promise<void> {
  const expiresAt = data.expirationTime
    ? new Date(data.expirationTime).toISOString()
    : undefined;

  const { error } = await supabase.functions.invoke('push-subscribe', {
    method: 'POST',
    body: {
      endpoint: data.endpoint,
      keys: data.keys,
      user_agent: navigator.userAgent,
      ...(expiresAt && { expires_at: expiresAt }),
    },
  });

  if (error) {
    console.error('Failed to persist renewed push subscription:', error);
  }
}

/**
 * Listen for PUSH_SUBSCRIPTION_CHANGED messages from the service worker.
 * Call once at app startup (e.g. in main.tsx or after SW registration).
 */
export function listenForSubscriptionChanges(): void {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'PUSH_SUBSCRIPTION_CHANGED' && event.data.subscription) {
      handleSubscriptionChanged(event.data.subscription).catch((err) => {
        console.error('pushsubscriptionchange handler error:', err);
      });
    }
  });
}

/**
 * Unsubscribe from push notifications and remove from backend.
 */
export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushSupported()) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();

      await supabase.functions.invoke('push-subscribe', {
        method: 'DELETE',
        body: { endpoint },
      });
    }
  } catch (err) {
    console.error('unsubscribeFromPush error:', err);
  }
}
