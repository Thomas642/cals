// Progression de lecture, enregistree sur le serveur pour le compte connecte (suit la personne
// d'un appareil a l'autre). Cache memoire pour l'affichage immediat.
import { useSyncExternalStore } from 'react';
import { api } from './api.js';
import { episodeLabel } from './files.js';

const SEND_EVERY_MS = 10000;
const listeners = new Set();
let cache = {};          // episodeId -> { pos, dur, watched, at, seriesId, seriesTitle, label, thumb }
const lastSent = new Map();
const pendingDelta = new Map(); // secondes regardees pas encore envoyees, par episode

function emit() {
  cache = { ...cache };
  listeners.forEach((fn) => fn());
}

/** Charge la progression du compte (au demarrage et apres connexion). */
export async function loadProgress() {
  try {
    const rows = await api.refresh('/progress');
    cache = {};
    for (const r of rows) {
      cache[r.episode_id] = {
        pos: r.pos, dur: r.dur, watched: r.watched, at: Date.parse(`${r.updated_at.replace(' ', 'T')}Z`) || 0,
        seriesId: r.series_id, seriesTitle: r.series_title, label: episodeLabel({ number: r.number }), thumb: r.thumb_url,
      };
    }
    emit();
  } catch { /* progression facultative */ }
}

export function clearProgress() {
  cache = {};
  lastSent.clear();
  emit();
}

const isWatched = (pos, dur) => dur > 0 && (pos / dur > 0.95 || (dur > 600 && dur - pos < 90));

function send(episodeId, body) {
  lastSent.set(episodeId, Date.now());
  const delta = Math.round((pendingDelta.get(episodeId) || 0) * 10) / 10;
  pendingDelta.delete(episodeId);
  api.send('PUT', `/progress/${episodeId}`, { ...body, delta }).catch(() => {});
}

/** Enregistre la position. info : { seriesId, seriesTitle, label, thumb }. force : envoi immediat (pause, sortie). */
export function recordProgress(episodeId, pos, dur, info, { force = false, delta = 0 } = {}) {
  if (delta > 0) pendingDelta.set(episodeId, (pendingDelta.get(episodeId) || 0) + delta);
  const watched = isWatched(pos, dur);
  const prev = cache[episodeId] || {};
  cache[episodeId] = { ...prev, ...info, pos: watched ? 0 : Math.floor(pos), dur: Math.floor(dur || prev.dur || 0), watched: watched || !!prev.watched, at: Date.now() };
  emit();
  if (force || watched || Date.now() - (lastSent.get(episodeId) || 0) > SEND_EVERY_MS) send(episodeId, { pos, dur });
}

/** Fin de lecture (manual = false) ou « marquer comme vu » a la main (manual = true). */
export function markWatched(episodeId, dur, info, { manual = false } = {}) {
  cache[episodeId] = { ...(cache[episodeId] || {}), ...info, pos: 0, dur: Math.floor(dur || cache[episodeId]?.dur || 0), watched: true, at: Date.now() };
  emit();
  send(episodeId, { pos: dur || 0, dur: dur || 0, watched: true, manual });
}

/** « Marquer comme non vu » : efface la progression de l'episode pour ce compte. */
export function markUnwatched(episodeId) {
  delete cache[episodeId];
  emit();
  api.send('DELETE', `/progress/${episodeId}`).catch(() => {});
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
