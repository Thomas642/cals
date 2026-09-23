import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, seedFoods } from '../src/db.js';
import { createApp } from '../src/app.js';

delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.AI_PROVIDER;
const db = openDatabase(':memory:');
seedFoods(db);
const server = createApp(db).listen(0);
const base = `http://127.0.0.1:${server.address().port}/api`;
test.after(() => server.close());

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const profile = { username: 'Test', sex: 'M', birth_date: '1995-01-01', height_cm: 180, weight_kg: 80,
  activity_level: 'moderate', goal: 'fat_loss', goal_intensity: 'moderate' };

test('seed : 19 aliments de l annexe A', async () => {
  const { body } = await call('GET', '/foods');
  assert.equal(body.length, 19);
  assert.equal(body.filter((f) => f.is_estimate).length, 2);
});

test('onboarding puis cibles calculees', async () => {
  assert.equal((await call('GET', '/profile')).body, null);
  const { status, body } = await call('PUT', '/profile', profile);
  assert.equal(status, 200);
  assert.ok(body.target_kcal > 1500);
  assert.equal(body.target_protein_g, 160);
  assert.equal((await call('GET', '/weights')).body.length, 1);
});

test('profil invalide refuse', async () => {
  assert.equal((await call('PUT', '/profile', { ...profile, sex: 'X' })).status, 400);
});

test('journal : ajout depuis la base, valeurs figees', async () => {
  const foods = (await call('GET', '/foods?q=Riz')).body;
  const riz = foods[0];
  const add = await call('POST', '/journal', { date: '2025-06-01', food_id: riz.id, quantity: 150 });
  assert.equal(add.status, 201);
  assert.equal(add.body.kcal, 525);
  await call('PUT', `/foods/${riz.id}`, { ...riz, kcal: 400 });
  const day = (await call('GET', '/journal?date=2025-06-01')).body;
  assert.equal(day.totals.kcal, 525);
  assert.equal(day.totals.missing_carbs, 1);
});

test('journal : saisie IA soumise a la meme validation', async () => {
  const bad = await call('POST', '/journal', { date: '2025-06-01', display_name: 'x', quantity: 999, unit: 'unit', kcal: 10, origin: 'ia' });
  assert.equal(bad.status, 400);
  const ok = await call('POST', '/journal', { date: '2025-06-01', display_name: 'Pomme', quantity: 150, unit: 'g', kcal: 80, protein_g: 0.4, origin: 'ia' });
  assert.equal(ok.status, 201);
});

test('recettes : macros par portion et ajout au journal', async () => {
  const foods = (await call('GET', '/foods')).body;
  const poulet = foods.find((f) => f.name.startsWith('Blanc de poulet'));
  const oeuf = foods.find((f) => f.name.startsWith('Oeuf'));
  const rec = await call('POST', '/recipes', { name: 'Test', servings: 2, tags: 'rapide',
    ingredients: [{ food_id: poulet.id, quantity: 200 }, { food_id: oeuf.id, quantity: 2 }] });
  assert.equal(rec.status, 201);
  assert.equal(rec.body.total.kcal, 224 + 144);
  assert.equal(rec.body.per_serving.kcal, 184);
  const log = await call('POST', `/recipes/${rec.body.id}/log`, { date: '2025-06-02', servings: 1 });
  assert.equal(log.body.kcal, 184);
  assert.equal(log.body.origin, 'recipe');
  assert.equal((await call('DELETE', `/foods/${poulet.id}`)).status, 409);
});

test('routines : creation depuis un jour puis application', async () => {
  const rt = await call('POST', '/routines', { name: 'Midi', from_date: '2025-06-01' });
  assert.equal(rt.status, 201);
  const applied = await call('POST', `/routines/${rt.body.id}/log`, { date: '2025-06-03' });
  assert.equal(applied.body.length, rt.body.items.length);
});

test('poids : recalcul des cibles', async () => {
  await call('POST', '/weights', { date: '2099-01-01', weight_kg: 75 });
  const p = (await call('GET', '/profile')).body;
  assert.equal(p.weight_kg, 75);
  assert.equal(p.target_protein_g, 150);
});

test('cibles manuelles prioritaires', async () => {
  const p = (await call('PUT', '/profile', { ...profile, weight_kg: 75, manual_targets: true, target_kcal: 2100, target_protein_g: 170 })).body;
  assert.equal(p.target_kcal, 2100);
  await call('POST', '/weights', { date: '2099-01-02', weight_kg: 74 });
  assert.equal((await call('GET', '/profile')).body.target_kcal, 2100);
});

test('stats et export', async () => {
  const s = (await call('GET', '/stats?end=2025-06-03')).body;
  assert.equal(s.adherence7.logged_days, 3);
  assert.ok(s.weights.length >= 1);
  const e = (await call('GET', '/export')).body;
  assert.equal(e.app, 'cals');
});

test('assistant indisponible sans cle : 503', async () => {
  const r = await call('POST', '/assistant', { message: 'Combien de proteines dans 2 oeufs ?' });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'ia_indisponible');
});

test('workouts', async () => {
  assert.equal((await call('POST', '/workouts', { date: '2025-06-01', day_code: 'J1', exercise: 'Squat', load_kg: 20, reps: '4x10' })).status, 201);
  assert.equal((await call('POST', '/workouts', { day_code: 'J9', exercise: 'Squat' })).status, 400);
});
