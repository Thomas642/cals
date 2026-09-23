import { n0 } from '../format.js';

/** Jauge horizontale : consomme / cible, avec restant ou depassement. */
export default function Gauge({ label, value, target, unit, incomplete, tone = 'kcal' }) {
  if (target === null || target === undefined) {
    return (
      <div className={`gauge ${tone}`}>
        <div className="gauge-head"><span>{label}</span><span>{n0(value)} {unit}</span></div>
      </div>
    );
  }
  const ratio = target > 0 ? value / target : 0;
  const over = value > target;
  return (
    <div className={`gauge ${tone} ${over ? 'over' : ''}`}>
      <div className="gauge-head">
        <span>{label}</span>
        <span><strong>{n0(value)}</strong> / {n0(target)} {unit}</span>
      </div>
      <div className="gauge-track" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemax={target} aria-label={label}>
        <div className="gauge-fill" style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
      <div className="gauge-foot">
        {over ? `Dépassement : +${n0(value - target)} ${unit}` : `Restant : ${n0(target - value)} ${unit}`}
        {incomplete ? <span className="muted"> · {incomplete} entrée(s) sans valeur</span> : null}
      </div>
    </div>
  );
}
