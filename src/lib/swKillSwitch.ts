/**
 * Kill-switch для Service Worker.
 *
 * Использование: пользователь добавляет `?sw=off` в URL → SW unregistered, caches очищены,
 * reload без query param. Полезно для:
 *   - дебага у пользователей ("у меня застрял старый кеш")
 *   - emergency recovery после deploy с broken SW
 *   - локальной разработки
 *
 * См. docs/delivery/features/service-worker-prod/spec.md §3.4
 */
export async function checkSwKillSwitch(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  if (params.get('sw') !== 'off') {
    return false;
  }

  console.warn('[SW Kill-switch] activated via ?sw=off — unregistering and clearing caches...');

  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        regs.map((r) =>
          r.unregister().catch((err) => {
            console.error('[SW Kill-switch] failed to unregister', r, err);
          }),
        ),
      );
    }
  } catch (err) {
    console.error('[SW Kill-switch] error during SW unregister', err);
  }

  try {
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((name) =>
          caches.delete(name).catch((err) => {
            console.error('[SW Kill-switch] failed to delete cache', name, err);
          }),
        ),
      );
    }
  } catch (err) {
    console.error('[SW Kill-switch] error during caches clear', err);
  }

  try {
    sessionStorage.setItem('sw-disabled', '1');
  } catch {
    // Private mode / quota — не критично, breadcrumb для диагностики опционален.
  }

  // Reload без ?sw=off — sticky behavior был бы вреден (kill-switch должен быть one-shot).
  const url = new URL(window.location.href);
  url.searchParams.delete('sw');
  console.warn('[SW Kill-switch] reloading without sw=off param');
  window.location.replace(url.toString());

  return true;
}
