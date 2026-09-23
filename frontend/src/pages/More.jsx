import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { NAV } from '../nav.js';

export default function More({ onLogout, username }) {
  return (
    <>
      <h1>Plus</h1>
      <div className="menu-list card">
        {NAV.filter((n) => !n.mobile).map((n) => (
          <Link key={n.to} to={n.to}><Icon name={n.icon} /><span>{n.label}</span><Icon name="chevronRight" size={18} className="muted" /></Link>
        ))}
        <button onClick={onLogout}><Icon name="logout" /><span>Déconnexion{username ? ` (${username})` : ''}</span></button>
      </div>
    </>
  );
}
