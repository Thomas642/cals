// Client HTTP de l'API, avec cache memoire des GET (affichage immediat au retour
// sur une page, puis rafraichissement en arriere-plan).
export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.code = data?.code;
    this.data = data;
  }
}

const cache = new Map();          // path -> donnees
const inflight = new Map();       // path -> promesse en cours
const listeners = new Set();      // abonnes aux invalidations

export function onUnauthorized(handler) {
  window.addEventListener('app:unauthorized', handler);
  return () => window.removeEventListener('app:unauthorized', handler);
}

export function errorFromResponse(status, data) {
  if (status === 401 && data?.code === 'auth_required') window.dispatchEvent(new Event('app:unauthorized'));
  const fallback = status === 413
    ? 'Fichier trop volumineux pour le serveur (limite du proxy)'
    : `Erreur serveur (HTTP ${status})`;
  return new ApiError(data?.error || fallback, status, data);
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
  if (!res.ok) throw errorFromResponse(res.status, data);
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

function invalidate() {
  cache.clear();
  listeners.forEach((fn) => fn());
}

/** Toute ecriture invalide le cache : les pages abonnees se rechargent. */
function mutate(method, path, body) {
  return request(method, path, body).then((data) => { invalidate(); return data; });
}

export const api = {
  get: fetchCached,
  cached: (path) => cache.get(path),
  post: (p, b) => mutate('POST', p, b ?? {}),
  put: (p, b) => mutate('PUT', p, b),
  del: (p) => mutate('DELETE', p),
  subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  invalidate,
  clear: () => cache.clear(),
};
