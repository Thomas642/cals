import { computeTargets } from './calc.js';

export function getProfile(db) {
  return db.prepare('SELECT * FROM profile WHERE id = 1').get() || null;
}

/** Profil + detail du calcul (age, BMR, TDEE, cibles calculees). */
export function profileView(db) {
  const p = getProfile(db);
  if (!p) return null;
  let computed = null;
  try {
    computed = computeTargets(p);
  } catch {
    computed = null;
  }
  return { ...p, manual_targets: !!p.manual_targets, computed };
}

/** Recalcule et enregistre les cibles, sauf si des cibles manuelles sont actives (section 4.6). */
export function recalcTargets(db) {
  const p = getProfile(db);
  if (!p || p.manual_targets) return;
  const t = computeTargets(p);
  db.prepare(`UPDATE profile SET target_kcal = ?, target_protein_g = ?, target_carbs_g = ?, target_fat_g = ?
    WHERE id = 1`).run(t.target_kcal, t.target_protein_g, t.target_carbs_g, t.target_fat_g);
}

/** Met le poids courant du profil a la mesure la plus recente, puis recalcule. */
export function syncCurrentWeight(db) {
  const last = db.prepare('SELECT weight_kg FROM weight_log ORDER BY date DESC, id DESC LIMIT 1').get();
  if (!last || !getProfile(db)) return;
  db.prepare('UPDATE profile SET weight_kg = ? WHERE id = 1').run(last.weight_kg);
  recalcTargets(db);
}
