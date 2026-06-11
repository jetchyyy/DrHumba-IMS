const CACHE_NAME = 'dr-humba-cache-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/drhumbalogo.jpg',
  '/drhumbalogo-192.png',
  '/drhumbalogo-512.png',
  '/favicon.svg',
  '/manifest.json'
];

// Install Event - Pre-cache the main app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching core app shell');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event - Clean up any old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Clearing old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Serve cached content or fetch fresh data
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  // CRITICAL: Exclude database (Supabase), auth APIs, and browser extension schemes
  if (
    url.hostname.includes('supabase.co') || 
    url.pathname.includes('/rest/v1/') || 
    url.pathname.includes('/auth/v1/') ||
    !url.protocol.startsWith('http')
  ) {
    // Let these fetch requests pass straight to the network without interception
    return;
  }

  // Network First strategy: attempt network request, cache result on success, fall back to cache on failure
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Only cache valid standard status 200 GET responses
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // Fallback to cache if network is unavailable (offline mode)
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          
          // If the resource is not in cache and it's a page navigation, return index.html (SPA fallback)
          if (event.request.mode === 'navigate') {
            return caches.match('/');
          }
        });
      })
  );
});
