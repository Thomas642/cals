import { useEffect, useRef } from 'react';

// Decor de saison, discret : pas de clic intercepte, desactive dans le lecteur, si l'onglet est cache,
// si la personne a demande moins d'animations, ou dans les reglages du compte.
//   - printemps (20 mars - 31 mai) : petales de cerisier
//   - automne (1er octobre - 30 novembre) : feuilles
//   - Noel (1er decembre - 6 janvier) : neige
// Apercu force : ajouter ?decor=sakura, ?decor=automne ou ?decor=neige a l'adresse.

export function currentSeason(date = new Date()) {
  const forced = new URLSearchParams(window.location.search).get('decor');
  if (['sakura', 'automne', 'neige'].includes(forced)) return forced;
  const m = date.getMonth() + 1;
  const d = date.getDate();
  if ((m === 3 && d >= 20) || m === 4 || m === 5) return 'sakura';
  if (m === 10 || m === 11) return 'automne';
  if (m === 12 || (m === 1 && d <= 6)) return 'neige';
  return null;
}

export const SEASON_LABEL = { sakura: 'pétales de cerisier', automne: 'feuilles d\'automne', neige: 'neige' };

const PALETTES = {
  sakura: ['#ffc4d6', '#ffb3c9', '#ffd6e2', '#f9a8c3'],
  automne: ['#e07a2f', '#c8462f', '#e6a23c', '#a8642c', '#d4553a'],
  neige: ['#ffffff'],
};

function makeParticle(kind, w, h, initial) {
  const snow = kind === 'neige';
  return {
    x: Math.random() * w,
    y: initial ? Math.random() * h : -20 - Math.random() * 60,
    size: snow ? 1 + Math.random() * 2.6 : 5 + Math.random() * 6,
    vy: snow ? 0.35 + Math.random() * 0.8 : 0.6 + Math.random() * 0.9,
    vx: (Math.random() - 0.5) * 0.4,
    sway: Math.random() * Math.PI * 2,
    swaySpeed: 0.008 + Math.random() * 0.016,
    rot: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 0.04,
    flip: Math.random() * Math.PI * 2,
    alpha: snow ? 0.45 + Math.random() * 0.45 : 0.55 + Math.random() * 0.35,
    color: PALETTES[kind][Math.floor(Math.random() * PALETTES[kind].length)],
  };
}

function draw(ctx, kind, p) {
  ctx.save();
  ctx.globalAlpha = p.alpha;
  ctx.fillStyle = p.color;
  if (kind === 'neige') {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.scale(1, Math.max(0.15, Math.abs(Math.cos(p.flip)))); // effet de rotation en 3D
    ctx.beginPath();
    if (kind === 'sakura') {
      // Petale : goutte arrondie avec une petite encoche
      const s = p.size;
      ctx.moveTo(0, -s);
      ctx.bezierCurveTo(s * 0.9, -s * 0.6, s * 0.8, s * 0.6, 0, s);
      ctx.bezierCurveTo(-s * 0.8, s * 0.6, -s * 0.9, -s * 0.6, 0, -s);
    } else {
      // Feuille : amande pointue avec nervure
      const s = p.size * 1.15;
      ctx.moveTo(0, -s);
      ctx.quadraticCurveTo(s * 0.75, 0, 0, s);
      ctx.quadraticCurveTo(-s * 0.75, 0, 0, -s);
    }
    ctx.fill();
    if (kind === 'automne') {
      ctx.globalAlpha = p.alpha * 0.5;
      ctx.strokeStyle = 'rgba(60, 25, 10, 0.6)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(0, -p.size);
      ctx.lineTo(0, p.size * 1.1);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export default function Seasonal({ season }) {
  const canvas = useRef(null);

  useEffect(() => {
    if (!season || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const c = canvas.current;
    const ctx = c.getContext('2d');
    let w = 0;
    let h = 0;
    let particles = [];
    let raf = 0;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      c.width = w * dpr;
      c.height = h * dpr;
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Densite discrete, proportionnelle a la largeur de l'ecran.
      const target = Math.round((season === 'neige' ? 70 : 26) * Math.min(1.6, w / 1280));
      while (particles.length < target) particles.push(makeParticle(season, w, h, true));
      particles.length = target;
    };
    resize();
    window.addEventListener('resize', resize);

    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        p.sway += p.swaySpeed;
        p.flip += p.swaySpeed * 1.6;
        p.rot += p.vr;
        p.x += p.vx + Math.sin(p.sway) * (season === 'neige' ? 0.35 : 0.8);
        p.y += p.vy;
        if (p.y > h + 20 || p.x < -40 || p.x > w + 40) particles[i] = makeParticle(season, w, h, false);
        draw(ctx, season, particles[i]);
      }
      raf = requestAnimationFrame(tick);
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [season]);

  if (!season) return null;
  return <canvas ref={canvas} className="seasonal" aria-hidden="true" />;
}
