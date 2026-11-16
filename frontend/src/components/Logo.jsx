import { useId } from 'react';

/** Logo : carre arrondi en degrade, triangle de lecture et petite etoile. */
export function LogoMark({ size = 32, className = '' }) {
  const gid = useId().replace(/:/g, '');
  return (
    <svg className={`logo-mark ${className}`} width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id={`lg${gid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff4f81" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="14" fill={`url(#lg${gid})`} />
      <path d="M19 15.6v16.8a1.6 1.6 0 0 0 2.45 1.36l13.2-8.4a1.6 1.6 0 0 0 0-2.72l-13.2-8.4A1.6 1.6 0 0 0 19 15.6z" fill="#fff" />
      <path d="M36.5 8.5l1.15 2.85L40.5 12.5l-2.85 1.15L36.5 16.5l-1.15-2.85L32.5 12.5l2.85-1.15z" fill="#fff" opacity="0.9" />
    </svg>
  );
}

/** Logo + nom du site. */
export default function Logo({ size = 32 }) {
  return (
    <span className="logo">
      <LogoMark size={size} />
      <span className="logo-word">Animés</span>
    </span>
  );
}
