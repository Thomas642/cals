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
      setAuth(await api.get('/auth/status'));
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { boot(); }, [boot]);
  useEffect(() => onUnauthorized(() => { api.clear(); setAuth((a) => ({ ...a, authenticated: false })); }), []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    api.clear();
    setAuth((a) => ({ ...a, authenticated: false }));
  }, []);

  if (error) return <div className="center-screen"><p className="alert">Serveur injoignable : {error}</p></div>;
  if (auth === undefined) return <div className="center-screen"><span className="spinner big" aria-label="Chargement" /></div>;
  if (!auth.authenticated) {
    return <Login configured={auth.configured} onLoggedIn={() => { api.clear(); setAuth(undefined); boot(); }} />;
  }
  return <Shell onLogout={logout} username={auth.username} />;
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
