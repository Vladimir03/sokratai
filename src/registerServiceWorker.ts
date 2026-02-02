export const registerServiceWorker = () => {
  // Only register SW in production to avoid caching issues in development
  if (!('serviceWorker' in navigator)) {
    return;
  }

  // Check if we're in production (not localhost or preview)
  const isProduction = 
    window.location.hostname !== 'localhost' && 
    !window.location.hostname.includes('preview') &&
    !window.location.hostname.includes('lovable.app');

  if (!isProduction) {
    console.log('Service Worker: Skipping registration (not production)');
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
            // New SW installed but waiting - prompt user to refresh
            console.log('Service Worker: New version available');
            
            // Automatically activate new SW and reload
            // This ensures users always get the latest version
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
    // Clear all caches
    const cacheNames = await caches.keys();
    for (const cacheName of cacheNames) {
      await caches.delete(cacheName);
      console.log('Cache deleted:', cacheName);
    }
  }
};
