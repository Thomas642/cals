// ── Service Worker — Family Tracker ─────────────────────────────────────────
const CACHE_NAME = 'family-tracker-v3';

const STATIC_ASSETS = [
  '/',
  '/login.html',
  '/manifest.json',
  '/css/app.css',
  '/js/api.js',
  '/js/auth.js',
  '/js/map.js',
  '/js/geolocation.js',
  '/js/notifications.js',
  '/js/app.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

// ── Install: cache static assets ─────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(STATIC_ASSETS.filter((u) => !u.startsWith('http')))
    )
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: network-first for API, cache-first for static ─────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API, socket.io, or JS files (always fetch fresh)
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io/') ||
    url.pathname.startsWith('/js/')
  ) {
    return event.respondWith(fetch(event.request).catch(() => new Response('', { status: 503 })));
  }

  // Cache-first for static
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback for navigation
        if (event.request.mode === 'navigate') {
          return caches.match('/');
        }
      });
    })
  );
});

// ── Push notifications ────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch {}

  const title   = data.title || 'Family Tracker';
  const options = {
    body:    data.body || '',
    icon:    data.icon || '/icons/icon-192.png',
    badge:   '/icons/icon-72.png',
    vibrate: data.data?.type === 'sos' ? [200, 100, 200, 100, 400] : [200],
    data:    data.data || {},
    actions: data.data?.type === 'sos'
      ? [{ action: 'map', title: 'Voir sur la carte' }]
      : [],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click ────────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      if (list.length) {
        return list[0].focus();
      }
      return clients.openWindow('/');
    })
  );
});

// ── Background sync (position sending when back online) ──────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-positions') {
    event.waitUntil(syncPendingPositions());
  }
});

async function syncPendingPositions() {
  // Positions are sent directly by the main thread; this is a placeholder
  // for when the app comes back online after being offline.
  const clients_ = await clients.matchAll();
  clients_.forEach((c) => c.postMessage({ type: 'sync-positions' }));
}
