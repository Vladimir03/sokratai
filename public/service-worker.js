const CACHE_NAME = 'math-tutor-cache-v3';

// Only cache files that definitely exist and are stable
const STATIC_ASSETS = [
  '/',
  '/index.html',
];

// Install event - cache static assets with graceful fallback
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('Service Worker: Caching static assets');
      // Cache each asset individually so one failure doesn't break the whole install
      for (const asset of STATIC_ASSETS) {
        try {
          await cache.add(asset);
        } catch (error) {
          console.warn(`Service Worker: Failed to cache ${asset}`, error);
        }
      }
    })
  );
  // Force this SW to become active immediately
  self.skipWaiting();
});

// Activate event - clean up ALL old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Clearing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('Service Worker: Now active, controlling all clients');
    })
  );
  // Take control of all pages immediately
  self.clients.claim();
});

// Check if asset should be cached long-term (has hash in filename)
function isHashedAsset(url) {
  return /\.(js|css)$/.test(url) && /[a-f0-9]{8,}/.test(url);
}

// Check if request is for a document/HTML page
function isDocumentRequest(request) {
  return request.destination === 'document' || 
         request.mode === 'navigate' ||
         request.headers.get('accept')?.includes('text/html');
}

// Fetch event - smart caching strategies
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Phase B (2026-05-03): Host-based bypass for API/data hosts — SECURITY-CRITICAL.
  // API responses contain per-user data (auth tokens, homework, signed URLs) and
  // MUST NEVER be cached by SW — otherwise one user's data may leak to another
  // via shared Cache Storage. Host-based check covers ALL paths under each host
  // (/auth, /rest, /storage, /functions, /realtime) in one shot.
  // - api.sokratai.ru = Selectel VPS reverse proxy → Supabase (added in Phase B).
  //   Path-based fallback below would miss /storage/* (signed URLs, Patch B+1)
  //   and /realtime/*.
  // - *.supabase.co = direct Supabase host (defensive; RU prod routes through api.sokratai.ru).
  // - mc.yandex.ru = analytics tracking pixels.
  // See docs/delivery/features/service-worker-prod/spec.md §5 + §7 AC-5/AC-6.
  const reqUrl = event.request.url;
  if (reqUrl.includes('://api.sokratai.ru/') ||
      reqUrl.includes('.supabase.co') ||
      reqUrl.includes('mc.yandex.ru')) {
    return;
  }

  // Defense-in-depth: same-origin API mounts (legacy path-based heuristics).
  if (event.request.url.includes('/functions/') ||
      event.request.url.includes('supabase.co') ||
      event.request.url.includes('/rest/') ||
      event.request.url.includes('/auth/')) {
    return;
  }

  // DOCUMENT REQUESTS (HTML pages): Network-first, fallback to cached index.html
  // IMPORTANT: Do NOT cache HTML responses to avoid stale content after deployments
  if (isDocumentRequest(event.request)) {
    event.respondWith(
      fetch(event.request)
        .then((fetchResponse) => {
          // Return fresh response, don't cache it
          return fetchResponse;
        })
        .catch(() => {
          // Offline fallback: return cached index.html
          console.log('Service Worker: Network failed for document, using cached index.html');
          return caches.match('/index.html');
        })
    );
    return;
  }

  // HASHED ASSETS (JS/CSS with hash): Cache-first (immutable)
  if (isHashedAsset(event.request.url)) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        
        return fetch(event.request).then((fetchResponse) => {
          // Only cache successful responses
          if (fetchResponse.status === 200) {
            const responseToCache = fetchResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return fetchResponse;
        }).catch((error) => {
          console.error('Service Worker: Failed to fetch hashed asset:', event.request.url, error);
          // Don't return stale cache for assets - let it fail so ErrorBoundary catches it
          throw error;
        });
      })
    );
    return;
  }

  // Network-first strategy for other requests
  event.respondWith(
    fetch(event.request)
      .then((fetchResponse) => {
        // Cache successful responses for offline use
        if (fetchResponse.status === 200) {
          const responseToCache = fetchResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return fetchResponse;
      })
      .catch(() => {
        // Fallback to cache
        return caches.match(event.request);
      })
  );
});

// Listen for messages from the main thread
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// --- Push Notification Handlers (Phase 1.1) ---

self.addEventListener('push', (event) => {
  var data = { title: 'Сократ', body: 'Новое уведомление', url: '/' };
  try {
    if (event.data) {
      var parsed = event.data.json();
      data = {
        title: parsed.title || data.title,
        body: parsed.body || data.body,
        url: parsed.url || data.url,
        icon: parsed.icon,
        badge: parsed.badge,
      };
    }
  } catch (e) {
    console.warn('Service Worker: Failed to parse push payload', e);
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/favicon.ico',
      badge: data.badge || '/favicon.ico',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  var rawUrl = (event.notification.data && event.notification.data.url) || '/';

  // Same-origin validation: only allow relative paths or same-origin URLs
  var targetUrl = '/';
  if (rawUrl.startsWith('/')) {
    targetUrl = rawUrl;
  } else {
    try {
      var parsed = new URL(rawUrl);
      if (parsed.origin === self.location.origin) {
        targetUrl = parsed.pathname + parsed.search + parsed.hash;
      }
    } catch (e) {
      // Invalid URL — fall back to root
    }
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windowClients) {
      // Only reuse a tab that is already on the same URL path (no data loss)
      var fullTargetUrl = self.location.origin + targetUrl;
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i];
        if (client.url === fullTargetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  // Browser revoked or expired the subscription — re-subscribe with same VAPID key,
  // then notify a client window to persist via authenticated API call.
  // SW has no JWT, so it cannot call push-subscribe directly.
  event.waitUntil(
    self.registration.pushManager.subscribe(event.oldSubscription.options)
      .then(function (newSub) {
        // Ask an open client window to persist the new subscription
        return clients.matchAll({ type: 'window' }).then(function (windowClients) {
          var subJson = newSub.toJSON();
          var message = {
            type: 'PUSH_SUBSCRIPTION_CHANGED',
            subscription: {
              endpoint: subJson.endpoint,
              keys: { p256dh: subJson.keys.p256dh, auth: subJson.keys.auth },
              expirationTime: newSub.expirationTime || null,
            },
          };
          for (var i = 0; i < windowClients.length; i++) {
            windowClients[i].postMessage(message);
          }
          // If no client windows are open, the stale subscription will be caught
          // as a 410 Gone during the next push send (Phase 1.3 cascade cleanup).
        });
      })
      .catch(function (err) {
        console.error('Service Worker: pushsubscriptionchange re-subscribe failed', err);
      })
  );
});
