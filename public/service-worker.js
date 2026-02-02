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

  // Skip API requests (let them fail naturally with proper error handling)
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
