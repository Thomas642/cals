import { hueOf } from '../files.js';

export const AVATAR_EMOJIS = ['🦊', '🐱', '🐼', '🐲', '🐧', '🦄', '🐸', '🐙', '🐰', '🦁', '🐺', '🐯',
  '🌸', '⭐', '🌙', '🔥', '⚡', '🍙', '🍜', '🍡', '🎮', '👾', '🎧', '🗡️'];
export const AVATAR_COLORS = ['#ff4f81', '#8b5cf6', '#3987e5', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899', '#64748b'];

const parse = (a) => (typeof a === 'string' ? (() => { try { return JSON.parse(a); } catch { return null; } })() : a);

/** Avatar : emoji sur fond colore, sinon initiale sur degrade. size : 'sm' | 'md' | 'lg' | 'xl'. */
export default function Avatar({ user, size = 'md', className = '' }) {
  const a = parse(user?.avatar);
  const name = user?.name || user?.display_name || user?.username || '?';
  if (a?.emoji) {
    return <span className={`avatar ${size} emoji ${className}`} style={{ background: a.color }} aria-hidden="true">{a.emoji}</span>;
  }
  return <span className={`avatar ${size} ${className}`} style={{ '--h': hueOf(user?.username || name) }} aria-hidden="true">{[...name][0]?.toUpperCase()}</span>;
}

/** Choix d'un emoji et d'une couleur. */
export function AvatarPicker({ value, onChange }) {
  const v = parse(value) || { emoji: AVATAR_EMOJIS[0], color: AVATAR_COLORS[0] };
  return (
    <div className="avatar-picker">
      <div className="picker-preview"><span className="avatar xl emoji" style={{ background: v.color }}>{v.emoji}</span></div>
      <div className="picker-grids">
        <div className="emoji-grid" role="radiogroup" aria-label="Image">
          {AVATAR_EMOJIS.map((e) => (
            <button type="button" key={e} role="radio" aria-checked={v.emoji === e} className={v.emoji === e ? 'sel' : ''} onClick={() => onChange({ ...v, emoji: e })}>{e}</button>
          ))}
        </div>
        <div className="color-grid" role="radiogroup" aria-label="Couleur">
          {AVATAR_COLORS.map((c) => (
            <button type="button" key={c} role="radio" aria-checked={v.color === c} aria-label={`Couleur ${c}`} className={v.color === c ? 'sel' : ''} style={{ background: c }} onClick={() => onChange({ ...v, color: c })} />
          ))}
        </div>
      </div>
    </div>
  );
}
