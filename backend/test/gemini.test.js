import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { buildGeminiRequest, geminiModelChain, OUTPUT_SCHEMA, resolveModel, resolveProvider } from '../src/lib/assistant.js';

test('selection du fournisseur', () => {
  assert.equal(resolveProvider({}), null);
  assert.equal(resolveProvider({ GEMINI_API_KEY: 'g' }), 'gemini');
  assert.equal(resolveProvider({ ANTHROPIC_API_KEY: 'a' }), 'anthropic');
  assert.equal(resolveProvider({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' }), 'gemini');
  assert.equal(resolveProvider({ AI_PROVIDER: 'anthropic', GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' }), 'anthropic');
  assert.equal(resolveProvider({ AI_PROVIDER: 'anthropic', GEMINI_API_KEY: 'g' }), null);
  assert.equal(resolveModel('gemini', { GEMINI_MODEL: 'x' }), 'x');
  assert.deepEqual(geminiModelChain({}), ['gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash']);
  assert.deepEqual(geminiModelChain({ GEMINI_MODEL: 'a', GEMINI_FALLBACK_MODELS: 'b, a ,c' }), ['a', 'b', 'c']);
  assert.deepEqual(geminiModelChain({ GEMINI_FALLBACK_MODELS: '' }), ['gemini-3.6-flash']);
});

test('requete Gemini : historique, prompt systeme, schema JSON', () => {
  const req = buildGeminiRequest({
    model: 'm', userText: 'Q', foods: [{ id: 1, name: 'Riz', ref_unit: '100g', kcal: 350, protein_g: 7, carbs_g: null, fat_g: null, source: 'CIQUAL', is_estimate: 0 }],
    history: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }],
  });
  assert.deepEqual(req.contents.map((c) => c.role), ['user', 'model', 'user']);
  assert.match(req.config.systemInstruction, /assistant nutritionnel de l'application Cals/);
  assert.match(req.config.systemInstruction, /Riz \| pour 100 g \| 350 kcal/);
  assert.equal(req.config.responseMimeType, 'application/json');
  assert.equal(req.config.responseJsonSchema, OUTPUT_SCHEMA);
});

test('bout en bout via le SDK Gemini contre un faux serveur', async (t) => {
  let received = null;
  let calls = 0;
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls += 1;
      if (calls === 1) { // premiere tentative : erreur temporaire, le SDK doit reessayer
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: { code: 502, message: 'Bad Gateway', status: 'UNAVAILABLE' } }));
        return;
      }
      received = { url: req.url, body: JSON.parse(body), key: req.headers['x-goog-api-key'] };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: JSON.stringify({
          answer: '2 oeufs durs : 144 kcal, 12,6 g de proteines.',
          confidence: 'haute',
          proposed_entries: [{ aliment: 'Oeuf dur', quantite: 2, unite: 'unit', kcal: 144, proteines_g: 12.6, source: 'CIQUAL', est_estime: false }],
        }) }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      }));
    });
  }).listen(0);
  t.after(() => fake.close());

  process.env.GEMINI_API_KEY = 'cle-test';
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${fake.address().port}`;
  delete process.env.AI_PROVIDER;
  delete process.env.ANTHROPIC_API_KEY;
  t.after(() => { delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_BASE_URL; });

  const { askAssistant } = await import('../src/lib/assistant.js');
  const out = await askAssistant({ message: '2 oeufs durs', history: [], foods: [], context: 'ctx' });
  assert.equal(out.proposed_entries.length, 1);
  assert.equal(out.proposed_entries[0].kcal, 144);
  assert.equal(out.confidence, 'haute');
  assert.equal(calls, 2);
  assert.match(received.url, /models\/gemini-3\.6-flash:generateContent/);
  assert.equal(received.key, 'cle-test');
  assert.equal(received.body.generationConfig.responseMimeType, 'application/json');
  assert.ok(received.body.generationConfig.responseJsonSchema);
  assert.match(received.body.systemInstruction.parts[0].text, /REGLES DE DONNEES/);
});

test('modele de secours quand le principal renvoie 503 a chaque tentative', async (t) => {
  const hits = [];
  const fake = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      hits.push(req.url);
      res.setHeader('Content-Type', 'application/json');
      if (req.url.includes('gemini-3.6-flash')) {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: { code: 503, message: 'The model is overloaded.', status: 'UNAVAILABLE' } }));
        return;
      }
      res.end(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: JSON.stringify({ answer: 'ok secours', confidence: 'moyenne', proposed_entries: [] }) }] } }] }));
    });
  }).listen(0);
  t.after(() => fake.close());
  process.env.GEMINI_API_KEY = 'cle-test';
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${fake.address().port}`;
  t.after(() => { delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_BASE_URL; });
  const { askAssistant } = await import('../src/lib/assistant.js');
  const out = await askAssistant({ message: 'q', history: [], foods: [], context: 'ctx' });
  assert.equal(out.answer, 'ok secours');
  assert.equal(hits.filter((u) => u.includes('gemini-3.6-flash')).length, 3);
  assert.equal(hits.filter((u) => u.includes('gemini-3.7-flash')).length, 1);
});
