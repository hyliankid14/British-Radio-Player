const CACHE_NAME = 'british-radio-player-pwa-v5';
const APP_SHELL = [
  './',
  './index.html',
  './privacy.html',
  './offline.html',
  './manifest.webmanifest',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);
  const isAppPage = requestUrl.pathname.endsWith('/index.html')
    || requestUrl.pathname.endsWith('/privacy.html')
    || requestUrl.pathname.endsWith('/offline.html')
    || requestUrl.pathname.endsWith('/manifest.webmanifest')
    || requestUrl.pathname.endsWith('/sw.js')
    || requestUrl.pathname.includes('/assets/icons/');

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          const cachedIndex = await cache.match('./index.html');
          return cachedIndex || cache.match('./offline.html');
        })
    );
    return;
  }

  if (isAppPage) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) {
          return cached;
        }

        return fetch(event.request).then(networkResponse => {
          const responseCopy = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseCopy));
          return networkResponse;
        });
      })
    );
    return;
  }

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
