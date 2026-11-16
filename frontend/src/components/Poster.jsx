import { hueOf } from '../files.js';
import { LogoMark } from './Logo.jsx';

/**
 * Affiche d'une serie : image importee ou miniature ; sinon affiche typographique generee
 * (titre en grand sur un degrade de la couleur d'ambiance de la serie).
 */
export default function Poster({ series, className = '' }) {
  const title = (series.title || '?').trim();
  if (series.cover_url) {
    return <div className={`poster ${className}`} style={{ '--h': hueOf(title) }}><img src={series.cover_url} alt="" loading="lazy" /></div>;
  }
  // Taille du titre selon sa longueur (le mot le plus long ne doit pas deborder).
  const longest = Math.max(...title.split(/\s+/).map((w) => [...w].length));
  const size = longest > 11 || title.length > 34 ? 'xs' : longest > 8 || title.length > 22 ? 'sm' : title.length > 12 ? 'md' : 'lg';
  const accent = series.accent || `hsl(${hueOf(title)} 70% 58%)`;
  return (
    <div className={`poster poster-gen ${className}`} style={{ '--pc': accent, '--h': hueOf(title) }} aria-label={title}>
      <span className="pg-glow" aria-hidden="true" />
      <span className="pg-stripes" aria-hidden="true" />
      <span className={`pg-title ${size}`}>{title}</span>
      {series.title_native && <span className="pg-native" lang="ja">{series.title_native}</span>}
      <span className="pg-mark" aria-hidden="true"><LogoMark size={18} /></span>
    </div>
  );
}
