// Integration IA (GDD v2, section 6). Seul le backend appelle le fournisseur d'IA.
// Fournisseurs : Google Gemini (defaut si GEMINI_API_KEY est defini) ou Anthropic Claude.
import Anthropic from '@anthropic-ai/sdk';
import { ApiError as GeminiApiError, GoogleGenAI } from '@google/genai';
import { ValidationError } from './validate.js';

const DEFAULT_MODELS = { gemini: 'gemini-3.8-flash', anthropic: 'claude-haiku-4-5' };

/** Fournisseur actif : AI_PROVIDER explicite, sinon celui dont la cle est presente. */
export function resolveProvider(env = process.env) {
  const wanted = (env.AI_PROVIDER || '').toLowerCase();
  if (wanted === 'gemini' || wanted === 'anthropic') {
    const key = wanted === 'gemini' ? env.GEMINI_API_KEY : env.ANTHROPIC_API_KEY;
    return key ? wanted : null;
  }
  if (env.GEMINI_API_KEY) return 'gemini';
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

export function resolveModel(provider, env = process.env) {
  if (provider === 'gemini') return env.GEMINI_MODEL || DEFAULT_MODELS.gemini;
  if (provider === 'anthropic') return env.CLAUDE_MODEL || DEFAULT_MODELS.anthropic;
  return null;
}

// Prompt systeme de la section 6.4, repris tel quel.
export const SYSTEM_PROMPT = `Tu es l'assistant nutritionnel de l'application Cals. Tu aides un utilisateur unique
a suivre ses calories et ses macros pour une recomposition corporelle.

REGLES DE DONNEES (prioritaires) :
- Ta source de verite est la base d'aliments fournie dans le contexte. Utilise-la en priorite.
- Toute valeur nutritionnelle que tu fournis vient soit d'une base citee (base Cals,
  CIQUAL ANSES, USDA FoodData Central, etiquette produit), soit est marquee comme estimee
  (est_estime = true).
- N'invente jamais une valeur non sourcee. Si tu n'as pas de donnee fiable, dis-le
  clairement dans "answer" et mets proposed_entries a vide.
- Signale les facteurs qui font varier une valeur quand l'impact est notable
  (cuisson, variete, poids brut ou net).

FORMAT :
- Reponds toujours par un unique objet JSON valide conforme au schema fourni :
  { "answer": string, "proposed_entries": array, "confidence": "haute"|"moyenne"|"faible" }.
- "answer" est en francais, concis et direct.
- Remplis proposed_entries uniquement quand l'utilisateur veut enregistrer un ou
  plusieurs aliments.
- Si une quantite manque pour un calcul, ne devine pas : demande-la dans "answer".

PERIMETRE :
- Reste sur le calcul et le suivi nutritionnel.
- Ne donne aucun avis medical ni diagnostic. Pour toute demande de sante personnalisee,
  invite a consulter un professionnel.
- N'encourage aucun comportement a risque (restriction extreme, objectif de poids
  dangereux). Si une demande va dans ce sens, refuse la partie concernee et reste factuel.

CONTEXTE (fourni a chaque appel) : profil et cibles de l'utilisateur, restant du jour,
base d'aliments pertinente.`;

// Contrat de sortie (section 6.3), impose via les sorties structurees.
export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    proposed_entries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          aliment: { type: 'string' },
          quantite: { type: 'number' },
          unite: { type: 'string', enum: ['g', 'unit'] },
          kcal: { type: 'number' },
          proteines_g: { type: 'number' },
          source: { type: 'string' },
          est_estime: { type: 'boolean' },
        },
        required: ['aliment', 'quantite', 'unite', 'kcal', 'proteines_g', 'source', 'est_estime'],
        additionalProperties: false,
      },
    },
    confidence: { type: 'string', enum: ['haute', 'moyenne', 'faible'] },
  },
  required: ['answer', 'proposed_entries', 'confidence'],
  additionalProperties: false,
};

export class AssistantUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.status = 503;
  }
}

let anthropicClient = null;
let geminiClient = null;

/** Base d'aliments serialisee de facon deterministe (ordre par id) pour le cache de prompt. */
export function foodsBlock(foods) {
  const lines = foods.map((f) => [
    f.id, f.name, f.ref_unit === '100g' ? 'pour 100 g' : 'par unite',
    `${f.kcal} kcal`, `${f.protein_g} g prot`,
    f.carbs_g === null ? 'glucides n/d' : `${f.carbs_g} g gluc`,
    f.fat_g === null ? 'lipides n/d' : `${f.fat_g} g lip`,
    `source: ${f.source || 'non renseignee'}`, f.is_estimate ? 'ESTIMEE' : 'sourcee',
  ].join(' | '));
  return `BASE D'ALIMENTS CALS (id | nom | unite de reference | kcal | proteines | glucides | lipides | source | statut) :\n${lines.join('\n')}`;
}

export function contextBlock({ profile, age, remaining, consumed, date }) {
  if (!profile) return `Date : ${date}. Profil non renseigne.`;
  return [
    `Date du journal : ${date}`,
    `Profil : sexe ${profile.sex}, age ${age ?? 'inconnu'} ans, poids ${profile.weight_kg} kg`,
    `Cibles : ${profile.target_kcal} kcal, ${profile.target_protein_g} g proteines` +
      (profile.target_carbs_g !== null ? `, ${profile.target_carbs_g} g glucides` : '') +
      (profile.target_fat_g !== null ? `, ${profile.target_fat_g} g lipides` : ''),
    `Consomme aujourd'hui : ${consumed.kcal} kcal, ${consumed.protein_g} g proteines`,
    `Restant du jour : ${remaining.kcal} kcal, ${remaining.protein_g} g proteines`,
  ].join('\n');
}

/**
 * Valide une entree proposee par l'IA (types, bornes, coherence unite/quantite).
 * Retourne l'entree normalisee ou leve une ValidationError.
 */
export function validateProposed(e) {
  if (!e || typeof e !== 'object') throw new ValidationError('entree non objet');
  const name = typeof e.aliment === 'string' ? e.aliment.trim() : '';
  if (!name || name.length > 200) throw new ValidationError('aliment invalide');
  if (!['g', 'unit'].includes(e.unite)) throw new ValidationError('unite invalide');
  const maxQ = e.unite === 'g' ? 5000 : 50;
  const check = (v, label, max, min = 0) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new ValidationError(`${label} hors bornes`);
    return v;
  };
  const quantite = check(e.quantite, 'quantite', maxQ, 0.01);
  const kcal = check(e.kcal, 'kcal', 10000);
  const proteines = check(e.proteines_g, 'proteines_g', 1000);
  // Coherence : 4 kcal/g de proteines ne peut depasser le total energetique (tolerance 10 %).
  if (proteines * 4 > kcal * 1.1 + 5) throw new ValidationError('proteines incoherentes avec les kcal');
  return {
    aliment: name,
    quantite,
    unite: e.unite,
    kcal: Math.round(kcal * 10) / 10,
    proteines_g: Math.round(proteines * 10) / 10,
    source: typeof e.source === 'string' && e.source.trim() ? e.source.trim().slice(0, 200) : 'non renseignee',
    est_estime: e.est_estime !== false || !e.source,
  };
}

export function parseAssistantOutput(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.error('[assistant] JSON invalide recu :', String(text).slice(0, 500));
    throw new AssistantUnavailableError('Reponse IA non conforme (JSON invalide)');
  }
  if (typeof data.answer !== 'string') throw new AssistantUnavailableError('Reponse IA non conforme (answer manquant)');
  const entries = [];
  const rejected = [];
  for (const raw of Array.isArray(data.proposed_entries) ? data.proposed_entries : []) {
    try {
      entries.push(validateProposed(raw));
    } catch (err) {
      rejected.push({ aliment: raw?.aliment ?? null, reason: err.message });
    }
  }
  const confidence = ['haute', 'moyenne', 'faible'].includes(data.confidence) ? data.confidence : 'faible';
  return { answer: data.answer, proposed_entries: entries, rejected_entries: rejected, confidence };
}

const REFUSED = { answer: 'Demande refusee par le modele.', proposed_entries: [], rejected_entries: [], confidence: 'faible' };

/**
 * Pose la question au fournisseur actif. history : [{ role: 'user'|'assistant', content: string }].
 */
export async function askAssistant({ message, history, foods, context }) {
  const provider = resolveProvider();
  if (!provider) throw new AssistantUnavailableError('Aucune cle API d\'IA configuree : assistant desactive');
  const userText = `${context}\n\nQUESTION :\n${message}`;
  const model = resolveModel(provider);
  return provider === 'gemini'
    ? askGemini({ model, history, userText, foods })
    : askClaude({ model, history, userText, foods });
}

/** Requete Gemini (generateContent + sortie JSON contrainte par responseJsonSchema). */
export function buildGeminiRequest({ model, history, userText, foods }) {
  return {
    model,
    contents: [
      ...history.map((h) => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.content }] })),
      { role: 'user', parts: [{ text: userText }] },
    ],
    config: {
      systemInstruction: `${SYSTEM_PROMPT}\n\n${foodsBlock(foods)}`,
      responseMimeType: 'application/json',
      responseJsonSchema: OUTPUT_SCHEMA,
      maxOutputTokens: 8192,
    },
  };
}

async function askGemini(args) {
  if (!geminiClient) {
    // GEMINI_BASE_URL : uniquement pour les tests (faux serveur local).
    const base = process.env.GEMINI_BASE_URL;
    geminiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        ...(base ? { baseUrl: base } : {}),
        timeout: 60000,
        // Erreurs temporaires cote Google : jusqu'a 3 tentatives. Pas de nouvel essai sur 429 (quota).
        retryOptions: { attempts: 3, initialDelay: 1, maxDelay: 4, httpStatusCodes: [500, 502, 503, 504] },
      },
    });
  }
  let response;
  try {
    response = await geminiClient.models.generateContent(buildGeminiRequest(args));
  } catch (err) {
    console.error(`[assistant] erreur Gemini (${args.model}) :`, err?.status ?? '', err?.message ?? err);
    if (err instanceof GeminiApiError) {
      if (err.status === 429) throw new AssistantUnavailableError('Quota Gemini atteint, reessayer plus tard');
      if (err.status === 400 || err.status === 401 || err.status === 403) throw new AssistantUnavailableError(`Requete ou cle Gemini refusee (${err.status})`);
      throw new AssistantUnavailableError(`API Gemini indisponible (${err.status}) apres 3 tentatives, reessayer plus tard`);
    }
    throw new AssistantUnavailableError('API Gemini injoignable');
  }
  const finish = response.candidates?.[0]?.finishReason;
  const usage = response.usageMetadata;
  if (finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT' || finish === 'BLOCKLIST' || response.promptFeedback?.blockReason) {
    return { ...REFUSED, usage };
  }
  if (finish === 'MAX_TOKENS') {
    console.error('[assistant] reponse Gemini tronquee (MAX_TOKENS)', JSON.stringify(usage ?? {}));
    throw new AssistantUnavailableError('Reponse IA tronquee');
  }
  const text = response.text;
  if (!text) throw new AssistantUnavailableError('Reponse IA vide');
  return { ...parseAssistantOutput(text), usage };
}

async function askClaude({ model, history, userText, foods }) {
  if (!anthropicClient) anthropicClient = new Anthropic();
  const messages = [...history, { role: 'user', content: userText }];
  let response;
  try {
    response = await anthropicClient.messages.create({
      model,
      max_tokens: 4096,
      // Prompt caching : prompt systeme + base d'aliments (partie stable, repetee a chaque appel).
      system: [
        { type: 'text', text: SYSTEM_PROMPT },
        { type: 'text', text: foodsBlock(foods), cache_control: { type: 'ephemeral' } },
      ],
      output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      messages,
    });
  } catch (err) {
    console.error(`[assistant] erreur Claude (${model}) :`, err?.status ?? '', err?.message ?? err);
    if (err instanceof Anthropic.AuthenticationError) throw new AssistantUnavailableError('Cle API Claude refusee');
    if (err instanceof Anthropic.RateLimitError) throw new AssistantUnavailableError('Limite de debit API atteinte, reessayer plus tard');
    if (err instanceof Anthropic.APIError) throw new AssistantUnavailableError(`API Claude indisponible (${err.status ?? 'reseau'})`);
    throw new AssistantUnavailableError('API Claude injoignable');
  }
  if (response.stop_reason === 'refusal') return { ...REFUSED, usage: response.usage };
  if (response.stop_reason === 'max_tokens') throw new AssistantUnavailableError('Reponse IA tronquee');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { ...parseAssistantOutput(text), usage: response.usage };
}
