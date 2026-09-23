// Integration IA (GDD v2, section 6). Seul le backend appelle api.anthropic.com.
import Anthropic from '@anthropic-ai/sdk';
import { ValidationError } from './validate.js';

export const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5';

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

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new AssistantUnavailableError('Cle ANTHROPIC_API_KEY absente : assistant desactive');
  if (!client) client = new Anthropic();
  return client;
}

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

/**
 * Appel a l'API Claude. history : [{ role: 'user'|'assistant', content: string }].
 */
export async function askAssistant({ message, history, foods, context }) {
  const anthropic = getClient();
  const messages = [
    ...history,
    { role: 'user', content: `${context}\n\nQUESTION :\n${message}` },
  ];
  let response;
  try {
    response = await anthropic.messages.create({
      model: MODEL,
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
    if (err instanceof Anthropic.AuthenticationError) throw new AssistantUnavailableError('Cle API Claude refusee');
    if (err instanceof Anthropic.RateLimitError) throw new AssistantUnavailableError('Limite de debit API atteinte, reessayer plus tard');
    if (err instanceof Anthropic.APIError) throw new AssistantUnavailableError(`API Claude indisponible (${err.status ?? 'reseau'})`);
    throw new AssistantUnavailableError('API Claude injoignable');
  }
  if (response.stop_reason === 'refusal') {
    return { answer: 'Demande refusee par le modele.', proposed_entries: [], rejected_entries: [], confidence: 'faible', usage: response.usage };
  }
  if (response.stop_reason === 'max_tokens') throw new AssistantUnavailableError('Reponse IA tronquee');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { ...parseAssistantOutput(text), usage: response.usage };
}
