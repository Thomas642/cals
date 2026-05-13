// ── Service Worker — Family Tracker ─────────────────────────────────────────
// Versioned cache (bump on each frontend release that touches assets).
const VERSION    = 'v26';
const CACHE_NAME = `family-tracker-${VERSION}`;

// Static shell assets pre-cached at install time. Versioned URL query strings
// (?v=...) are NOT included here — they're cached on-demand via SWR.
// Only stable URLs go here so the precache doesn't repeatedly bust itself.
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/login.html',
  '/manifest.json',
  '/css/app.css',
  '/icons/icon.svg',
  '/icons/icon-72.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/favicon.ico',
  '/vendor/leaflet.css',
  '/vendor/leaflet.js',
  '/vendor/leaflet-heat.js',
  '/vendor/leaflet-rotate.js',
];

// ── Install: precache the shell ──────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {}))
  );
  self.skipWaiting();
});

// ── Activate: clean old caches, become controller for open tabs ──────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch strategies ─────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1) Never intercept API / WebSocket / push / external origins
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;

  // 2) Versioned static assets (JS/CSS with ?v= query) — stale-while-revalidate
  //    Cache key includes the version, so old versions evict naturally.
  if (/\.(js|css)$/.test(url.pathname) && url.search) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // 3) HTML navigation — network-first so we always get the latest shell
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(networkFirst(req));
    return;
  }

  // 4) Static images/fonts/manifest — cache-first
  event.respondWith(cacheFirst(req));
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    return Response.error();
  }
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    return cached || caches.match('/');
  }
}

async function staleWhileRevalidate(req) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => cached);
  return cached || fetchPromise;
}

// ── Push notifications ───────────────────────────────────────────────────────
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

// ── Notification click ───────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      if (list.length) return list[0].focus();
      return clients.openWindow('/');
    })
  );
});

// ── Background sync ──────────────────────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-positions') {
    event.waitUntil(
      self.clients.matchAll().then((cs) => cs.forEach((c) => c.postMessage({ type: 'sync-positions' })))
    );
  }
});
