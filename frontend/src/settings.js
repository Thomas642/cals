// Reglages du lecteur du compte connecte (sous-titres, episode suivant automatique), enregistres sur le serveur.
import { useSyncExternalStore } from 'react';
import { api } from './api.js';

const DEFAULTS = { autoplay: true, seasonal: true, subtitles: { size: 'm', bg: 0.6, position: 'bottom' } };
let current = DEFAULTS;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export function initSettings(s) {
  current = { ...DEFAULTS, ...(s || {}), subtitles: { ...DEFAULTS.subtitles, ...(s?.subtitles || {}) } };
  emit();
}

/** Applique tout de suite, puis enregistre sur le serveur. */
export function updateSettings(patch) {
  current = { ...current, ...patch, subtitles: { ...current.subtitles, ...(patch.subtitles || {}) } };
  emit();
  api.send('PUT', '/me/settings', patch).catch(() => {});
}

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const useSettings = () => useSyncExternalStore(subscribe, () => current);
