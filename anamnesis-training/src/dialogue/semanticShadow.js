import { QUESTION_VARIANTS } from '../data/questionVariants.js';

const slovakExamples = {
  chief_complaint: ['Čo vás dnes priviedlo?', 'Aký máte problém?'],
  hpi_onset: ['Kedy sa to začalo?', 'Odkedy máte tieto ťažkosti?'],
  hpi_timing: ['Ako dlho trvá jeden záchvat?', 'Ako často sa to opakuje?'],
  hpi_previous_episodes: ['Stalo sa vám to už niekedy?', 'Mali ste už podobné ťažkosti?'],
  medication_regular: ['Aké lieky pravidelne užívate?', 'Čo beriete každý deň?'],
  medication_frequency: ['Ako často ten liek beriete?', 'Koľkokrát denne beriete lieky?'],
  allergies: ['Máte nejaké alergie?', 'Ste alergický na nejaké lieky?'],
  social_household: ['S kým bývate?', 'Kto s vami býva doma?'],
  administrative_arrival_method: ['Ako ste sa sem dostali?', 'Kto vás sem priviezol?']
};

const englishTemporalExamples = {
  hpi_onset: ['When did the symptoms start?', 'When did you first feel it?'],
  hpi_timing: ['How long does each episode last?', 'How often does it come back?'],
  medication_frequency: ['How often do you take your medication?', 'How many times a day do you take it?']
};

export const SHADOW_EXAMPLES = [
  ...Object.entries(QUESTION_VARIANTS)
    .flatMap(([intent, phrases]) => phrases.map(phrase => ({ intent, phrase }))),
  ...Object.entries(englishTemporalExamples)
    .flatMap(([intent, phrases]) => phrases.map(phrase => ({ intent, phrase }))),
  ...Object.entries(slovakExamples)
    .flatMap(([intent, phrases]) => phrases.map(phrase => ({ intent, phrase })))
];

// Deliberately separate from the indexed phrases.
export const LANGUAGE_PROBES = [
  ['en', 'Have you ever felt this way on a different occasion?', 'hpi_previous_episodes'],
  ['en', 'How long is one spell from beginning to end?', 'hpi_timing'],
  ['en', 'At what point did you first become aware of this?', 'hpi_onset'],
  ['en', 'What is your schedule for taking those pills?', 'medication_frequency'],
  ['en', 'Who else stays under the same roof as you?', 'social_household'],
  ['sk', 'Kedy ste si prvý raz všimli tieto ťažkosti?', 'hpi_onset'],
  ['sk', 'Koľko minút zvyčajne trvá jeden takýto záchvat?', 'hpi_timing'],
  ['sk', 'Zažili ste takéto ťažkosti aj v minulosti?', 'hpi_previous_episodes'],
  ['sk', 'Ako často si dávate predpísané tabletky?', 'medication_frequency'],
  ['sk', 'Kto ešte s vami žije v domácnosti?', 'social_household']
];

export function rankByIntent(queryVector, examples, limit = 3) {
  if (!queryVector?.length || !queryVector.every(Number.isFinite)) throw new Error('Invalid query embedding.');
  const best = new Map();
  for (const { intent, vector } of examples) {
    if (queryVector.length !== vector?.length || !vector.every(Number.isFinite)) throw new Error('Invalid example embedding.');
    // The model produces unit-length embeddings.
    let score = 0;
    for (let i = 0; i < vector.length; i++) score += queryVector[i] * vector[i];
    if (!best.has(intent) || score > best.get(intent)) best.set(intent, score);
  }
  return [...best].map(([intent, score]) => ({ intent, score }))
    .sort((a, b) => b.score - a.score || a.intent.localeCompare(b.intent)).slice(0, limit);
}

const shadowIntents = new Set(SHADOW_EXAMPLES.map(example => example.intent));

export function validShadowRanking(candidates) {
  return Array.isArray(candidates) && candidates.length > 0 && candidates.length <= 3 &&
    candidates.every((candidate, i) => candidate && shadowIntents.has(candidate.intent) &&
      Number.isFinite(candidate.score) && Math.abs(candidate.score) <= 1.001 &&
      (!i || candidate.score <= candidates[i - 1].score)) &&
    new Set(candidates.map(candidate => candidate.intent)).size === candidates.length;
}

export async function evaluateShadow(rank, probes = LANGUAGE_PROBES) {
  const results = [];
  for (const [language, phrase, expected] of probes) {
    const started = performance.now();
    const candidates = await rank(phrase);
    results.push({ language, phrase, expected, top: candidates[0]?.intent ?? null,
      top3: candidates.slice(0, 3).some(candidate => candidate.intent === expected), elapsedMs: Math.round(performance.now() - started) });
  }
  return results;
}
