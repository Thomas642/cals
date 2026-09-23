// Client HTTP de l'API Cals, avec cache memoire des GET (affichage immediat au retour
// sur une page, puis rafraichissement en arriere-plan).
export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const cache = new Map();          // path -> donnees
const inflight = new Map();       // path -> promesse en cours
const listeners = new Set();      // abonnes aux invalidations

export function onUnauthorized(handler) {
  window.addEventListener('cals:unauthorized', handler);
  return () => window.removeEventListener('cals:unauthorized', handler);
}

async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && data?.code === 'auth_required') window.dispatchEvent(new Event('cals:unauthorized'));
    let message = data?.error;
    if (!message && res.status === 429) {
      // 429 sans message JSON : limite appliquee avant Cals (proxy ou Cloudflare).
      const wait = Number(res.headers.get('retry-after'));
      message = `Trop de requêtes : accès limité temporairement par le proxy (HTTP 429)${wait > 0 ? `, réessayer dans ${wait} s` : ''}`;
    }
    throw new ApiError(message || `Erreur serveur (HTTP ${res.status})`, res.status, data?.code);
  }
  return data;
}

function fetchCached(path) {
  if (inflight.has(path)) return inflight.get(path);
  const p = request('GET', path)
    .then((data) => { cache.set(path, data); return data; })
    .finally(() => inflight.delete(path));
  inflight.set(path, p);
  return p;
}

/** Toute ecriture invalide le cache : les pages abonnees se rechargent. */
function mutate(method, path, body) {
  return request(method, path, body).then((data) => {
    cache.clear();
    listeners.forEach((fn) => fn());
    return data;
  });
}

export const api = {
  get: fetchCached,
  cached: (path) => cache.get(path),
  post: (p, b) => mutate('POST', p, b ?? {}),
  put: (p, b) => mutate('PUT', p, b),
  del: (p) => mutate('DELETE', p),
  subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  clear: () => cache.clear(),
  prefetch: (paths) => paths.forEach((p) => { if (!cache.has(p)) fetchCached(p).catch(() => {}); }),
};
