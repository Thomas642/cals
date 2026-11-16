import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, onUnauthorized } from './api.js';
import Icon from './components/Icon.jsx';
import UploadTray from './components/UploadTray.jsx';
import Login from './pages/Login.jsx';
import Library from './pages/Library.jsx';
import Series from './pages/Series.jsx';
import Watch from './pages/Watch.jsx';

export default function App() {
  const [auth, setAuth] = useState(undefined);
  const [error, setError] = useState(null);

  const boot = useCallback(async () => {
    try {
      setError(null);
      setAuth(await api.get('/auth/status'));
    } catch (e) {
      // 429 (limite de requetes d'un proxy) ou serveur indisponible : nouvel essai automatique.
      const wait = e.status === 429 ? Math.min(600, e.retryAfter ?? 30) : 10;
      setError({ message: e.message, rateLimited: e.status === 429, retryAt: Date.now() + wait * 1000 });
    }
  }, []);

  useEffect(() => { boot(); }, [boot]);
  useEffect(() => {
    if (!error) return undefined;
    const t = setTimeout(boot, Math.max(0, error.retryAt - Date.now()));
    return () => clearTimeout(t);
  }, [error, boot]);
  useEffect(() => onUnauthorized(() => { api.clear(); setAuth((a) => ({ ...a, authenticated: false })); }), []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    api.clear();
    setAuth((a) => ({ ...a, authenticated: false }));
  }, []);

  if (error) return <BootError error={error} onRetry={boot} />;
  if (auth === undefined) return <div className="center-screen"><span className="spinner big" aria-label="Chargement" /></div>;
  if (!auth.authenticated) {
    return <Login configured={auth.configured} onLoggedIn={() => { api.clear(); setAuth(undefined); boot(); }} />;
  }
  return <Shell onLogout={logout} username={auth.username} />;
}

function BootError({ error, onRetry }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const seconds = Math.max(0, Math.ceil((error.retryAt - now) / 1000));
  return (
    <div className="center-screen">
      <div className="card boot-error">
        <p className="alert">{error.rateLimited ? error.message : `Serveur injoignable : ${error.message}`}</p>
        {error.rateLimited && <p className="muted small">Cela arrive après beaucoup de requêtes rapprochées (par exemple l'envoi d'une grosse vidéo). Le site réessaie tout seul.</p>}
        <p className="muted small">Nouvel essai dans {seconds} s.</p>
        <button onClick={onRetry}>Réessayer maintenant</button>
      </div>
    </div>
  );
}

function Shell({ onLogout, username }) {
  const location = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);

  return (
    <div className="layout">
      <header className="topbar">
        <Link to="/" className="brand"><span className="logo" aria-hidden="true"><Icon name="play" size={14} /></span>Animés</Link>
        <button className="link muted" onClick={onLogout} title={username ? `Connecté : ${username}` : undefined}>
          <Icon name="logout" size={18} /> <span className="hide-sm">Déconnexion</span>
        </button>
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/serie/:id" element={<Series />} />
          <Route path="/regarder/:id" element={<Watch />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <UploadTray />
    </div>
  );
}
