import Icon from './Icon.jsx';
import { hueOf } from '../files.js';

/** Miniature 16:9 d'un episode avec barre de progression de lecture. */
export default function Thumb({ src, seed = '', number, progress, watched, playable = true }) {
  const pct = progress?.dur ? Math.min(100, Math.round((progress.pos / progress.dur) * 100)) : 0;
  return (
    <div className="thumb" style={{ '--h': hueOf(seed) }}>
      {src ? <img src={src} alt="" loading="lazy" /> : <span className="thumb-num">{number ?? ''}</span>}
      {playable && <span className="thumb-play" aria-hidden="true"><Icon name="play" size={20} /></span>}
      {watched && <span className="thumb-badge"><Icon name="check" size={12} /> Vu</span>}
      {pct > 0 && !watched && <span className="thumb-progress"><span style={{ width: `${pct}%` }} /></span>}
    </div>
  );
}
