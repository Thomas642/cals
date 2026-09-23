import test from 'node:test';
import assert from 'node:assert/strict';
import { ageFromBirthDate, bmr, computeTargets, nutritionFor, tdee } from '../src/lib/calc.js';

test('BMR Mifflin-St Jeor homme et femme', () => {
  // 10*80 + 6.25*180 - 5*30 + 5 = 1780
  assert.equal(bmr({ sex: 'M', weight_kg: 80, height_cm: 180, age: 30 }), 1780);
  // 10*60 + 6.25*165 - 5*30 - 161 = 1320.25
  assert.equal(bmr({ sex: 'F', weight_kg: 60, height_cm: 165, age: 30 }), 1320.25);
});

test('TDEE = BMR x facteur', () => {
  assert.equal(tdee(1780, 'moderate'), 1780 * 1.55);
  assert.throws(() => tdee(1780, 'inconnu'));
});

test('age calcule avant/apres anniversaire', () => {
  assert.equal(ageFromBirthDate('1995-06-15', new Date(2025, 5, 14)), 29);
  assert.equal(ageFromBirthDate('1995-06-15', new Date(2025, 5, 15)), 30);
});

test('cibles fat_loss moderate', () => {
  const t = computeTargets({ sex: 'M', birth_date: '1995-01-01', height_cm: 180, weight_kg: 80,
    activity_level: 'moderate', goal: 'fat_loss', goal_intensity: 'moderate' }, new Date(2025, 5, 1));
  assert.equal(t.age, 30);
  assert.equal(t.bmr, 1780);
  assert.equal(t.tdee, 2759);
  assert.equal(t.target_kcal, Math.round(1780 * 1.55 * 0.85));
  assert.equal(t.target_protein_g, 160);
  assert.equal(t.target_fat_g, 72);
  assert.equal(t.target_carbs_g, Math.round((t.target_kcal - 160 * 4 - 72 * 9) / 4));
});

test('nutritionFor : 100g et unite, macros absentes conservees a null', () => {
  const riz = { kcal: 350, protein_g: 7, carbs_g: null, fat_g: null, ref_unit: '100g' };
  assert.deepEqual(nutritionFor(riz, 150), { kcal: 525, protein_g: 10.5, carbs_g: null, fat_g: null });
  const oeuf = { kcal: 72, protein_g: 6.3, carbs_g: null, fat_g: null, ref_unit: 'unit' };
  assert.deepEqual(nutritionFor(oeuf, 2), { kcal: 144, protein_g: 12.6, carbs_g: null, fat_g: null });
});
