import { useState } from 'react';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { hueOf } from '../files.js';
import Icon from '../components/Icon.jsx';

// Mot de passe aleatoire lisible (sans caracteres ambigus), a transmettre a la personne.
function generatePassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => chars[b % chars.length]).join('').replace(/(.{4})(?=.)/g, '$1-');
}

const ROLE_LABEL = { admin: 'Administrateur', viewer: 'Spectateur' };

function formatDate(sqlDate) {
  if (!sqlDate) return null;
  const d = new Date(`${sqlDate.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Admin({ me }) {
  const { data: users, error } = useApi('/users');
  const [created, setCreated] = useState(null); // { username, password } a communiquer

  return (
    <div className="admin">
      <header className="page-head">
        <span className="eyebrow">Administration</span>
        <h1>Comptes de la famille</h1>
        <p className="muted">
          Les <strong>spectateurs</strong> voient les séries et regardent les épisodes, rien d'autre : pas d'import, pas de
          modification, pas de bouton de téléchargement. Chacun garde sa propre progression de lecture.
        </p>
      </header>

      <NewUser onCreated={setCreated} />
      {created && (
        <div className="panel created">
          <Icon name="check" size={20} />
          <div className="grow">
            <strong>Compte « {created.username} » créé.</strong>
            <p className="muted small">Transmets ces identifiants à la personne. Le mot de passe ne sera plus affiché ensuite.</p>
            <div className="credentials">
              <span>Identifiant : <code>{created.username}</code></span>
              <span>Mot de passe : <code>{created.password}</code></span>
              <button className="ghost-btn small-btn" onClick={() => navigator.clipboard?.writeText(`Identifiant : ${created.username}\nMot de passe : ${created.password}`)}>
                Copier
              </button>
            </div>
          </div>
          <button className="icon-btn ghost" onClick={() => setCreated(null)} aria-label="Fermer"><Icon name="close" size={16} /></button>
        </div>
      )}

      {error && <p className="alert">{error.message}</p>}
      <ul className="user-list">
        {users?.map((u) => <UserRow key={u.id} user={u} me={me} />)}
      </ul>
    </div>
  );
}

function NewUser({ onCreated }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState(generatePassword);
  const [role, setRole] = useState('viewer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/users', { username, display_name: displayName, password, role });
      onCreated({ username, password });
      setUsername(''); setDisplayName(''); setPassword(generatePassword()); setRole('viewer');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel new-user" onSubmit={submit}>
      <h2><Icon name="plus" size={18} /> Nouveau compte</h2>
      <div className="form-grid">
        <label>Prénom affiché
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} placeholder="ex. Léa" />
        </label>
        <label>Identifiant de connexion
          <input value={username} onChange={(e) => setUsername(e.target.value)} required maxLength={40} autoCapitalize="none" spellCheck={false} placeholder="ex. lea" />
        </label>
        <label>Mot de passe
          <div className="input-action">
            <input value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} spellCheck={false} />
            <button type="button" className="icon-btn ghost" onClick={() => setPassword(generatePassword())} title="Générer un autre mot de passe" aria-label="Générer un autre mot de passe">
              <Icon name="refresh" size={16} />
            </button>
          </div>
        </label>
        <label>Rôle
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="viewer">Spectateur (regarder seulement)</option>
            <option value="admin">Administrateur (tout gérer)</option>
          </select>
        </label>
      </div>
      {error && <p className="alert">{error}</p>}
      <div className="row-actions">
        <button type="submit" className="primary" disabled={busy || !username.trim()}>{busy ? <span className="spinner" /> : <Icon name="check" size={18} />} Créer le compte</button>
      </div>
    </form>
  );
}

function UserRow({ user: u, me }) {
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(u.display_name || '');
  const [role, setRole] = useState(u.role);
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const self = u.id === me.id;
  const name = u.display_name || u.username;

  async function save(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.put(`/users/${u.id}`, { display_name: displayName, role, ...(password ? { password } : {}) });
      setNotice(password ? `Nouveau mot de passe : ${password}` : null);
      setPassword('');
      setEditing(false);
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleDisabled() {
    setError(null);
    try { await api.put(`/users/${u.id}`, { disabled: !u.disabled }); } catch (err) { setError(err.message); }
  }

  async function remove() {
    if (!window.confirm(`Supprimer le compte « ${name} » ? Sa progression de lecture sera effacée.`)) return;
    try { await api.del(`/users/${u.id}`); } catch (err) { setError(err.message); }
  }

  return (
    <li className={`user-row${u.disabled ? ' disabled' : ''}`}>
      <div className="user-main">
        <span className="avatar big" style={{ '--h': hueOf(u.username) }}>{[...name][0]?.toUpperCase()}</span>
        <div className="user-text">
          <strong>{name} {self && <span className="muted small">(toi)</span>}</strong>
          <span className="muted small">@{u.username}{formatDate(u.last_watch) ? ` · vu pour la dernière fois le ${formatDate(u.last_watch)}` : ''}</span>
        </div>
        <span className={`role-badge ${u.role}`}>{u.role === 'admin' && <Icon name="shield" size={13} />} {ROLE_LABEL[u.role]}</span>
        {u.disabled && <span className="tag warn">Désactivé</span>}
        <div className="user-actions">
          <button className="icon-btn ghost" onClick={() => setEditing(!editing)} aria-label={`Modifier ${name}`}><Icon name="edit" size={16} /></button>
          {!self && <button className="ghost-btn small-btn" onClick={toggleDisabled}>{u.disabled ? 'Réactiver' : 'Désactiver'}</button>}
          {!self && <button className="icon-btn ghost danger" onClick={remove} aria-label={`Supprimer ${name}`}><Icon name="trash" size={16} /></button>}
        </div>
      </div>
      {editing && (
        <form className="user-edit form-grid" onSubmit={save}>
          <label>Prénom ou surnom<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} /></label>
          <label>Rôle
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="viewer">Spectateur</option>
              <option value="admin">Administrateur</option>
            </select>
          </label>
          <label>Nouveau mot de passe <span className="muted small">(laisser vide pour garder)</span>
            <div className="input-action">
              <input value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} spellCheck={false} placeholder="••••••••" />
              <button type="button" className="icon-btn ghost" onClick={() => setPassword(generatePassword())} aria-label="Générer un mot de passe"><Icon name="key" size={16} /></button>
            </div>
          </label>
          <div className="row-actions form-actions">
            <button type="button" className="ghost-btn" onClick={() => setEditing(false)}>Annuler</button>
            <button type="submit" className="primary">Enregistrer</button>
          </div>
        </form>
      )}
      {notice && <p className="notice small">{notice} <button className="link" onClick={() => setNotice(null)}>OK</button></p>}
      {error && <p className="alert small">{error}</p>}
    </li>
  );
}
