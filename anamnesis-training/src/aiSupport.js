import { ambiguousDrugQuestion, ambiguousFamilyQuestion, ambiguousDurationQuestion } from './dialogue/conversationSubjects.js';
import { buildApiUrl, resolveIntentWithAI } from '../../src/ai/client.js';
import { INTENTS } from './data/interviewSchema.js?v=pilot-9';
import { medicationSubject } from './dialogue/questionAnalysis.js?v=pilot-9';
import { normalize } from './patientEngine.js?v=pilot-9';

const MAX_RESCUES = 4;
const TURNS_PER_RESCUE = 20;
const MIN_TURNS_FOR_FIRST_PASS_RESCUE = 12;
const ACCEPT_CONFIDENCE = 0.9;
const QUESTION_FORM = /^(?:what|when|where|how|why|who|do|does|did|is|are|was|were|have|has|can|could|tell|any)\b/;
const commonWords = new Set('what when where how why who do does did is are was were have has can could tell any you your the and about with this that from please'.split(' '));

// Only broaden the candidate list when the words name a plausible clinical topic.
const RESCUE_SIGNALS = [
  [/\b(?:walking|walk)\b.*\b(?:distance|far|long)\b/, ['social_current_function', 'hpi_exacerbating']],
  [/\b(?:medical symptoms|problems|illness|diseases?)\b.*\b(?:in (?:the )?past|before this)\b/, ['pmh_chronic_diseases', 'hpi_previous_episodes']],
  [/\b(?:this|same|similar) (?:kind of )?(?:pain|symptoms?|problem)\b.*\b(?:before|previously|last time)\b/, ['hpi_previous_episodes', 'hpi_onset']],
  [/\b(?:character|describe)\b.*\b(?:pain|symptoms?|problems)\b/, ['hpi_character', 'chief_complaint']],
  [/\b(?:blood pressure|hypertension)\b.*\b(?:problems?|condition)\b|\b(?:cardiac|heart)\b.*\b(?:problems?|condition)\b/, ['pmh_cardiovascular_disease', 'pmh_chronic_diseases']],
  [/\b(?:family|parents|mother|mom|father|dad)\b.*\b(?:diseases?|health problems?)\b/, ['family_history', 'family_inherited']],
  [/\b(?:in hospital before|in (?:the )?hospital in the past|hospital stays?)\b/, ['pmh_hospitalizations', 'administrative_admission_time']],
  [/\b(?:eye|eyes|see|eyesight)\b.*\b(?:normally|difficulties|problems?)\b|\b(?:difficulties|problems)\b.*\b(?:eyes|eyesight)\b/, ['ros_vision']],
  [/\b(?:lost|lose)\b.*\bconsciousness\b/, ['ros_syncope']]
];

export function isAIAvailable() {
  if (typeof window === 'undefined' || window.ANAMNESIS_AI_ENABLED === false) return false;
  if (window.ANAMNESIS_AI_ENABLED === true) return true;
  return window.location.protocol === 'https:' && !['localhost', '127.0.0.1'].includes(window.location.hostname);
}

function questionKey(normalized) {
  return normalized.replace(/^(?:i mean|what i mean is|let me rephrase)\s+/, '').replace(/\bplease\b/g, '').replace(/\s+/g, ' ').trim();
}

function sharesSubject(a, b) {
  const words = new Set(a.split(' ').filter(word => word.length > 2 && !commonWords.has(word)));
  return b.split(' ').some(word => words.has(word));
}

function rescueOptions(engine, detection) {
  const evidence = engine.inferAttemptedIntents(detection.normalized, detection);
  const scoped = RESCUE_SIGNALS.filter(([pattern]) => pattern.test(detection.normalized)).flatMap(([, ids]) => ids);
  const options = new Set(scoped.length ? scoped : evidence);
  for (const candidate of detection.candidates.slice(0, 4)) {
    if (!scoped.length && candidate.score >= 0.48 && candidate.reasons?.some(reason => /^(phrase|token|fuzzy):/.test(reason))) options.add(candidate.id);
  }
  return [...options].filter(id => Object.hasOwn(INTENTS, id) && !['objective', 'identity', 'administrative'].includes(INTENTS[id].domain) && engine.answerFor(id) &&
    (!medicationSubject.test(detection.normalized) || INTENTS[id].domain === 'medication') &&
    (id !== 'allergy_reaction' || engine.lastMeaningfulDomain === 'allergy' ||
      /\b(?:allerg\w*|reaction|expos\w*)\b/.test(detection.normalized)));
}

export async function prepareQuestionWithAI(engine, question, onRescueReserved = () => {}) {
  const local = engine.detect(question);
  const state = engine.rescueState;
  const event = {
    deterministicIntentGuess: local.primaryIntent?.id ?? null,
    deterministicConfidence: local.confidence,
    aiAttempted: false, aiSucceeded: false, aiRescueUsed: false,
    aiSelectedIntent: null, aiConfidence: null, aiEndpoint: null, aiError: null,
    aiRequestCount: state.count,
    finalResolutionSource: local.parts ? 'local-compound' : local.contextUsed ? 'local-context' :
      local.directMappingUsed ? 'direct' : local.primaryIntent ? 'deterministic' : 'fallback',
    fallbackUsed: local.responseScope === 'clarification' || local.responseScope === 'terminology_not_understood'
  };
  const unchanged = { detection: local, event };
  if (!isAIAvailable() || local.primaryIntent || local.parts || local.responseScope !== 'clarification' ||
      local.analysis?.unresolvedReference || local.analysis?.differentSymptom) return unchanged;

  const key = questionKey(local.normalized);
  if (/\b(?:phone number|email|address|identification|patient id)\b/.test(key) ||
      ambiguousDrugQuestion.test(key) || ambiguousFamilyQuestion.test(key) || ambiguousDurationQuestion.test(key)) return unchanged;
  if (key.length < 12 || key.length > 240 || !QUESTION_FORM.test(key)) return unchanged;
  const options = rescueOptions(engine, local);
  const pending = engine.pendingClarification;
  const earlier = pending && questionKey(pending.question);
  const scope = /\b(?:it|that|this|they|them)\b/.test(key) ? engine.lastMeaningfulIntent ?? '' : '';
  const cached = state.accepted.find(item => item.keys.includes(key) && item.scope === scope && options.includes(item.intent));
  if (cached) return accept(cached.intent, cached.confidence, 'intent-rescue-cache');

  const repeated = Boolean(earlier && pending.createdAtTurn >= engine.turn - 1 && sharesSubject(earlier, key));
  const clearCandidate = local.candidates.some(candidate => options.includes(candidate.id) &&
    candidate.score >= 0.48 && candidate.reasons?.some(reason => /^(phrase|token|fuzzy):/.test(reason)));
  const knownTopic = RESCUE_SIGNALS.some(([pattern]) => pattern.test(key));
  const firstPass = engine.turn >= MIN_TURNS_FOR_FIRST_PASS_RESCUE && (knownTopic || clearCandidate);
  const allowance = Math.min(MAX_RESCUES, 1 + Math.floor(engine.turn / TURNS_PER_RESCUE));
  if ((!repeated && !firstPass) || !options.length || state.disabled || state.count >= allowance ||
      state.attempted.includes(key) || (repeated && state.attempted.includes(earlier))) return unchanged;

  const triedKeys = [...new Set(repeated ? [key, earlier] : [key])];
  state.attempted.push(...triedKeys);
  event.aiRequestCount = ++state.count;
  event.aiAttempted = true;
  event.aiEndpoint = buildApiUrl('/api/intent-rescue');
  const attribute = 'overview';
  const questionType = local.analysis?.type ?? 'open';
  try {
    onRescueReserved();
    const result = await resolveIntentWithAI(key,
      options.map(id => ({ id, description: INTENTS[id].title })), { requestedAttribute: attribute, questionType });
    event.aiSelectedIntent = options.includes(result.intent) ? result.intent : null;
    event.aiConfidence = typeof result.confidence === 'number' ? result.confidence : null;
    event.aiHttpStatus = result._http?.status ?? null;
    if (result.success === true && options.includes(result.intent) &&
        result.requestedAttribute === attribute && result.questionType === questionType &&
        Number.isFinite(result.confidence) && result.confidence >= ACCEPT_CONFIDENCE && result.confidence <= 1) {
      event.aiSucceeded = true;
      state.accepted.push({ keys: triedKeys, scope, intent: result.intent, confidence: result.confidence });
      return accept(result.intent, result.confidence, 'intent-rescue-ai');
    }
    event.aiError = 'Rescue suggestion did not pass local validation.';
  } catch (error) {
    state.disabled = true;
    event.aiHttpStatus = error.details?.status ?? null;
    event.aiError = 'Intent rescue unavailable for this session.';
  }
  return unchanged;

  function accept(intent, confidence, source) {
    const analysis = { ...local.analysis, intent, attribute: 'overview', target: null };
    event.aiSelectedIntent = intent;
    event.aiConfidence = confidence;
    event.finalResolutionSource = source;
    event.aiRescueUsed = true;
    event.fallbackUsed = false;
    return {
      detection: engine.detectionForResolvedIntent(question, intent, source, confidence, analysis),
      event
    };
  }
}

export function prepareAnonymousContribution(engine) {
  return {
    transcript: engine.transcript.map(({ role, text, intent }) => ({ role, text, intent })),
    score: engine.getScore(),
    scoreBreakdown: engine.getScoreBreakdown?.() ?? null,
    missedItems: engine.getMissedFeedback(),
    studentCoverage: engine.getStudentCoverage?.() ?? null,
    simulatorResolutionIssues: engine.getResolutionIssues?.() ?? [],
    debugIntentEvents: engine.debugTurns
  };
}
