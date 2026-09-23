// Annexe A du GDD v2. Valeurs par 100 g sauf ref_unit = 'unit'.
// Glucides et lipides non fournis par l'annexe : laisses a NULL (aucune valeur inventee).
// is_estimate = 1 pour les proteines marquees "(estimee)" dans l'annexe.
const f = (name, kcal, protein_g, ref_unit, source, is_estimate = 0) =>
  ({ name, kcal, protein_g, carbs_g: null, fat_g: null, ref_unit, source, is_estimate });

export const SEED_FOODS = [
  f('Aiguillettes Le Gaulois', 97, 22, '100g', 'Fiche Carrefour'),
  f('Cuisse poulet (viande + peau, crue)', 188, 17, '100g', 'CIQUAL'),
  f('Cuisse poulet cuite (viande + peau)', 232, 26, '100g', 'CIQUAL (rotie)'),
  f('Blanc de poulet cru', 112, 23, '100g', 'CIQUAL'),
  f('Riz blanc cru', 350, 7, '100g', 'CIQUAL'),
  f('Pates crues', 350, 12, '100g', 'CIQUAL'),
  f('Pomme de terre crue', 80, 2, '100g', 'CIQUAL'),
  f('Panes tomate mozza Vege', 227, 11, '100g', 'Fiche produit (OFF)'),
  f('Barre Nature Valley Proteine caramel sale (40 g)', 198, 10.4, 'unit', 'Fiche Carrefour'),
  f("Skyr Siggi's Cereales Miel & Noix", 93, 9, '100g', 'Emballage'),
  f('Skyr nature 0 %', 57, 10, '100g', 'Fiche produit'),
  f('Banane (pulpe)', 90.5, 1.1, '100g', 'CIQUAL 2020'),
  f('Banane entiere (poids non pele)', 58, 0.7, '100g', 'CIQUAL 2020 (~64 % pulpe)'),
  f("Huile d'olive vierge", 899, 0, '100g', 'CIQUAL'),
  f('Oeuf dur (~50 g)', 72, 6.3, 'unit', 'CIQUAL'),
  f('Thon au naturel (egoutte)', 105, 26, '100g', 'CIQUAL'),
  f('Pain de mie', 251, 8, '100g', 'Emballage (proteines estimees)', 1),
  f('Cancoillotte a la noix', 161, 13, '100g', 'fatsecret (proteines estimees)', 1),
  f('Gnocchi au fromage', 196, 6.1, '100g', 'Emballage'),
];
