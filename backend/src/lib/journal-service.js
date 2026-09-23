import { round1 } from './calc.js';

export function entriesForDate(db, date) {
  return db.prepare('SELECT * FROM journal_entry WHERE date = ? ORDER BY created_at, id').all(date);
}

/**
 * Totaux d'une liste d'entrees. Glucides/lipides : somme des valeurs connues,
 * avec le nombre d'entrees sans valeur (macros incompletes).
 */
export function totals(entries) {
  const t = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, missing_carbs: 0, missing_fat: 0, count: entries.length };
  for (const e of entries) {
    t.kcal += e.kcal;
    t.protein_g += e.protein_g;
    if (e.carbs_g === null) t.missing_carbs += 1; else t.carbs_g += e.carbs_g;
    if (e.fat_g === null) t.missing_fat += 1; else t.fat_g += e.fat_g;
  }
  for (const k of ['kcal', 'protein_g', 'carbs_g', 'fat_g']) t[k] = round1(t[k]);
  return t;
}

export function remaining(profile, t) {
  if (!profile) return null;
  const r = (target, done) => (target === null || target === undefined ? null : round1(target - done));
  return {
    kcal: r(profile.target_kcal, t.kcal),
    protein_g: r(profile.target_protein_g, t.protein_g),
    carbs_g: r(profile.target_carbs_g, t.carbs_g),
    fat_g: r(profile.target_fat_g, t.fat_g),
  };
}

export function insertEntry(db, e) {
  const info = db.prepare(`INSERT INTO journal_entry
    (date, food_id, display_name, quantity, unit, kcal, protein_g, carbs_g, fat_g, origin)
    VALUES (@date, @food_id, @display_name, @quantity, @unit, @kcal, @protein_g, @carbs_g, @fat_g, @origin)`).run(e);
  return db.prepare('SELECT * FROM journal_entry WHERE id = ?').get(info.lastInsertRowid);
}
