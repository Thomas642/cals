// Annexe C du GDD v2 : programme 5 seances.
export const PROGRAM_INTRO = {
  materiel: 'Haltères, poids du corps, appui stable (chaise/banc).',
  frequence: 'Chaque muscle 2 fois/semaine, ne pas enchaîner J1 et J4.',
  reflexe: 'Surcharge progressive : augmenter charge ou répétitions au fil des semaines.',
};

export const PROGRAM = [
  { code: 'J1', title: 'Jambes + abdos', exercises: [
    ['Squat', '4 x 10'], ['Fentes', '3 x 10 / jambe'], ['Step-up', '3 x 10 / jambe'],
    ['Mollets', '3 x 15-20'], ['Abdos simples', '3 x 25'], ['Genoux vers coudes', '3 x 25'],
  ] },
  { code: 'J2', title: 'Épaules + biceps', exercises: [
    ['Développé épaules', '4 x 8'], ['Élévations frontales', '4 x 8'], ['Tirage menton', '4 x 8'],
    ['Curl simple', '4 x 8'], ['Curl marteau', '4 x 8'],
  ] },
  { code: 'J3', title: 'Dos + pecs + abdos', exercises: [
    ['Rowing haltères penché', '4 x 8-10'], ['Tractions ou rowing australien', '3 x max'], ['Pompes', '4 x 15'],
    ['Touchers de talons', '3 x 25'], ['Rotations dos droit', '3 x 25'],
  ] },
  { code: 'J4', title: 'Jambes + abdos', exercises: [
    ['Squat', '4 x 10'], ['Fentes bulgares', '3 x 8 / jambe'], ['Step-up', '3 x 10 / jambe'],
    ['Mollets', '3 x 15-20'], ['Abdos simples', '3 x 25'], ['Rotations obliques', '3 x 25'],
  ] },
  { code: 'J5', title: 'Haut complet', exercises: [
    ['Développé épaules', '4 x 8'], ['Rowing haltères penché', '4 x 8'], ['Pompes', '4 x 15'],
    ['Curl simple', '3 x 10'], ['Curl marteau', '3 x 10'], ['Élévations frontales', '3 x 12'],
  ] },
];
