import { supabase } from '@/lib/supabaseClient';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
const PROD_HOSTNAME = 'sokratai.lovable.app';

function isProductionHost(): boolean {
  return window.location.hostname === PROD_HOSTNAME;
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
 * Returns false on non-prod hosts (SW is not registered outside sokratai.lovable.app).
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
 * Request notification permission, subscribe to push, and save to backend.
 * Returns true if subscription was successful, false if permission denied or error.
 */
export async function subscribeToPush(): Promise<boolean> {
  if (!isPushSupported() || !VAPID_PUBLIC_KEY) {
    console.warn('Push not supported or VAPID key missing');
    return false;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return false;
    }

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    const subJson = subscription.toJSON();
    if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
      console.error('Push subscription missing required fields');
      return false;
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
      return false;
    }

    return true;
  } catch (err) {
    console.error('subscribeToPush error:', err);
    return false;
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
