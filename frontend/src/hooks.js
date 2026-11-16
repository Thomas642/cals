import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

/** Charge une ressource GET (cache immediat puis rafraichissement) et se recharge apres toute ecriture. */
export function useApi(path, { refreshMs = 0 } = {}) {
  const [data, setData] = useState(() => (path ? api.cached(path) : undefined));
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    if (!path) return;
    api.get(path).then((d) => { setData(d); setError(null); }).catch((e) => setError(e));
  }, [path]);

  useEffect(() => {
    setData(path ? api.cached(path) : undefined);
    load();
    return api.subscribe(load);
  }, [path, load]);

  // Rafraichissement periodique (ex. pendant la conversion d'une video).
  useEffect(() => {
    if (!refreshMs || !path) return undefined;
    const t = setInterval(() => api.refresh(path).then(setData).catch(() => {}), refreshMs);
    return () => clearInterval(t);
  }, [path, refreshMs]);

  return { data, error, reload: load };
}
