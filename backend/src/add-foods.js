// Met a jour la base d'aliments existante :
//  1. corrige les aliments de depart avec les valeurs verifiees de seed-data.js,
//     uniquement s'ils ont encore leurs valeurs d'origine (aliments modifies par l'utilisateur : ignores) ;
//  2. ajoute les aliments de extra-foods.js absents (comparaison par nom).
//   docker compose exec backend node src/add-foods.js
import { openDatabase } from './db.js';
import { EXTRA_FOODS } from './extra-foods.js';
import { ORIGINAL_SEED, SEED_FOODS } from './seed-data.js';

export function addMissingFoods(db, foods = EXTRA_FOODS) {
  const exists = db.prepare('SELECT 1 FROM food WHERE name = ? COLLATE NOCASE');
  const insert = db.prepare(`INSERT INTO food (name, kcal, protein_g, carbs_g, fat_g, ref_unit, source, is_estimate)
    VALUES (@name, @kcal, @protein_g, @carbs_g, @fat_g, @ref_unit, @source, @is_estimate)`);
  const added = [];
  db.transaction(() => {
    for (const f of foods) {
      if (exists.get(f.name)) continue;
      insert.run(f);
      added.push(f.name);
    }
  })();
  return added;
}

/** Aliments supplementaires deja presents : complete uniquement les glucides/lipides vides. */
export function fillExtraFoods(db, foods = EXTRA_FOODS) {
  const find = db.prepare('SELECT * FROM food WHERE name = ? COLLATE NOCASE');
  const update = db.prepare('UPDATE food SET carbs_g = @carbs_g, fat_g = @fat_g, source = @source WHERE id = @id');
  const filled = [];
  db.transaction(() => {
    for (const f of foods) {
      const row = find.get(f.name);
      if (!row || row.kcal !== f.kcal || row.protein_g !== f.protein_g) continue;
      const carbs = row.carbs_g ?? f.carbs_g;
      const fat = row.fat_g ?? f.fat_g;
      if (carbs === row.carbs_g && fat === row.fat_g) continue;
      update.run({ id: row.id, carbs_g: carbs, fat_g: fat, source: f.source });
      filled.push(f.name);
    }
  })();
  return filled;
}

export function applySeedCorrections(db) {
  const find = db.prepare('SELECT * FROM food WHERE name = ?');
  const update = db.prepare(`UPDATE food SET kcal = @kcal, protein_g = @protein_g, carbs_g = @carbs_g, fat_g = @fat_g,
    source = @source, is_estimate = @is_estimate WHERE id = @id`);
  const result = { updated: [], skipped: [] };
  db.transaction(() => {
    for (const f of SEED_FOODS) {
      const row = find.get(f.name);
      if (!row) continue;
      const same = row.kcal === f.kcal && row.protein_g === f.protein_g && row.carbs_g === f.carbs_g
        && row.fat_g === f.fat_g && row.source === f.source && row.is_estimate === f.is_estimate;
      if (same) continue;
      const [kcal0, prot0] = ORIGINAL_SEED[f.name];
      const untouched = row.kcal === kcal0 && row.protein_g === prot0 && row.carbs_g === null && row.fat_g === null;
      if (!untouched) { result.skipped.push(f.name); continue; }
      update.run({ ...f, id: row.id });
      result.updated.push(`${f.name} : ${row.kcal} -> ${f.kcal} kcal, ${row.protein_g} -> ${f.protein_g} g P, G ${f.carbs_g ?? 'n/d'}, L ${f.fat_g ?? 'n/d'}`);
    }
  })();
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = openDatabase();
  const { updated, skipped } = applySeedCorrections(db);
  const filled = fillExtraFoods(db);
  const added = addMissingFoods(db);
  if (filled.length) console.log(`Completes (${filled.length}) :\n- ${filled.join('\n- ')}`);
  console.log(updated.length ? `Corriges (${updated.length}) :\n- ${updated.join('\n- ')}` : 'Aucune correction a appliquer.');
  if (skipped.length) console.log(`Non modifies car deja changes a la main (${skipped.length}) :\n- ${skipped.join('\n- ')}`);
  console.log(added.length ? `Ajoutes (${added.length}) :\n- ${added.join('\n- ')}` : 'Rien a ajouter.');
  db.close();
}
