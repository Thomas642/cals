// Aliments ajoutes a la demande de l'utilisateur (23/09/2026), valeurs pour 100 g sauf ref_unit 'unit'.
// Sources : etiquettes produit fournies en photo, table CIQUAL (ANSES).
// Une valeur absente de la source reste a null (aucune valeur inventee).
export const EXTRA_FOODS = [
  {
    name: 'Filets de poulet saumurés 7 % (crus)',
    kcal: 103, protein_g: 21, carbs_g: 0, fat_g: 2.1, ref_unit: '100g',
    source: 'Étiquette produit (photo du 23/09/2026)', is_estimate: 0,
  },
  {
    name: 'Blanc de poulet en tranches Marque Repère',
    kcal: 106, protein_g: 21, carbs_g: 0.6, fat_g: 2.2, ref_unit: '100g',
    source: 'Étiquette Marque Repère (Leclerc)', is_estimate: 0,
  },
  {
    // 1 tranche = 240 g / 8 tranches = 30 g ; valeurs = 0,3 x valeurs pour 100 g.
    name: 'Blanc de poulet Marque Repère, 1 tranche (30 g)',
    kcal: 31.8, protein_g: 6.3, carbs_g: 0.18, fat_g: 0.66, ref_unit: 'unit',
    source: 'Étiquette Marque Repère (Leclerc) ; paquet 240 g = 8 tranches', is_estimate: 0,
  },
  {
    // Lipides indiques "< 0,5 g/100 g" par CIQUAL : pas de valeur exacte, laisse vide.
    name: 'Tomate cerise, crue',
    kcal: 31.8, protein_g: 1.31, carbs_g: 5.62, fat_g: null, ref_unit: '100g',
    source: 'CIQUAL (code 20172) ; lipides < 0,5 g', is_estimate: 0,
  },
];
