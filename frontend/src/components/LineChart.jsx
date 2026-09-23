import { shortDate } from '../format.js';

/**
 * Courbe SVG simple. series : [{ key, label, className }], points : [{ date, [key]: number }].
 * target : ligne horizontale optionnelle.
 */
export default function LineChart({ points, series, target, unit, height = 200 }) {
  if (!points.length) return <p className="muted">Pas encore de données.</p>;
  const W = 400, H = height, pad = { l: 40, r: 8, t: 10, b: 24 };
  const values = points.flatMap((p) => series.map((s) => p[s.key])).filter((v) => typeof v === 'number');
  if (typeof target === 'number') values.push(target);
  let min = Math.min(...values), max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const floor = Math.min(...values) >= 0 ? 0 : -Infinity;
  min = Math.max(floor, min - span * 0.08); max += span * 0.08;
  const x = (i) => pad.l + (points.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (points.length - 1));
  const y = (v) => pad.t + ((max - v) * (H - pad.t - pad.b)) / (max - min);
  const ticks = [0, 0.5, 1].map((t) => min + t * (max - min));
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map((s) => s.label).join(', ')}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="axis">{max - min > 10 ? Math.round(t) : Math.round(t * 10) / 10}</text>
          </g>
        ))}
        {typeof target === 'number' && <line x1={pad.l} x2={W - pad.r} y1={y(target)} y2={y(target)} className="target" />}
        {series.map((s) => {
          const pts = points.map((p, i) => (typeof p[s.key] === 'number' ? `${x(i)},${y(p[s.key])}` : null)).filter(Boolean);
          return (
            <g key={s.key} className={s.className}>
              <polyline points={pts.join(' ')} fill="none" />
              {points.map((p, i) => typeof p[s.key] === 'number' && (
                <circle key={i} cx={x(i)} cy={y(p[s.key])} r="3"><title>{`${shortDate(p.date)} : ${p[s.key]} ${unit}`}</title></circle>
              ))}
            </g>
          );
        })}
        {points.map((p, i) => i % labelEvery === 0 && (
          <text key={p.date} x={x(i)} y={H - 8} textAnchor="middle" className="axis">{shortDate(p.date)}</text>
        ))}
      </svg>
      <figcaption>
        {series.map((s) => <span key={s.key} className={`legend ${s.className}`}>{s.label}</span>)}
        {typeof target === 'number' && <span className="legend target">Cible</span>}
      </figcaption>
    </figure>
  );
}
