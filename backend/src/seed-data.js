// Base d'aliments initiale (annexe A du GDD v2), verifiee le 23/09/2026.
// Valeurs par 100 g sauf ref_unit = 'unit'.
// - CIQUAL : valeurs de la table en ligne (ciqual.anses.fr), code indique dans la source.
// - Produits de marque : etiquette / Open Food Facts (code-barres indique).
// Une valeur non fournie par la source reste a null (aucune valeur inventee).
// Une teneur CIQUAL "traces" ou "< 0,5 g" est comptee 0, avec la mention d'origine dans la source.
const f = (name, kcal, protein_g, carbs_g, fat_g, ref_unit, source, is_estimate = 0) =>
  ({ name, kcal, protein_g, carbs_g, fat_g, ref_unit, source, is_estimate });

export const SEED_FOODS = [
  f('Aiguillettes Le Gaulois', 97, 22, null, null, '100g', 'Fiche Carrefour'),
  f('Cuisse poulet (viande + peau, crue)', 192, 17.3, 0, 13.5, '100g', 'CIQUAL (code 36002)'),
  f('Cuisse poulet cuite (viande + peau)', 205, 25.9, 0, 11.3, '100g', 'CIQUAL (code 36004, rôtie) ; glucides : traces (comptés 0)'),
  f('Blanc de poulet cru', 110, 23.4, 0, 1.5, '100g', 'CIQUAL (code 36017)'),
  f('Riz blanc cru', 350, 7.02, 77.5, 0.79, '100g', 'CIQUAL (code 9100)'),
  f('Pates crues', 364, 12, 72.7, 1.6, '100g', 'CIQUAL (code 9810, pâtes sèches standard)'),
  f('Pomme de terre crue', 80, 2.02, 16.2, 0.09, '100g', 'CIQUAL (code 4008)'),
  f('Panes tomate mozza Vege', 227, 11, null, null, '100g', 'Fiche produit (OFF)'),
  f('Barre Nature Valley Proteine caramel sale (40 g)', 198, 10.4, 10.5, 11.8, 'unit',
    'Fiche Carrefour ; glucides/lipides : Open Food Facts 8410076901231 (26,25 g G et 29,5 g L / 100 g)'),
  f("Skyr Siggi's Cereales Miel & Noix", 93, 9, 9, 2.3, '100g', "Emballage ; Open Food Facts 0668924969447"),
  f('Skyr nature 0 %', 57, 10, 3.9, 0.2, '100g',
    'Fiche produit ; glucides/lipides : Skyr 0 % Danone, Open Food Facts 0035091454081 (marque à confirmer)', 1),
  f('Banane (pulpe)', 87.6, 1.06, 19.7, 0, '100g', 'CIQUAL (code 13005) ; lipides < 0,5 g (comptés 0)'),
  f('Banane entiere (poids non pele)', 56.1, 0.68, 12.6, 0, '100g',
    'CIQUAL (code 13005) x 0,64 (part de pulpe indiquée dans le GDD) ; lipides < 0,5 g (comptés 0)', 1),
  f("Huile d'olive vierge", 899, 0.25, 0, 99.9, '100g', 'CIQUAL (code 17270, vierge extra) ; glucides : traces (comptés 0)'),
  f('Oeuf dur (~50 g)', 67, 6.75, 0.26, 4.31, 'unit', 'CIQUAL (code 22010) x 0,5 (oeuf de 50 g)'),
  f('Thon au naturel (egoutte)', 143, 26.8, 0, 3.94, '100g', 'CIQUAL (code 26039)'),
  f('Pain de mie', 251, 8, null, null, '100g', 'Emballage (proteines estimees)', 1),
  f('Cancoillotte a la noix', 161, 13, null, null, '100g', 'fatsecret (proteines estimees)', 1),
  f('Gnocchi au fromage', 196, 6.1, 34, 3.7, '100g',
    'Emballage ; glucides/lipides : Lustucru Gnocchi au fromage, Open Food Facts 0490095766002'),
];

// Valeurs de la premiere version (annexe A telle que fournie), pour ne mettre a jour
// dans une base existante que les aliments que l'utilisateur n'a pas modifies.
export const ORIGINAL_SEED = {
  'Aiguillettes Le Gaulois': [97, 22],
  'Cuisse poulet (viande + peau, crue)': [188, 17],
  'Cuisse poulet cuite (viande + peau)': [232, 26],
  'Blanc de poulet cru': [112, 23],
  'Riz blanc cru': [350, 7],
  'Pates crues': [350, 12],
  'Pomme de terre crue': [80, 2],
  'Panes tomate mozza Vege': [227, 11],
  'Barre Nature Valley Proteine caramel sale (40 g)': [198, 10.4],
  "Skyr Siggi's Cereales Miel & Noix": [93, 9],
  'Skyr nature 0 %': [57, 10],
  'Banane (pulpe)': [90.5, 1.1],
  'Banane entiere (poids non pele)': [58, 0.7],
  "Huile d'olive vierge": [899, 0],
  'Oeuf dur (~50 g)': [72, 6.3],
  'Thon au naturel (egoutte)': [105, 26],
  'Pain de mie': [251, 8],
  'Cancoillotte a la noix': [161, 13],
  'Gnocchi au fromage': [196, 6.1],
};
