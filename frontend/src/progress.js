// Progression de lecture memorisee dans ce navigateur : reprise, episodes vus, « Continuer a regarder ».
import { useSyncExternalStore } from 'react';

const KEY = 'anime:progress';
const listeners = new Set();
let cache = load();

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* stockage indisponible */ }
  cache = { ...cache };
  listeners.forEach((fn) => fn());
}

/** Enregistre la position. info : { seriesId, seriesTitle, label, thumb, cover }. */
export function recordProgress(episodeId, pos, dur, info) {
  // Vu : plus de 95 % regardes, ou moins de 90 s restantes sur un episode de plus de 10 min (generique de fin).
  const watched = dur > 0 && (pos / dur > 0.95 || (dur > 600 && dur - pos < 90));
  const prev = cache[episodeId] || {};
  cache[episodeId] = { ...prev, ...info, pos: watched ? 0 : Math.floor(pos), dur: Math.floor(dur || prev.dur || 0), watched: watched || !!prev.watched, at: Date.now() };
  save();
}

export function markWatched(episodeId, info) {
  cache[episodeId] = { ...(cache[episodeId] || {}), ...info, pos: 0, watched: true, at: Date.now() };
  save();
}

export const progressOf = (episodeId) => cache[episodeId] || null;

/** Dernier episode regarde par serie, le plus recent d'abord. */
export function recentBySeries() {
  const best = new Map();
  for (const [id, p] of Object.entries(cache)) {
    if (!p.seriesId) continue;
    const cur = best.get(p.seriesId);
    if (!cur || p.at > cur.at) best.set(p.seriesId, { ...p, episodeId: Number(id) });
  }
  return [...best.values()].sort((a, b) => b.at - a.at);
}

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const useProgress = () => useSyncExternalStore(subscribe, () => cache);

/** Episode a lancer pour une serie : celui en cours, sinon le suivant du dernier vu, sinon le premier. */
export function nextToWatch(episodes) {
  const ready = episodes.filter((e) => e.status === 'ready');
  if (!ready.length) return null;
  let last = null;
  for (const e of ready) {
    const p = cache[e.id];
    if (p && (!last || p.at > last.p.at)) last = { e, p };
  }
  if (!last) return { episode: ready[0], resume: false };
  if (!last.p.watched) return { episode: last.e, resume: last.p.pos > 5 };
  const i = ready.indexOf(last.e);
  return i < ready.length - 1 ? { episode: ready[i + 1], resume: false } : { episode: ready[0], resume: false, restart: true };
}
