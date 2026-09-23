import { nutritionFor, round1, unitForFood } from './calc.js';
import { ValidationError, id, num, str } from './validate.js';

export function validateRecipe(db, body) {
  const ingredients = Array.isArray(body.ingredients) ? body.ingredients : [];
  if (ingredients.length === 0) throw new ValidationError('ingredients : au moins un ingredient requis');
  const tags = Array.isArray(body.tags)
    ? body.tags.map((t) => String(t).trim()).filter(Boolean)
    : String(body.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
  return {
    name: str(body.name, 'name', { max: 200 }),
    servings: Math.round(num(body.servings ?? 1, 'servings', { min: 1, max: 50 })),
    steps: str(body.steps, 'steps', { max: 10000, optional: true }),
    tags: tags.join(','),
    ingredients: ingredients.map((ing, i) => {
      const foodId = id(ing.food_id, `ingredients[${i}].food_id`);
      const food = db.prepare('SELECT * FROM food WHERE id = ?').get(foodId);
      if (!food) throw new ValidationError(`ingredients[${i}] : aliment ${foodId} introuvable`);
      const unit = unitForFood(food);
      if (ing.unit && ing.unit !== unit) throw new ValidationError(`ingredients[${i}] : unite attendue ${unit} pour ${food.name}`);
      return { food_id: foodId, quantity: num(ing.quantity, `ingredients[${i}].quantity`, { min: 0.01, max: unit === 'g' ? 10000 : 100 }), unit };
    }),
  };
}

export function saveRecipe(db, data, recipeId = null) {
  return db.transaction(() => {
    let rid = recipeId;
    if (rid) {
      db.prepare('UPDATE recipe SET name = ?, servings = ?, steps = ?, tags = ? WHERE id = ?')
        .run(data.name, data.servings, data.steps, data.tags, rid);
      db.prepare('DELETE FROM recipe_ingredient WHERE recipe_id = ?').run(rid);
    } else {
      rid = db.prepare('INSERT INTO recipe (name, servings, steps, tags) VALUES (?, ?, ?, ?)')
        .run(data.name, data.servings, data.steps, data.tags).lastInsertRowid;
    }
    const ins = db.prepare('INSERT INTO recipe_ingredient (recipe_id, food_id, quantity, unit) VALUES (?, ?, ?, ?)');
    for (const ing of data.ingredients) ins.run(rid, ing.food_id, ing.quantity, ing.unit);
    return rid;
  })();
}

/** Recette complete avec ingredients et macros totales / par portion. */
export function recipeView(db, recipeId) {
  const r = db.prepare('SELECT * FROM recipe WHERE id = ?').get(recipeId);
  if (!r) return null;
  const rows = db.prepare(`SELECT ri.*, f.name, f.kcal AS f_kcal, f.protein_g AS f_protein_g, f.carbs_g AS f_carbs_g,
      f.fat_g AS f_fat_g, f.ref_unit, f.source, f.is_estimate
    FROM recipe_ingredient ri JOIN food f ON f.id = ri.food_id WHERE ri.recipe_id = ? ORDER BY ri.id`).all(recipeId);
  const total = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, carbs_complete: true, fat_complete: true };
  const ingredients = rows.map((row) => {
    const food = { kcal: row.f_kcal, protein_g: row.f_protein_g, carbs_g: row.f_carbs_g, fat_g: row.f_fat_g, ref_unit: row.ref_unit };
    const n = nutritionFor(food, row.quantity);
    total.kcal += n.kcal;
    total.protein_g += n.protein_g;
    if (n.carbs_g === null) total.carbs_complete = false; else total.carbs_g += n.carbs_g;
    if (n.fat_g === null) total.fat_complete = false; else total.fat_g += n.fat_g;
    return { id: row.id, food_id: row.food_id, name: row.name, quantity: row.quantity, unit: row.unit,
      is_estimate: !!row.is_estimate, source: row.source, ...n };
  });
  const per = (v, complete = true) => (complete ? round1(v / r.servings) : null);
  return {
    ...r,
    tags: r.tags ? r.tags.split(',').filter(Boolean) : [],
    ingredients,
    has_estimate: ingredients.some((i) => i.is_estimate),
    total: { kcal: round1(total.kcal), protein_g: round1(total.protein_g),
      carbs_g: total.carbs_complete ? round1(total.carbs_g) : null, fat_g: total.fat_complete ? round1(total.fat_g) : null },
    per_serving: { kcal: per(total.kcal), protein_g: per(total.protein_g),
      carbs_g: per(total.carbs_g, total.carbs_complete), fat_g: per(total.fat_g, total.fat_complete) },
  };
}
