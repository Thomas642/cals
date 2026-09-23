// Validation des entrees. Toute erreur leve une ValidationError (HTTP 400).

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v) {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function date(v, field = 'date') {
  if (!isIsoDate(v)) throw new ValidationError(`${field} : format attendu YYYY-MM-DD`);
  return v;
}

export function num(v, field, { min = -Infinity, max = Infinity, optional = false } = {}) {
  if (v === null || v === undefined || v === '') {
    if (optional) return null;
    throw new ValidationError(`${field} : valeur requise`);
  }
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new ValidationError(`${field} : nombre attendu`);
  if (n < min || n > max) throw new ValidationError(`${field} : doit etre entre ${min} et ${max}`);
  return n;
}

export function str(v, field, { max = 200, optional = false } = {}) {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) {
    if (optional) return null;
    throw new ValidationError(`${field} : texte requis`);
  }
  if (typeof v !== 'string') throw new ValidationError(`${field} : texte attendu`);
  const s = v.trim();
  if (s.length > max) throw new ValidationError(`${field} : ${max} caracteres maximum`);
  return s;
}

export function oneOf(v, field, values, { optional = false } = {}) {
  if ((v === null || v === undefined || v === '') && optional) return null;
  if (!values.includes(v)) throw new ValidationError(`${field} : valeur attendue parmi ${values.join(', ')}`);
  return v;
}

export function id(v, field = 'id') {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ValidationError(`${field} invalide`);
  return n;
}

// Bornes de coherence unite/quantite pour une entree de journal.
const QUANTITY_MAX = { g: 5000, unit: 50 };

/**
 * Valide une entree de journal (saisie manuelle, recette ou IA : meme regle, section 5).
 */
export function journalEntry(body) {
  const unit = oneOf(body.unit, 'unit', ['g', 'unit']);
  return {
    date: date(body.date),
    food_id: body.food_id === null || body.food_id === undefined ? null : id(body.food_id, 'food_id'),
    display_name: str(body.display_name, 'display_name', { max: 200 }),
    quantity: num(body.quantity, 'quantity', { min: 0.01, max: QUANTITY_MAX[unit] }),
    unit,
    kcal: num(body.kcal, 'kcal', { min: 0, max: 10000 }),
    protein_g: num(body.protein_g ?? 0, 'protein_g', { min: 0, max: 1000 }),
    carbs_g: num(body.carbs_g, 'carbs_g', { min: 0, max: 2000, optional: true }),
    fat_g: num(body.fat_g, 'fat_g', { min: 0, max: 1000, optional: true }),
    origin: oneOf(body.origin, 'origin', ['base', 'free', 'recipe', 'ia']),
  };
}

export function food(body) {
  return {
    name: str(body.name, 'name', { max: 200 }),
    kcal: num(body.kcal, 'kcal', { min: 0, max: 1000 * (body.ref_unit === 'unit' ? 5 : 1) }),
    protein_g: num(body.protein_g ?? 0, 'protein_g', { min: 0, max: 100 * (body.ref_unit === 'unit' ? 5 : 1) }),
    carbs_g: num(body.carbs_g, 'carbs_g', { min: 0, max: 500, optional: true }),
    fat_g: num(body.fat_g, 'fat_g', { min: 0, max: 500, optional: true }),
    ref_unit: oneOf(body.ref_unit, 'ref_unit', ['100g', 'unit']),
    source: str(body.source, 'source', { max: 200, optional: true }),
    is_estimate: body.is_estimate ? 1 : 0,
  };
}

export function profile(body) {
  const goal = oneOf(body.goal, 'goal', ['fat_loss', 'maintain', 'gain']);
  const birth = date(body.birth_date, 'birth_date');
  const out = {
    username: str(body.username, 'username', { max: 80 }),
    sex: oneOf(body.sex, 'sex', ['M', 'F']),
    birth_date: birth,
    height_cm: num(body.height_cm, 'height_cm', { min: 100, max: 250 }),
    weight_kg: num(body.weight_kg, 'weight_kg', { min: 30, max: 300 }),
    activity_level: oneOf(body.activity_level, 'activity_level', ['sedentary', 'light', 'moderate', 'intense', 'very_intense']),
    goal,
    goal_intensity: goal === 'maintain' ? null : oneOf(body.goal_intensity || 'moderate', 'goal_intensity', ['light', 'moderate', 'aggressive']),
    manual_targets: body.manual_targets ? 1 : 0,
  };
  const age = new Date().getFullYear() - Number(birth.slice(0, 4));
  if (age < 16 || age > 100) throw new ValidationError('birth_date : age hors du domaine de validite (16 a 100 ans)');
  if (out.manual_targets) {
    out.target_kcal = Math.round(num(body.target_kcal, 'target_kcal', { min: 1000, max: 6000 }));
    out.target_protein_g = Math.round(num(body.target_protein_g, 'target_protein_g', { min: 20, max: 400 }));
    const c = num(body.target_carbs_g, 'target_carbs_g', { min: 0, max: 1000, optional: true });
    const f = num(body.target_fat_g, 'target_fat_g', { min: 0, max: 400, optional: true });
    out.target_carbs_g = c === null ? null : Math.round(c);
    out.target_fat_g = f === null ? null : Math.round(f);
  }
  return out;
}
