export const todayIso = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export function shiftDate(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function longDate(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function shortDate(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

export const n0 = (v) => (v === null || v === undefined ? '–' : Math.round(v).toLocaleString('fr-FR'));
export const n1 = (v) => (v === null || v === undefined ? '–' : (Math.round(v * 10) / 10).toLocaleString('fr-FR'));

export const unitLabel = (u, q) => (u === 'g' ? 'g' : q > 1 ? 'unités' : 'unité');
export const refUnitLabel = (r) => (r === '100g' ? '/100 g' : '/unité');

export const ACTIVITY_LABELS = {
  sedentary: 'Sédentaire (x1,2)',
  light: 'Légère (x1,375)',
  moderate: 'Modérée (x1,55)',
  intense: 'Intense (x1,725)',
  very_intense: 'Très intense (x1,9)',
};
export const GOAL_LABELS = { fat_loss: 'Perte de gras', maintain: 'Maintien', gain: 'Prise de masse' };
export const INTENSITY_LABELS = { light: 'Légère', moderate: 'Modérée', aggressive: 'Soutenue' };
