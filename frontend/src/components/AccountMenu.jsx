import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { setManage, useManage } from '../manage.js';
import { updateSettings, useSettings } from '../settings.js';
import { SEASON_LABEL, currentSeason } from './Seasonal.jsx';
import Icon from './Icon.jsx';
import { hueOf } from '../files.js';

/** Pastille du compte connecte et menu (administration, mode gestion, mot de passe, deconnexion). */
export default function AccountMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const manage = useManage();
  const ref = useRef(null);
  const name = user.display_name || user.username;
  const isAdmin = user.role === 'admin';
  const settings = useSettings();
  const season = currentSeason();

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div className="account" ref={ref}>
      {isAdmin && manage && <span className="manage-flag">Gestion</span>}
      <button className="avatar-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" aria-label={`Compte : ${name}`}>
        <span className="avatar" style={{ '--h': hueOf(user.username) }}>{[...name][0]?.toUpperCase()}</span>
        <span className="avatar-name">{name}</span>
        <Icon name="chevronDown" size={16} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            <strong>{name}</strong>
            <span className="muted small">@{user.username} · {isAdmin ? 'Administrateur' : 'Spectateur'}</span>
          </div>
          {isAdmin && (
            <>
              <button role="menuitemcheckbox" aria-checked={manage} className="menu-item" onClick={() => setManage(!manage)}>
                <Icon name="upload" size={17} /> <span>Mode gestion</span>
                <span className={`switch${manage ? ' on' : ''}`} aria-hidden="true" />
              </button>
              <Link role="menuitem" className="menu-item" to="/admin" onClick={() => setOpen(false)}>
                <Icon name="gauge" size={17} /> <span>Tableau de bord</span>
              </Link>
              <Link role="menuitem" className="menu-item" to="/admin/comptes" onClick={() => setOpen(false)}>
                <Icon name="users" size={17} /> <span>Comptes de la famille</span>
              </Link>
            </>
          )}
          <button role="menuitemcheckbox" aria-checked={settings.seasonal !== false} className="menu-item" onClick={() => updateSettings({ seasonal: settings.seasonal === false })}>
            <Icon name="sparkle" size={17} />
            <span>Décor de saison<small className="menu-sub">{season ? `En ce moment : ${SEASON_LABEL[season]}` : 'Hors saison en ce moment'}</small></span>
            <span className={`switch${settings.seasonal !== false ? ' on' : ''}`} aria-hidden="true" />
          </button>
          <Link role="menuitem" className="menu-item" to="/compte" onClick={() => setOpen(false)}>
            <Icon name="lock" size={17} /> <span>Mon mot de passe</span>
          </Link>
          <button role="menuitem" className="menu-item danger" onClick={onLogout}>
            <Icon name="logout" size={17} /> <span>Déconnexion</span>
          </button>
        </div>
      )}
    </div>
  );
}
