import express from 'express';
import * as v from './lib/validate.js';
import { ageFromBirthDate, nutritionFor, round1, unitForFood } from './lib/calc.js';
import { getProfile, profileView, recalcTargets, syncCurrentWeight } from './lib/profile-service.js';
import { entriesForDate, insertEntry, remaining, totals } from './lib/journal-service.js';
import { recipeView, saveRecipe, validateRecipe } from './lib/recipe-service.js';
import { askAssistant, contextBlock, resolveModel, resolveProvider } from './lib/assistant.js';
import { createAuth } from './lib/auth.js';

const notFound = (what) => Object.assign(new Error(`${what} introuvable`), { status: 404 });
const today = () => new Date().toISOString().slice(0, 10);

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function createApp(db) {
  const app = express();
  app.set('trust proxy', 'loopback, uniquelocal');
  app.use(express.json({ limit: '1mb' }));
  const auth = createAuth(db);
  const r = express.Router();

  r.get('/health', (req, res) => {
    const provider = resolveProvider();
    res.json({ ok: true, ai_enabled: !!provider, ai_provider: provider, model: resolveModel(provider) });
  });

  // ---------- Authentification (routes publiques) ----------
  r.get('/auth/status', (req, res) => res.json(auth.status(req)));
  r.post('/auth/login', (req, res) => res.json(auth.login(req, res, {
    username: req.body?.username, password: req.body?.password, remember: req.body?.remember !== false,
  })));
  r.post('/auth/logout', (req, res) => { auth.logout(req, res); res.status(204).end(); });

  // Toutes les routes suivantes exigent une session.
  r.use(auth.requireSession);

  // ---------- Profil ----------
  r.get('/profile', (req, res) => res.json(profileView(db)));

  r.put('/profile', (req, res) => {
    const p = v.profile(req.body || {});
    const exists = !!getProfile(db);
    const cols = ['username', 'sex', 'birth_date', 'height_cm', 'weight_kg', 'activity_level', 'goal', 'goal_intensity', 'manual_targets'];
    if (p.manual_targets) cols.push('target_kcal', 'target_protein_g', 'target_carbs_g', 'target_fat_g');
    db.transaction(() => {
      if (exists) {
        db.prepare(`UPDATE profile SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = 1`).run(p);
      } else {
        db.prepare(`INSERT INTO profile (id, ${cols.join(', ')}) VALUES (1, ${cols.map((c) => `@${c}`).join(', ')})`).run(p);
        db.prepare('INSERT INTO weight_log (date, weight_kg) VALUES (?, ?)').run(today(), p.weight_kg);
      }
      recalcTargets(db);
    })();
    res.json(profileView(db));
  });

  // ---------- Aliments ----------
  r.get('/foods', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const rows = q
      ? db.prepare("SELECT * FROM food WHERE name LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE")
        .all(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
      : db.prepare('SELECT * FROM food ORDER BY name COLLATE NOCASE').all();
    res.json(rows);
  });

  r.post('/foods', (req, res) => {
    const f = v.food(req.body || {});
    const info = db.prepare(`INSERT INTO food (name, kcal, protein_g, carbs_g, fat_g, ref_unit, source, is_estimate)
      VALUES (@name, @kcal, @protein_g, @carbs_g, @fat_g, @ref_unit, @source, @is_estimate)`).run(f);
    res.status(201).json(db.prepare('SELECT * FROM food WHERE id = ?').get(info.lastInsertRowid));
  });

  r.put('/foods/:id', (req, res) => {
    const fid = v.id(req.params.id);
    const f = v.food(req.body || {});
    const info = db.prepare(`UPDATE food SET name = @name, kcal = @kcal, protein_g = @protein_g, carbs_g = @carbs_g,
      fat_g = @fat_g, ref_unit = @ref_unit, source = @source, is_estimate = @is_estimate WHERE id = @id`).run({ ...f, id: fid });
    if (!info.changes) throw notFound('Aliment');
    res.json(db.prepare('SELECT * FROM food WHERE id = ?').get(fid));
  });

  r.delete('/foods/:id', (req, res) => {
    const fid = v.id(req.params.id);
    const used = db.prepare('SELECT COUNT(*) AS n FROM recipe_ingredient WHERE food_id = ?').get(fid).n;
    if (used) throw Object.assign(new Error(`Aliment utilise dans ${used} ingredient(s) de recette`), { status: 409 });
    const info = db.prepare('DELETE FROM food WHERE id = ?').run(fid);
    if (!info.changes) throw notFound('Aliment');
    res.status(204).end();
  });

  // ---------- Journal ----------
  function dayView(date) {
    const entries = entriesForDate(db, date);
    const t = totals(entries);
    return { date, entries, totals: t, remaining: remaining(getProfile(db), t) };
  }

  r.get('/journal', (req, res) => res.json(dayView(v.date(req.query.date || today()))));

  // Deux modes : { food_id, quantity } (valeurs calculees depuis la base) ou saisie complete.
  r.post('/journal', (req, res) => {
    const body = req.body || {};
    let entry;
    if (body.food_id && body.kcal === undefined) {
      const food = db.prepare('SELECT * FROM food WHERE id = ?').get(v.id(body.food_id, 'food_id'));
      if (!food) throw notFound('Aliment');
      const unit = unitForFood(food);
      const quantity = v.num(body.quantity, 'quantity', { min: 0.01, max: unit === 'g' ? 5000 : 50 });
      entry = v.journalEntry({ date: body.date, food_id: food.id, display_name: food.name, quantity, unit,
        ...nutritionFor(food, quantity), origin: 'base' });
    } else {
      entry = v.journalEntry(body);
      if (entry.food_id && !db.prepare('SELECT 1 FROM food WHERE id = ?').get(entry.food_id)) entry.food_id = null;
    }
    res.status(201).json(insertEntry(db, entry));
  });

  r.delete('/journal/:id', (req, res) => {
    const info = db.prepare('DELETE FROM journal_entry WHERE id = ?').run(v.id(req.params.id));
    if (!info.changes) throw notFound('Entree');
    res.status(204).end();
  });

  // ---------- Recettes ----------
  r.get('/recipes', (req, res) => {
    const ids = db.prepare('SELECT id FROM recipe ORDER BY name COLLATE NOCASE').all();
    res.json(ids.map(({ id }) => recipeView(db, id)));
  });

  r.get('/recipes/:id', (req, res) => {
    const rec = recipeView(db, v.id(req.params.id));
    if (!rec) throw notFound('Recette');
    res.json(rec);
  });

  r.post('/recipes', (req, res) => {
    const rid = saveRecipe(db, validateRecipe(db, req.body || {}));
    res.status(201).json(recipeView(db, rid));
  });

  r.put('/recipes/:id', (req, res) => {
    const rid = v.id(req.params.id);
    if (!db.prepare('SELECT 1 FROM recipe WHERE id = ?').get(rid)) throw notFound('Recette');
    saveRecipe(db, validateRecipe(db, req.body || {}), rid);
    res.json(recipeView(db, rid));
  });

  r.delete('/recipes/:id', (req, res) => {
    const info = db.prepare('DELETE FROM recipe WHERE id = ?').run(v.id(req.params.id));
    if (!info.changes) throw notFound('Recette');
    res.status(204).end();
  });

  // Ajout d'une recette au journal en une action (valeurs par portion figees).
  r.post('/recipes/:id/log', (req, res) => {
    const rec = recipeView(db, v.id(req.params.id));
    if (!rec) throw notFound('Recette');
    const portions = v.num(req.body?.servings ?? 1, 'servings', { min: 0.25, max: 20 });
    const s = (x) => (x === null ? null : round1(x * portions));
    const entry = v.journalEntry({
      date: req.body?.date || today(), food_id: null, display_name: `${rec.name} (recette)`,
      quantity: portions, unit: 'unit', kcal: s(rec.per_serving.kcal), protein_g: s(rec.per_serving.protein_g),
      carbs_g: s(rec.per_serving.carbs_g), fat_g: s(rec.per_serving.fat_g), origin: 'recipe',
    });
    res.status(201).json(insertEntry(db, entry));
  });

  // ---------- Routines ----------
  function routineView(rid) {
    const rt = db.prepare('SELECT * FROM routine WHERE id = ?').get(rid);
    if (!rt) return null;
    const items = db.prepare('SELECT * FROM routine_item WHERE routine_id = ? ORDER BY id').all(rid);
    return { ...rt, items, totals: totals(items) };
  }

  r.get('/routines', (req, res) => {
    res.json(db.prepare('SELECT id FROM routine ORDER BY name COLLATE NOCASE').all().map(({ id }) => routineView(id)));
  });

  // Cree une routine a partir des entrees d'un jour (entry_ids optionnel pour filtrer).
  r.post('/routines', (req, res) => {
    const name = v.str(req.body?.name, 'name', { max: 120 });
    const date = v.date(req.body?.from_date, 'from_date');
    let entries = entriesForDate(db, date);
    if (Array.isArray(req.body?.entry_ids)) {
      const keep = new Set(req.body.entry_ids.map(Number));
      entries = entries.filter((e) => keep.has(e.id));
    }
    if (!entries.length) throw new v.ValidationError('Aucune entree a enregistrer dans la routine');
    const rid = db.transaction(() => {
      const id = db.prepare('INSERT INTO routine (name) VALUES (?)').run(name).lastInsertRowid;
      const ins = db.prepare(`INSERT INTO routine_item (routine_id, food_id, display_name, quantity, unit, kcal, protein_g, carbs_g, fat_g)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const e of entries) ins.run(id, e.food_id, e.display_name, e.quantity, e.unit, e.kcal, e.protein_g, e.carbs_g, e.fat_g);
      return id;
    })();
    res.status(201).json(routineView(rid));
  });

  r.delete('/routines/:id', (req, res) => {
    const info = db.prepare('DELETE FROM routine WHERE id = ?').run(v.id(req.params.id));
    if (!info.changes) throw notFound('Routine');
    res.status(204).end();
  });

  r.post('/routines/:id/log', (req, res) => {
    const rt = routineView(v.id(req.params.id));
    if (!rt) throw notFound('Routine');
    const date = v.date(req.body?.date || today());
    const created = db.transaction(() => rt.items.map((it) => insertEntry(db, v.journalEntry({
      date, food_id: it.food_id, display_name: it.display_name, quantity: it.quantity, unit: it.unit,
      kcal: it.kcal, protein_g: it.protein_g, carbs_g: it.carbs_g, fat_g: it.fat_g, origin: 'base',
    }))))();
    res.status(201).json(created);
  });

  // ---------- Poids ----------
  r.get('/weights', (req, res) => res.json(db.prepare('SELECT * FROM weight_log ORDER BY date, id').all()));

  r.post('/weights', (req, res) => {
    const date = v.date(req.body?.date || today());
    const weight = v.num(req.body?.weight_kg, 'weight_kg', { min: 30, max: 300 });
    const row = db.transaction(() => {
      // Une mesure par jour : la nouvelle remplace l'ancienne.
      db.prepare('DELETE FROM weight_log WHERE date = ?').run(date);
      const id = db.prepare('INSERT INTO weight_log (date, weight_kg) VALUES (?, ?)').run(date, weight).lastInsertRowid;
      syncCurrentWeight(db);
      return db.prepare('SELECT * FROM weight_log WHERE id = ?').get(id);
    })();
    res.status(201).json(row);
  });

  r.delete('/weights/:id', (req, res) => {
    const info = db.prepare('DELETE FROM weight_log WHERE id = ?').run(v.id(req.params.id));
    if (!info.changes) throw notFound('Mesure');
    syncCurrentWeight(db);
    res.status(204).end();
  });

  // ---------- Statistiques ----------
  // Adherence : ecart moyen aux cibles sur les jours comportant au moins une entree.
  r.get('/stats', (req, res) => {
    const end = v.date(req.query.end || today(), 'end');
    const profile = getProfile(db);
    const rows = db.prepare(`SELECT date, SUM(kcal) AS kcal, SUM(protein_g) AS protein_g, COUNT(*) AS n
      FROM journal_entry WHERE date > ? AND date <= ? GROUP BY date ORDER BY date`).all(addDays(end, -30), end);
    const window = (days) => {
      const start = addDays(end, -days);
      const inWin = rows.filter((x) => x.date > start);
      if (!inWin.length || !profile) return { days, logged_days: inWin.length, avg_kcal: null, avg_protein_g: null, kcal_gap: null, protein_gap: null };
      const avg = (k) => round1(inWin.reduce((s, x) => s + x[k], 0) / inWin.length);
      const avgAbs = (k, target) => round1(inWin.reduce((s, x) => s + Math.abs(x[k] - target), 0) / inWin.length);
      return {
        days,
        logged_days: inWin.length,
        avg_kcal: avg('kcal'),
        avg_protein_g: avg('protein_g'),
        kcal_gap: round1(avg('kcal') - profile.target_kcal),
        protein_gap: round1(avg('protein_g') - profile.target_protein_g),
        kcal_abs_gap: avgAbs('kcal', profile.target_kcal),
        protein_abs_gap: avgAbs('protein_g', profile.target_protein_g),
      };
    };
    // Moyenne glissante 7 jours du poids (mesures presentes dans la fenetre).
    const weights = db.prepare('SELECT id, date, weight_kg FROM weight_log ORDER BY date').all();
    const weightSeries = weights.map((w) => {
      const from = addDays(w.date, -6);
      const win = weights.filter((x) => x.date >= from && x.date <= w.date);
      return { ...w, avg7: round1(win.reduce((s, x) => s + x.weight_kg, 0) / win.length) };
    });
    res.json({
      end,
      targets: profile ? { kcal: profile.target_kcal, protein_g: profile.target_protein_g } : null,
      days: rows.map((x) => ({ date: x.date, kcal: round1(x.kcal), protein_g: round1(x.protein_g), entries: x.n })),
      adherence7: window(7),
      adherence30: window(30),
      weights: weightSeries,
    });
  });

  // ---------- Entrainement : journal de charges ----------
  r.get('/workouts', (req, res) => {
    const rows = req.query.day_code
      ? db.prepare('SELECT * FROM workout_log WHERE day_code = ? ORDER BY date DESC, id DESC LIMIT 200').all(String(req.query.day_code))
      : db.prepare('SELECT * FROM workout_log ORDER BY date DESC, id DESC LIMIT 200').all();
    res.json(rows);
  });

  r.post('/workouts', (req, res) => {
    const b = req.body || {};
    const row = {
      date: v.date(b.date || today()),
      day_code: v.oneOf(b.day_code, 'day_code', ['J1', 'J2', 'J3', 'J4', 'J5']),
      exercise: v.str(b.exercise, 'exercise', { max: 120 }),
      load_kg: v.num(b.load_kg, 'load_kg', { min: 0, max: 500, optional: true }),
      reps: v.str(b.reps, 'reps', { max: 60, optional: true }),
      note: v.str(b.note, 'note', { max: 500, optional: true }),
    };
    const info = db.prepare(`INSERT INTO workout_log (date, day_code, exercise, load_kg, reps, note)
      VALUES (@date, @day_code, @exercise, @load_kg, @reps, @note)`).run(row);
    res.status(201).json(db.prepare('SELECT * FROM workout_log WHERE id = ?').get(info.lastInsertRowid));
  });

  r.delete('/workouts/:id', (req, res) => {
    const info = db.prepare('DELETE FROM workout_log WHERE id = ?').run(v.id(req.params.id));
    if (!info.changes) throw notFound('Seance');
    res.status(204).end();
  });

  // ---------- Assistant IA ----------
  r.post('/assistant', async (req, res, next) => {
    try {
      const message = v.str(req.body?.message, 'message', { max: 2000 });
      const date = v.date(req.body?.date || today());
      const history = (Array.isArray(req.body?.history) ? req.body.history : [])
        .filter((h) => (h?.role === 'user' || h?.role === 'assistant') && typeof h.content === 'string' && h.content.trim())
        .slice(-10)
        .map((h) => ({ role: h.role, content: h.content.slice(0, 4000) }));
      if (history.length && history[0].role !== 'user') history.shift();
      const profile = getProfile(db);
      const day = dayView(date);
      const foods = db.prepare('SELECT * FROM food ORDER BY id').all();
      const context = contextBlock({
        profile, age: profile ? ageFromBirthDate(profile.birth_date) : null,
        remaining: day.remaining || {}, consumed: day.totals, date,
      });
      res.json(await askAssistant({ message, history, foods, context }));
    } catch (err) {
      next(err);
    }
  });

  // ---------- Export / sauvegarde ----------
  r.get('/export', (req, res) => {
    const tables = ['profile', 'weight_log', 'food', 'journal_entry', 'recipe', 'recipe_ingredient', 'routine', 'routine_item', 'workout_log'];
    const dump = { app: 'cals', exported_at: new Date().toISOString() };
    for (const t of tables) dump[t] = db.prepare(`SELECT * FROM ${t}`).all();
    res.setHeader('Content-Disposition', `attachment; filename="cals-export-${today()}.json"`);
    res.json(dump);
  });

  app.use('/api', r);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500 && status !== 503) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Erreur interne' : err.message, code: status === 503 ? 'ia_indisponible' : undefined });
  });

  return app;
}
