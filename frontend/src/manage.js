// Mode « Gérer » : affiche les outils d'import et d'edition. Memorise dans ce navigateur.
import { useSyncExternalStore } from 'react';

const KEY = 'anime:manage';
const listeners = new Set();
let on = (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })();

export function setManage(value) {
  on = !!value;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignore */ }
  listeners.forEach((fn) => fn());
}
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const useManage = () => useSyncExternalStore(subscribe, () => on);
