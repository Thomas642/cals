import { useState } from 'react';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import Icon from '../components/Icon.jsx';
import Avatar, { AvatarPicker } from '../components/Avatar.jsx';

export default function Account({ user }) {
  const { data: profiles } = useApi('/me/profiles');
  const me = profiles?.find((p) => p.id === user.id) || { ...user, name: user.display_name || user.username };
  const isMain = !user.is_profile;

  return (
    <div className="narrow-page account-page">
      <header className="page-head account-head">
        <Avatar user={me} size="xl" />
        <div>
          <span className="eyebrow">{isMain ? 'Mon compte' : 'Mon profil'}</span>
          <h1>{me.name}</h1>
          <p className="muted">{isMain ? `@${user.username} · ${user.role === 'admin' ? 'Administrateur' : 'Spectateur'}` : 'Profil de la famille'}</p>
        </div>
      </header>

      <ProfileEditor profile={me} title="Mon avatar et mon prénom" />

      {isMain && (
        <section className="panel">
          <h2><Icon name="users" size={18} /> Profils de la famille</h2>
          <p className="muted small">
            Plusieurs personnes peuvent partager ce compte sur un même appareil : chacune a son profil, avec sa progression,
            sa liste et ses réglages. « Qui regarde ? » s'affiche à l'ouverture du site quand il y a plusieurs profils.
            Les profils n'ont pas de mot de passe et ont les droits d'un spectateur.
          </p>
          <ul className="profile-list">
            {profiles?.filter((p) => !p.is_main).map((p) => <ProfileRow key={p.id} profile={p} />)}
          </ul>
          {(profiles?.filter((p) => !p.is_main).length || 0) < 6 ? <NewProfile /> : <p className="muted small">6 profils maximum.</p>}
        </section>
      )}

      {isMain && <PasswordForm />}
    </div>
  );
}

function ProfileEditor({ profile, title }) {
  const [name, setName] = useState(profile.name || '');
  const [avatar, setAvatar] = useState(profile.avatar);
  const [msg, setMsg] = useState(null);
  async function save(e) {
    e.preventDefault();
    try {
      await api.put(`/me/profiles/${profile.id}`, { name, avatar: avatar || undefined });
      setMsg({ ok: true, text: 'Enregistré. Recharge la page pour voir le nouvel avatar partout.' });
    } catch (err) { setMsg({ ok: false, text: err.message }); }
  }
  return (
    <form className="panel form" onSubmit={save}>
      <h2><Icon name="sparkle" size={18} /> {title}</h2>
      <label>Prénom affiché<input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required /></label>
      <AvatarPicker value={avatar} onChange={setAvatar} />
      {msg && <p className={msg.ok ? 'notice small' : 'alert small'}>{msg.text}</p>}
      <div className="row-actions"><button className="primary" type="submit">Enregistrer</button></div>
    </form>
  );
}

function ProfileRow({ profile }) {
  const [editing, setEditing] = useState(false);
  async function remove() {
    if (!window.confirm(`Supprimer le profil « ${profile.name} » ? Sa progression, sa liste et son historique seront effacés.`)) return;
    try { await api.del(`/me/profiles/${profile.id}`); } catch (err) { window.alert(err.message); }
  }
  return (
    <li className="profile-row">
      <div className="profile-main">
        <Avatar user={profile} size="lg" />
        <strong className="grow">{profile.name}</strong>
        <button className="icon-btn ghost" onClick={() => setEditing(!editing)} aria-label={`Modifier ${profile.name}`}><Icon name="edit" size={16} /></button>
        <button className="icon-btn ghost danger" onClick={remove} aria-label={`Supprimer ${profile.name}`}><Icon name="trash" size={16} /></button>
      </div>
      {editing && <ProfileEditor profile={profile} title={`Profil de ${profile.name}`} />}
    </li>
  );
}

function NewProfile() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState({ emoji: '🐼', color: '#22c55e' });
  const [error, setError] = useState(null);
  async function create(e) {
    e.preventDefault();
    try {
      await api.post('/me/profiles', { name, avatar });
      setOpen(false); setName(''); setError(null);
    } catch (err) { setError(err.message); }
  }
  if (!open) return <button className="ghost-btn" onClick={() => setOpen(true)}><Icon name="plus" size={16} /> Ajouter un profil</button>;
  return (
    <form className="form new-profile" onSubmit={create}>
      <label>Prénom<input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required autoFocus placeholder="ex. Tom" /></label>
      <AvatarPicker value={avatar} onChange={setAvatar} />
      {error && <p className="alert small">{error}</p>}
      <div className="row-actions"><button type="button" className="ghost-btn" onClick={() => setOpen(false)}>Annuler</button><button className="primary" type="submit">Créer le profil</button></div>
    </form>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [state, setState] = useState(null);
  async function submit(e) {
    e.preventDefault();
    if (password !== confirm) { setState({ ok: false, message: 'Les deux mots de passe ne correspondent pas.' }); return; }
    try {
      await api.send('PUT', '/me/password', { current, password });
      setState({ ok: true, message: 'Mot de passe changé.' });
      setCurrent(''); setPassword(''); setConfirm('');
    } catch (err) { setState({ ok: false, message: err.message }); }
  }
  return (
    <form className="panel form" onSubmit={submit}>
      <h2><Icon name="lock" size={18} /> Changer mon mot de passe</h2>
      <label>Mot de passe actuel<input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>
      <label>Nouveau mot de passe<input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      <label>Confirmer<input type="password" autoComplete="new-password" minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></label>
      {state && <p className={state.ok ? 'notice' : 'alert'}>{state.message}</p>}
      <div className="row-actions"><button className="primary" type="submit">Enregistrer</button></div>
    </form>
  );
}
