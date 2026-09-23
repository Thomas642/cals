import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api.js';
import Onboarding from './pages/Onboarding.jsx';
import Journal from './pages/Journal.jsx';
import Foods from './pages/Foods.jsx';
import Assistant from './pages/Assistant.jsx';
import Recipes from './pages/Recipes.jsx';
import Stats from './pages/Stats.jsx';
import Training from './pages/Training.jsx';
import Settings from './pages/Settings.jsx';

const NAV = [
  ['/', 'Journal'],
  ['/aliments', 'Aliments'],
  ['/assistant', 'Assistant'],
  ['/recettes', 'Recettes'],
  ['/stats', 'Stats'],
  ['/entrainement', 'Entraînement'],
  ['/reglages', 'Réglages'],
];

export default function App() {
  const [profile, setProfile] = useState(undefined);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);

  const reloadProfile = useCallback(() => api.get('/profile').then(setProfile).catch((e) => setError(e.message)), []);

  useEffect(() => {
    reloadProfile();
    api.get('/health').then(setHealth).catch(() => setHealth({ ok: false, ai_enabled: false }));
  }, [reloadProfile]);

  if (error) return <div className="page"><p className="alert">API injoignable : {error}</p></div>;
  if (profile === undefined) return <div className="page"><p className="muted">Chargement…</p></div>;
  if (profile === null) return <Onboarding onDone={setProfile} />;

  return (
    <div className="layout">
      <header className="topbar">
        <span className="brand">Cals</span>
        <nav>
          {NAV.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>
          ))}
        </nav>
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<Journal profile={profile} />} />
          <Route path="/aliments" element={<Foods />} />
          <Route path="/assistant" element={<Assistant aiEnabled={!!health?.ai_enabled} />} />
          <Route path="/recettes" element={<Recipes />} />
          <Route path="/stats" element={<Stats onProfileChange={reloadProfile} />} />
          <Route path="/entrainement" element={<Training />} />
          <Route path="/reglages" element={<Settings profile={profile} onSaved={setProfile} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
