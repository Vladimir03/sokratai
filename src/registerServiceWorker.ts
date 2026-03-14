/** Strict allow-list: SW runs ONLY on the published production domain. */
const PROD_HOSTNAME = 'sokratai.lovable.app';

function isProductionHost(): boolean {
  return window.location.hostname === PROD_HOSTNAME;
}

/**
 * Force-clean any previously registered SWs and caches.
 * Called on every non-prod load to prevent stale UI in preview/dev.
 */
async function forceCleanup() {
  if (!('serviceWorker' in navigator)) return;

  const registrations = await navigator.serviceWorker.getRegistrations();
  for (const registration of registrations) {
    await registration.unregister();
    console.log('Service Worker: Force-unregistered (non-prod)', registration.scope);
  }

  if ('caches' in window) {
    const cacheNames = await caches.keys();
    for (const cacheName of cacheNames) {
      await caches.delete(cacheName);
      console.log('Cache deleted (non-prod):', cacheName);
    }
  }
}

export const registerServiceWorker = () => {
  if (!('serviceWorker' in navigator)) return;

  // Non-prod: force unregister + clear caches, never register
  if (!isProductionHost()) {
    console.log('Service Worker: Non-prod host, cleaning up stale SWs...');
    forceCleanup();
    return;
  }

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js');
      console.log('Service Worker: Registered successfully', registration.scope);

      // Check for updates periodically (every 5 minutes)
      setInterval(() => {
        registration.update();
      }, 5 * 60 * 1000);

      // Handle updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        console.log('Service Worker: Update found, installing...');

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('Service Worker: New version available');
            newWorker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });

      // When the new SW takes over, reload the page to get fresh content
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        console.log('Service Worker: Controller changed, reloading...');
        window.location.reload();
      });

    } catch (error) {
      console.error('Service Worker: Registration failed', error);
    }
  });
};

// Utility to force unregister all service workers (for debugging)
export const unregisterAllServiceWorkers = async () => {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      await registration.unregister();
      console.log('Service Worker: Unregistered', registration.scope);
    }
    const cacheNames = await caches.keys();
    for (const cacheName of cacheNames) {
      await caches.delete(cacheName);
      console.log('Cache deleted:', cacheName);
    }
  }
};
