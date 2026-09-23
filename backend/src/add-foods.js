// Ajoute a la base les aliments de src/extra-foods.js qui n'y sont pas encore (comparaison par nom).
//   docker compose exec backend node src/add-foods.js
import { openDatabase } from './db.js';
import { EXTRA_FOODS } from './extra-foods.js';

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

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = openDatabase();
  const added = addMissingFoods(db);
  console.log(added.length ? `Ajoutes (${added.length}) :\n- ${added.join('\n- ')}` : 'Rien a ajouter : tous ces aliments sont deja dans la base.');
  db.close();
}
