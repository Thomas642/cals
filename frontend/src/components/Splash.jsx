import { LogoMark } from './Logo.jsx';

/** Ecran de chargement : logo anime, nom du site, barre de progression indeterminee. */
export default function Splash({ label = 'Chargement' }) {
  return (
    <div className="splash" role="status" aria-label={label}>
      <div className="splash-logo"><LogoMark size={84} /></div>
      <span className="logo-word big splash-word">Animés</span>
      <span className="splash-bar" aria-hidden="true"><span /></span>
    </div>
  );
}
