import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { formatClock, hueOf } from '../files.js';

const HOVER_DELAY_MS = 350;   // evite de lancer l'apercu en passant juste la souris
const FRAME_MS = 420;         // vitesse de defilement des images

/**
 * Miniature 16:9 d'un episode avec barre de progression. Au survol (souris), si une planche d'apercus existe,
 * les images de l'episode defilent en accelere.
 */
export default function Thumb({ src, seed = '', number, progress, watched, playable = true, storyboard, duration }) {
  const pct = progress?.dur ? Math.min(100, Math.round((progress.pos / progress.dur) * 100)) : 0;
  const [frame, setFrame] = useState(null);
  const box = useRef(null);
  const timers = useRef({});

  useEffect(() => () => { clearTimeout(timers.current.delay); clearInterval(timers.current.loop); }, []);

  function start(e) {
    if (!storyboard || e.pointerType === 'touch') return;
    clearTimeout(timers.current.delay);
    timers.current.delay = setTimeout(() => {
      // Une douzaine d'images reparties sur l'episode.
      const step = Math.max(1, Math.floor(storyboard.count / 12));
      let i = step;
      setFrame(i);
      timers.current.loop = setInterval(() => { i = (i + step) % storyboard.count; setFrame(i); }, FRAME_MS);
    }, HOVER_DELAY_MS);
  }
  function stop() {
    clearTimeout(timers.current.delay);
    clearInterval(timers.current.loop);
    setFrame(null);
  }

  // Image de la planche mise a l'echelle de la miniature.
  let frameStyle = null;
  if (storyboard && frame !== null && box.current) {
    const scale = box.current.clientWidth / storyboard.w;
    frameStyle = {
      backgroundImage: `url(${storyboard.url})`,
      backgroundSize: `${storyboard.w * storyboard.cols * scale}px ${storyboard.h * storyboard.rows * scale}px`,
      backgroundPosition: `-${(frame % storyboard.cols) * storyboard.w * scale}px -${Math.floor(frame / storyboard.cols) * storyboard.h * scale}px`,
    };
  }

  return (
    <div className="thumb" ref={box} style={{ '--h': hueOf(seed) }} onPointerEnter={start} onPointerLeave={stop}>
      {src ? <img src={src} alt="" loading="lazy" /> : <span className="thumb-num">{number ?? ''}</span>}
      {frameStyle && <span className="thumb-anim" style={frameStyle} aria-hidden="true" />}
      {playable && !frameStyle && <span className="thumb-play" aria-hidden="true"><Icon name="play" size={20} /></span>}
      {watched && <span className="thumb-badge"><Icon name="check" size={12} /> Vu</span>}
      {duration > 0 && !frameStyle && <span className="thumb-duration">{formatClock(duration)}</span>}
      {pct > 0 && !watched && <span className="thumb-progress"><span style={{ width: `${pct}%` }} /></span>}
    </div>
  );
}
