import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

/**
 * Donnees d'une route GET : renvoie tout de suite la version en cache (si presente),
 * puis la version a jour. Se recharge apres toute ecriture (api.post/put/del).
 */
export function useApi(path) {
  const [data, setData] = useState(() => (path ? api.cached(path) : undefined));
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    if (!path) return Promise.resolve();
    return api.get(path).then((d) => { setData(d); setError(null); }).catch((e) => setError(e));
  }, [path]);

  useEffect(() => {
    setData(path ? api.cached(path) : undefined);
    load();
    return api.subscribe(load);
  }, [path, load]);

  return { data, error, loading: data === undefined && !error, reload: load };
}
