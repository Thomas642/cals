import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, seedFoods } from '../src/db.js';
import { addMissingFoods } from '../src/add-foods.js';
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
  assert.equal(tomate.fat_g, null);
});
