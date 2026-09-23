import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAssistantOutput, validateProposed } from '../src/lib/assistant.js';

test('entree IA valide normalisee', () => {
  const e = validateProposed({ aliment: 'Oeuf dur', quantite: 2, unite: 'unit', kcal: 144, proteines_g: 12.6, source: 'CIQUAL', est_estime: false });
  assert.equal(e.est_estime, false);
  assert.equal(e.kcal, 144);
});

test('entrees IA hors bornes ou incoherentes rejetees', () => {
  assert.throws(() => validateProposed({ aliment: 'x', quantite: 100, unite: 'unit', kcal: 10, proteines_g: 1, source: 's' }));
  assert.throws(() => validateProposed({ aliment: 'x', quantite: 100, unite: 'kg', kcal: 10, proteines_g: 1, source: 's' }));
  assert.throws(() => validateProposed({ aliment: 'x', quantite: 100, unite: 'g', kcal: 50, proteines_g: 40, source: 's' }));
  assert.throws(() => validateProposed({ aliment: '', quantite: 100, unite: 'g', kcal: 50, proteines_g: 1, source: 's' }));
});

test('parseAssistantOutput separe entrees valides et rejetees', () => {
  const out = parseAssistantOutput(JSON.stringify({
    answer: 'ok',
    confidence: 'haute',
    proposed_entries: [
      { aliment: 'Riz', quantite: 100, unite: 'g', kcal: 350, proteines_g: 7, source: 'CIQUAL', est_estime: false },
      { aliment: 'Bug', quantite: -1, unite: 'g', kcal: 1, proteines_g: 0, source: 'x', est_estime: true },
    ],
  }));
  assert.equal(out.proposed_entries.length, 1);
  assert.equal(out.rejected_entries.length, 1);
  assert.throws(() => parseAssistantOutput('pas du json'));
});
