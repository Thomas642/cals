import { useState } from 'react';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';

export default function Account({ user }) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [state, setState] = useState(null); // { ok, message }

  async function submit(e) {
    e.preventDefault();
    if (password !== confirm) { setState({ ok: false, message: 'Les deux mots de passe ne correspondent pas.' }); return; }
    try {
      await api.send('PUT', '/me/password', { current, password });
      setState({ ok: true, message: 'Mot de passe changé.' });
      setCurrent(''); setPassword(''); setConfirm('');
    } catch (err) {
      setState({ ok: false, message: err.message });
    }
  }

  return (
    <div className="narrow-page">
      <header className="page-head">
        <span className="eyebrow">Mon compte</span>
        <h1>{user.display_name || user.username}</h1>
        <p className="muted">@{user.username} · {user.role === 'admin' ? 'Administrateur' : 'Spectateur'}</p>
      </header>
      <form className="panel form" onSubmit={submit}>
        <h2><Icon name="lock" size={18} /> Changer mon mot de passe</h2>
        <label>Mot de passe actuel<input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>
        <label>Nouveau mot de passe<input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <label>Confirmer<input type="password" autoComplete="new-password" minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></label>
        {state && <p className={state.ok ? 'notice' : 'alert'}>{state.message}</p>}
        <div className="row-actions"><button className="primary" type="submit">Enregistrer</button></div>
      </form>
    </div>
  );
}
