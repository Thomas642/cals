import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, onUnauthorized } from './api.js';
import { clearProgress, loadProgress } from './progress.js';
import { setManage } from './manage.js';
import { initSettings } from './settings.js';
import UploadTray from './components/UploadTray.jsx';
import AccountMenu from './components/AccountMenu.jsx';
import Logo from './components/Logo.jsx';
import Login from './pages/Login.jsx';
import Library from './pages/Library.jsx';
import Series from './pages/Series.jsx';
import Watch from './pages/Watch.jsx';
import Admin from './pages/Admin.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Account from './pages/Account.jsx';

export default function App() {
  const [auth, setAuth] = useState(undefined);
  const [error, setError] = useState(null);

  const boot = useCallback(async () => {
    try {
      setError(null);
      const status = await api.refresh('/auth/status');
      if (status.authenticated) {
        if (status.user.role !== 'admin') setManage(false);
        initSettings(status.user.settings);
        await loadProgress();
      }
      setAuth(status);
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
  useEffect(() => onUnauthorized(() => { api.clear(); clearProgress(); setAuth((a) => ({ ...a, authenticated: false, user: null })); }), []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    api.clear();
    clearProgress();
    setAuth((a) => ({ ...a, authenticated: false, user: null }));
  }, []);

  if (error) return <BootError error={error} onRetry={boot} />;
  if (auth === undefined) return <div className="center-screen"><span className="spinner big" aria-label="Chargement" /></div>;
  if (!auth.authenticated) {
    return <Login configured={auth.configured} onLoggedIn={() => { api.clear(); setAuth(undefined); boot(); }} />;
  }
  return <Shell user={auth.user} onLogout={logout} />;
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

function Shell({ user, onLogout }) {
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const isAdmin = user.role === 'admin';
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
        <Link to="/" className="brand" aria-label="Accueil"><Logo size={34} /></Link>
        <AccountMenu user={user} onLogout={onLogout} />
      </header>
      <main className="page" key={location.pathname}>
        <Routes>
          <Route path="/" element={<Library user={user} />} />
          <Route path="/serie/:id" element={<Series user={user} />} />
          <Route path="/regarder/:id" element={<Watch user={user} />} />
          <Route path="/compte" element={<Account user={user} />} />
          {isAdmin && <Route path="/admin" element={<Dashboard />} />}
          {isAdmin && <Route path="/admin/comptes" element={<Admin me={user} />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="footer">
        <Logo size={22} />
        <span>Pour regarder ensemble, en VOSTFR.</span>
      </footer>
      {isAdmin && <UploadTray />}
    </div>
  );
}
