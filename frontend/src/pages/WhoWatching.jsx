import { useState } from 'react';
import Avatar from '../components/Avatar.jsx';
import { LogoMark } from '../components/Logo.jsx';

/** Ecran « Qui regarde ? » : choix du profil sur cet appareil. */
export default function WhoWatching({ profiles, onPick, onManage }) {
  const [busy, setBusy] = useState(null);
  return (
    <div className="who-screen">
      <div className="who-inner">
        <LogoMark size={46} />
        <h1>Qui regarde ?</h1>
        <ul className="who-grid">
          {profiles.map((p, i) => (
            <li key={p.id} style={{ '--i': i }}>
              <button className="who-tile" onClick={() => { setBusy(p.id); onPick(p); }} disabled={busy !== null}>
                <Avatar user={p} size="xl" />
                <span className="who-name">{p.name}</span>
                {busy === p.id && <span className="spinner" />}
              </button>
            </li>
          ))}
        </ul>
        {onManage && <button className="ghost-btn" onClick={onManage}>Gérer les profils</button>}
      </div>
    </div>
  );
}
