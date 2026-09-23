import { useState } from 'react';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';

export default function Login({ configured, onLoggedIn }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/login', { username, password, remember });
      onLoggedIn();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <span className="logo" aria-hidden="true" />
          <span>Cals</span>
        </div>
        <h1>Connexion</h1>
        <p className="muted">Suivi nutritionnel et recomposition corporelle</p>

        {!configured && (
          <p className="alert">Aucun identifiant n'est encore défini sur le serveur. Sur le VPS :<br />
            <code>docker compose -f ~/cals/docker-compose.yml exec backend node src/set-password.js &lt;identifiant&gt;</code></p>
        )}

        <label className="field">
          <span>Identifiant</span>
          <input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
            value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
        </label>
        <label className="field">
          <span>Mot de passe</span>
          <div className="password-wrap">
            <input name="password" type={show ? 'text' : 'password'} autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button type="button" className="icon-btn" onClick={() => setShow(!show)}
              aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
              <Icon name={show ? 'eyeOff' : 'eye'} size={18} />
            </button>
          </div>
        </label>
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Rester connecté (90 jours)
        </label>

        {error && <p className="alert" role="alert">{error}</p>}

        <button type="submit" className="primary big" disabled={busy || !configured}>
          {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="lock" size={18} />}
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </div>
  );
}
