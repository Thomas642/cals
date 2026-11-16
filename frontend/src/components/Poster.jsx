import { hueOf } from '../files.js';

/** Affiche d'une serie (image importee ou miniature), sinon degrade colore avec l'initiale. */
export default function Poster({ series, className = '' }) {
  const initial = [...(series.title || '?').trim()][0]?.toUpperCase();
  return (
    <div className={`poster ${className}`} style={{ '--h': hueOf(series.title || '') }}>
      {series.cover_url ? <img src={series.cover_url} alt="" loading="lazy" /> : <span className="poster-initial">{initial}</span>}
    </div>
  );
}
