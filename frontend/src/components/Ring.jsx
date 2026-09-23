import { n0 } from '../format.js';

/** Anneau de progression des calories : consomme / cible. */
export default function Ring({ value, target, size = 168 }) {
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = target > 0 ? Math.min(value / target, 1) : 0;
  const over = target > 0 && value > target;
  const rest = target - value;
  return (
    <div className={`ring ${over ? 'over' : ''}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-fill" strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={c * (1 - ratio)} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div className="ring-center">
        <span className="ring-value">{n0(Math.abs(rest))}</span>
        <span className="ring-label">{over ? 'kcal en trop' : 'kcal restantes'}</span>
        <span className="ring-sub">{n0(value)} / {n0(target)}</span>
      </div>
    </div>
  );
}
