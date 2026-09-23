import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, onUnauthorized } from './api.js';
import Icon from './components/Icon.jsx';
import Skeleton from './components/Skeleton.jsx';
import Login from './pages/Login.jsx';
import Journal from './pages/Journal.jsx';
import { NAV } from './nav.js';

// Pages chargees a la demande (le journal, page d'accueil, reste dans le paquet principal).
const pages = {
  Onboarding: () => import('./pages/Onboarding.jsx'),
  Foods: () => import('./pages/Foods.jsx'),
  Assistant: () => import('./pages/Assistant.jsx'),
  Recipes: () => import('./pages/Recipes.jsx'),
  Stats: () => import('./pages/Stats.jsx'),
  Training: () => import('./pages/Training.jsx'),
  Settings: () => import('./pages/Settings.jsx'),
  More: () => import('./pages/More.jsx'),
};
const Onboarding = lazy(pages.Onboarding);
const Foods = lazy(pages.Foods);
const Assistant = lazy(pages.Assistant);
const Recipes = lazy(pages.Recipes);
const Stats = lazy(pages.Stats);
const Training = lazy(pages.Training);
const Settings = lazy(pages.Settings);
const More = lazy(pages.More);


function prefetchAll() {
  // Apres le premier affichage : charge le code des autres pages et leurs donnees en tache de fond.
  const run = () => {
    Object.values(pages).forEach((load) => load());
    api.prefetch(['/foods', '/recipes', '/routines', '/health']);
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 1500);
}

export default function App() {
  const [auth, setAuth] = useState(undefined);
  const [profile, setProfile] = useState(undefined);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);

  const boot = useCallback(async () => {
    try {
      const status = await api.get('/auth/status');
      setAuth(status);
      if (!status.authenticated) return;
      const [p, h] = await Promise.all([api.get('/profile'), api.get('/health').catch(() => null)]);
      setProfile(p);
      setHealth(h);
      prefetchAll();
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { boot(); }, [boot]);
  useEffect(() => onUnauthorized(() => { api.clear(); setProfile(undefined); setAuth((a) => ({ ...a, authenticated: false })); }), []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    api.clear();
    setProfile(undefined);
    setAuth((a) => ({ ...a, authenticated: false }));
  }, []);

  if (error) {
    return (
      <div className="center-screen">
        <div className="error-box">
          <p className="alert">Chargement impossible : {error}</p>
          <button className="primary" onClick={() => { setError(null); setAuth(undefined); api.clear(); boot(); }}>Réessayer</button>
        </div>
      </div>
    );
  }
  if (auth === undefined) return <div className="center-screen"><span className="spinner big" aria-label="Chargement" /></div>;
  if (!auth.authenticated) {
    return <Login configured={auth.configured} onLoggedIn={() => { api.clear(); setAuth(undefined); boot(); }} />;
  }
  if (profile === undefined) return <div className="center-screen"><span className="spinner big" aria-label="Chargement" /></div>;
  if (profile === null) {
    return <Suspense fallback={<div className="center-screen"><span className="spinner big" /></div>}><Onboarding onDone={setProfile} /></Suspense>;
  }

  return <Shell profile={profile} setProfile={setProfile} health={health} onLogout={logout} username={auth.username} />;
}

function Shell({ profile, setProfile, health, onLogout, username }) {
  const location = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);
  const reloadProfile = useCallback(() => api.get('/profile').then(setProfile), [setProfile]);

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand"><span className="logo" aria-hidden="true" />Cals</div>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon name={n.icon} /> <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <button className="nav-logout" onClick={onLogout}><Icon name="logout" /> <span>Déconnexion{username ? ` (${username})` : ''}</span></button>
      </aside>

      <main className="page">
        <Suspense fallback={<><Skeleton lines={2} /><Skeleton lines={5} /></>}>
          <Routes>
            <Route path="/" element={<Journal profile={profile} />} />
            <Route path="/aliments" element={<Foods />} />
            <Route path="/assistant" element={<Assistant aiEnabled={!!health?.ai_enabled} />} />
            <Route path="/recettes" element={<Recipes />} />
            <Route path="/stats" element={<Stats onProfileChange={reloadProfile} />} />
            <Route path="/entrainement" element={<Training />} />
            <Route path="/reglages" element={<Settings profile={profile} onSaved={setProfile} />} />
            <Route path="/plus" element={<More onLogout={onLogout} username={username} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>

      <nav className="tabbar" aria-label="Navigation principale">
        {NAV.filter((n) => n.mobile).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon name={n.icon} size={22} /><span>{n.label}</span>
          </NavLink>
        ))}
        <NavLink to="/plus" className={({ isActive }) => (isActive || ['/recettes', '/entrainement', '/reglages'].includes(location.pathname) ? 'active' : '')}>
          <Icon name="more" size={22} /><span>Plus</span>
        </NavLink>
      </nav>
    </div>
  );
}
