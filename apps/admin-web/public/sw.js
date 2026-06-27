// Minimal service worker: enables PWA install + offline app shell.
// Network-first for navigation so the admin always gets fresh data when online.
const CACHE = 'pisonet-admin-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Never cache API calls.
  const url = new URL(request.url);
  if (
    url.pathname.startsWith('/auth') ||
    url.pathname.startsWith('/users') ||
    url.pathname.startsWith('/computers') ||
    url.pathname.startsWith('/sessions') ||
    url.pathname.startsWith('/transactions') ||
    url.pathname.startsWith('/stats') ||
    url.pathname.startsWith('/audit')
  ) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request))
  );
});
