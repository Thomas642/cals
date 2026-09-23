// Moteur de calcul (GDD v2, section 4 et annexe B).

export const ACTIVITY_FACTORS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  intense: 1.725,
  very_intense: 1.9,
};

// fat_loss : deficit 10/15/20 % (section 4.3).
// gain : surplus 5 a 15 % ; repartition par intensite choisie ici : 5/10/15 %.
export const GOAL_ADJUSTMENT = {
  fat_loss: { light: -0.10, moderate: -0.15, aggressive: -0.20 },
  gain: { light: 0.05, moderate: 0.10, aggressive: 0.15 },
};

// Proteines g/kg : 2,2 en fat_loss (haut de la fourchette 2,0-2,2 de la section 4.4),
// 1,8 sinon (dans la fourchette 1,6-2,2).
export const PROTEIN_PER_KG = { fat_loss: 2.2, maintain: 1.8, gain: 1.8 };

// Lipides : 0,8 a 1 g/kg minimum (section 4.5) ; valeur retenue : 0,8 g/kg.
export const FAT_PER_KG = 0.8;

// Facteurs d'Atwater generaux (kcal/g).
const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 };

export function ageFromBirthDate(birthDate, today = new Date()) {
  if (!birthDate) return null;
  const [y, m, d] = birthDate.split('-').map(Number);
  let age = today.getFullYear() - y;
  const beforeBirthday = today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

/** BMR Mifflin-St Jeor. */
export function bmr({ sex, weight_kg, height_cm, age }) {
  const base = 10 * weight_kg + 6.25 * height_cm - 5 * age;
  return sex === 'M' ? base + 5 : base - 161;
}

export function tdee(bmrValue, activityLevel) {
  const factor = ACTIVITY_FACTORS[activityLevel];
  if (!factor) throw new Error(`Niveau d'activite inconnu : ${activityLevel}`);
  return bmrValue * factor;
}

export function targetKcal(tdeeValue, goal, intensity) {
  if (goal === 'maintain') return tdeeValue;
  const adj = GOAL_ADJUSTMENT[goal]?.[intensity || 'moderate'];
  if (adj === undefined) throw new Error(`Objectif ou intensite inconnu : ${goal}/${intensity}`);
  return tdeeValue * (1 + adj);
}

/**
 * Calcule l'ensemble des besoins a partir du profil.
 * Retourne aussi les valeurs intermediaires (age, BMR, TDEE) pour l'affichage.
 */
export function computeTargets(profile, today = new Date()) {
  const age = ageFromBirthDate(profile.birth_date, today);
  if (age === null) throw new Error('Date de naissance requise pour le calcul');
  const b = bmr({ ...profile, age });
  const t = tdee(b, profile.activity_level);
  const kcal = Math.round(targetKcal(t, profile.goal, profile.goal_intensity));
  const protein = Math.round(PROTEIN_PER_KG[profile.goal] * profile.weight_kg);
  const fat = Math.round(FAT_PER_KG * profile.weight_kg);
  const carbs = Math.max(0, Math.round((kcal - protein * KCAL_PER_G.protein - fat * KCAL_PER_G.fat) / KCAL_PER_G.carbs));
  return {
    age,
    bmr: Math.round(b),
    tdee: Math.round(t),
    target_kcal: kcal,
    target_protein_g: protein,
    target_fat_g: fat,
    target_carbs_g: carbs,
  };
}

/** Valeurs nutritionnelles pour une quantite donnee d'un aliment de la base. */
export function nutritionFor(food, quantity) {
  const factor = food.ref_unit === '100g' ? quantity / 100 : quantity;
  const scale = (v) => (v === null || v === undefined ? null : round1(v * factor));
  return {
    kcal: round1(food.kcal * factor),
    protein_g: round1(food.protein_g * factor),
    carbs_g: scale(food.carbs_g),
    fat_g: scale(food.fat_g),
  };
}

export function unitForFood(food) {
  return food.ref_unit === '100g' ? 'g' : 'unit';
}

export function round1(v) {
  return Math.round(v * 10) / 10;
}
