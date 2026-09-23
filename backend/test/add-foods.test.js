import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, seedFoods } from '../src/db.js';
import { addMissingFoods, applySeedCorrections, fillExtraFoods } from '../src/add-foods.js';
import { ORIGINAL_SEED, SEED_FOODS } from '../src/seed-data.js';
import { EXTRA_FOODS } from '../src/extra-foods.js';
import { nutritionFor } from '../src/lib/calc.js';

test('ajout des aliments supplementaires, sans doublon', () => {
  const db = openDatabase(':memory:');
  seedFoods(db);
  assert.equal(addMissingFoods(db).length, EXTRA_FOODS.length);
  assert.equal(addMissingFoods(db).length, 0);
  const tranche = db.prepare("SELECT * FROM food WHERE name LIKE '%1 tranche%'").get();
  // 8 tranches = 240 g : 254,4 kcal et 50,4 g de proteines (106 et 21 pour 100 g)
  assert.deepEqual(nutritionFor(tranche, 8), { kcal: 254.4, protein_g: 50.4, carbs_g: 1.4, fat_g: 5.3 });
  const filet = db.prepare("SELECT * FROM food WHERE name LIKE 'Filets de poulet%'").get();
  assert.deepEqual(nutritionFor(filet, 300), { kcal: 309, protein_g: 63, carbs_g: 0, fat_g: 6.3 });
  const tomate = db.prepare("SELECT * FROM food WHERE name = 'Tomate cerise, crue'").get();
  assert.equal(tomate.fat_g, 0);
});

test('corrections des aliments de depart : seulement ceux non modifies', () => {
  const db = openDatabase(':memory:');
  const ins = db.prepare(`INSERT INTO food (name, kcal, protein_g, carbs_g, fat_g, ref_unit, source, is_estimate)
    VALUES (?, ?, ?, NULL, NULL, ?, 'ancienne', 0)`);
  for (const f of SEED_FOODS) ins.run(f.name, ...ORIGINAL_SEED[f.name], f.ref_unit);
  db.prepare("UPDATE food SET kcal = 111 WHERE name = 'Riz blanc cru'").run(); // modifie a la main
  const r = applySeedCorrections(db);
  assert.ok(r.skipped.includes('Riz blanc cru'));
  assert.equal(r.updated.length, SEED_FOODS.length - 1);
  const thon = db.prepare("SELECT * FROM food WHERE name LIKE 'Thon%'").get();
  assert.equal(thon.kcal, 143);
  assert.equal(thon.fat_g, 3.94);
  assert.equal(db.prepare("SELECT kcal FROM food WHERE name = 'Riz blanc cru'").get().kcal, 111);
  assert.equal(applySeedCorrections(db).updated.length, 0); // relancable
});

test('coherence energetique des aliments complets (4 P + 4 G + 9 L a 12 % pres)', () => {
  for (const f of [...SEED_FOODS, ...EXTRA_FOODS]) {
    if (f.carbs_g === null || f.fat_g === null) continue;
    const atwater = 4 * f.protein_g + 4 * f.carbs_g + 9 * f.fat_g;
    assert.ok(Math.abs(atwater - f.kcal) <= Math.max(5, 0.12 * f.kcal), `${f.name} : ${f.kcal} kcal vs ${atwater.toFixed(1)}`);
  }
});

test('aliments supplementaires deja presents : complete les valeurs vides sans ecraser', () => {
  const db = openDatabase(':memory:');
  db.prepare(`INSERT INTO food (name, kcal, protein_g, carbs_g, fat_g, ref_unit, source, is_estimate)
    VALUES ('Tomate cerise, crue', 31.8, 1.31, 5.62, NULL, '100g', 'ancienne', 0)`).run();
  assert.deepEqual(fillExtraFoods(db), ['Tomate cerise, crue']);
  assert.equal(db.prepare("SELECT fat_g FROM food WHERE name = 'Tomate cerise, crue'").get().fat_g, 0);
  assert.deepEqual(fillExtraFoods(db), []);
});
