import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, onUnauthorized } from './api.js';
import Icon from './components/Icon.jsx';
import UploadTray from './components/UploadTray.jsx';
import { setManage, useManage } from './manage.js';
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
  const manage = useManage();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="layout">
      <header className={`topbar${scrolled ? ' scrolled' : ''}`}>
        <Link to="/" className="brand"><span className="logo" aria-hidden="true"><Icon name="play" size={13} /></span>Animés</Link>
        <nav className="topnav">
          <button className={`pill-toggle${manage ? ' on' : ''}`} onClick={() => setManage(!manage)} aria-pressed={manage}
            title="Afficher les outils pour importer des vidéos et des sous-titres">
            <Icon name={manage ? 'check' : 'upload'} size={16} /> <span>{manage ? 'Gestion activée' : 'Gérer'}</span>
          </button>
          <button className="icon-btn ghost" onClick={onLogout} title={username ? `Déconnexion (${username})` : 'Déconnexion'} aria-label="Déconnexion">
            <Icon name="logout" size={18} />
          </button>
        </nav>
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
