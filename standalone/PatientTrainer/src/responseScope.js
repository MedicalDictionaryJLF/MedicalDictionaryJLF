const OBJECTIVE_DOMAINS = new Set(['vitals', 'examination', 'labs']);
const OBJECTIVE_IDS = new Set([
  'previous_ecg',
  'previous_blood_tests',
  'previous_ultrasound',
  'previous_ct',
  'previous_mri',
  'previous_examinations'
]);

const BROAD_OPEN_IDS = new Set(['chief_complaint', 'open_history']);
const CONTEXTUAL_PATTERNS = [
  /\bwhen was that\b/,
  /\bwhen exactly\b/,
  /\bwhat reaction\b/,
  /\bwhat happens\b/,
  /\bfor environment or food\b/,
  /\bpollen\b/,
  /\bhow often\b/,
  /\bwhat dose\b/,
  /\bdid that help\b/,
  /\bwhat about before\b/,
  /\bopen or laparoscopic\b/,
  /\bwas it open\b/,
  /\blaparoscopic\b/
];

export function classifyResponseScope(questionAnalysis, detectedIntents, state) {
  const normalized = questionAnalysis.normalized || '';
  const intents = detectedIntents ?? [];

  if (!intents.length) {
    return makeScope('clarification', []);
  }

  if (isObjectiveRequest(intents)) {
    return makeScope('objective_exam_request', objectiveOnly(intents));
  }

  if (isBroadOpenHistory(normalized, intents)) {
    return makeScope('broad_open_history', preferIds(intents, ['chief_complaint', 'open_history']).slice(0, 1));
  }

  if (isContextualFollowup(normalized, state)) {
    return makeScope('contextual_followup', intents.slice(0, 1));
  }

  if (isExplicitMultiIntent(normalized, intents)) {
    const directIds = new Set(questionAnalysis.directIntentIds ?? []);
    const directIntents = intents.filter((intent) => directIds.has(intent.id));
    const answerIntents = directIntents.length >= 2 ? directIntents : intents;
    return makeScope('multi_intent_explicit', dedupeByCanonical(answerIntents).slice(0, 4));
  }

  return makeScope('single_intent', intents.slice(0, 1));
}

function makeScope(scope, answerIntents) {
  return {
    responseScope: scope,
    answerIntents
  };
}

function isObjectiveRequest(intents) {
  return intents.length > 0 && intents.every((intent) => OBJECTIVE_DOMAINS.has(intent.domain) || OBJECTIVE_IDS.has(intent.id));
}

function objectiveOnly(intents) {
  return intents.filter((intent) => OBJECTIVE_DOMAINS.has(intent.domain) || OBJECTIVE_IDS.has(intent.id));
}

function isBroadOpenHistory(normalized, intents) {
  if (!intents.some((intent) => BROAD_OPEN_IDS.has(intent.id))) return false;
  return /\b(what brought|why did you come|why are you here|what happened|what is wrong|how can i help|tell me about the problem|main problem)\b/.test(normalized);
}

function isContextualFollowup(normalized, state) {
  if (state.pendingClarificationIntent) return true;
  if (CONTEXTUAL_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  return Boolean(state.lastIntent) && /^(when|when exactly|what dose|how often|why|what reaction|pollen|for environment or food)$/.test(normalized);
}

function isExplicitMultiIntent(normalized, intents) {
  if (intents.length < 2) return false;
  if (!/\b(and|or)\b|,|\/|\+/.test(normalized)) return false;
  if (/\b(go away or better|nausea or vomiting|sharp.*dull.*burning|open or laparoscopic)\b/.test(normalized)) return false;
  const canonicalIds = intents.map((intent) => canonicalIntentFor(intent.id));
  const uniqueCanonical = new Set(canonicalIds);
  if (uniqueCanonical.size === 1) return false;
  return intents.filter((intent) => !BROAD_OPEN_IDS.has(intent.id)).length >= 2;
}

function preferIds(intents, ids) {
  const preferred = ids.flatMap((id) => intents.filter((intent) => intent.id === id));
  return preferred.length ? preferred : intents;
}

function dedupeByCanonical(intents) {
  const seen = new Set();
  return intents.filter((intent) => {
    const canonical = canonicalIntentFor(intent.id);
    if (seen.has(canonical)) return false;
    seen.add(canonical);
    return true;
  });
}

function canonicalIntentFor(intentId) {
  const aliases = {
    hpi_site: 'pain_site',
    hpi_onset: 'pain_onset',
    hpi_circumstances: 'pain_circumstances',
    hpi_character: 'pain_character',
    hpi_radiation: 'pain_radiation',
    hpi_severity: 'pain_severity',
    hpi_exacerbating: 'pain_exacerbating',
    hpi_relieving: 'pain_relieving',
    hpi_timing: 'pain_timing',
    hpi_course: 'pain_course',
    hpi_associated_symptoms: 'pain_associated_symptoms',
    medication_regular: 'medication',
    substance_smoking: 'smoking',
    substance_alcohol: 'alcohol',
    substance_drugs: 'recreational_drugs'
  };
  return aliases[intentId] ?? intentId;
}
