import { buildApiUrl, resolveIntentWithAI } from '../../src/ai/client.js';
import { INTENTS } from './data/interviewSchema.js?v=134';
import { medicationSubject, sleepQuestion } from './dialogue/questionAnalysis.js?v=pilot-1';
import { normalize } from './patientEngine.js?v=pilot-1';

const MAX_RESCUES = 2;
const ACCEPT_CONFIDENCE = 0.9;
const QUESTION_FORM = /^(?:what|when|where|how|why|who|do|does|did|is|are|was|were|have|has|can|could|tell|any)\b/;
const commonWords = new Set('what when where how why who do does did is are was were have has can could tell any you your the and about with this that from please'.split(' '));

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
  const options = new Set(evidence);
  for (const candidate of detection.candidates.slice(0, 4)) {
    if (candidate.score >= 0.48 && candidate.reasons?.some(reason => /^(phrase|token|fuzzy):/.test(reason))) options.add(candidate.id);
  }
  return [...options].filter(id => Object.hasOwn(INTENTS, id) && INTENTS[id].domain !== 'objective' &&
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
      sleepQuestion.test(local.normalized) || local.analysis?.unresolvedReference || local.analysis?.differentSymptom) return unchanged;

  const key = questionKey(local.normalized);
  if (key.length < 12 || key.length > 240 || !QUESTION_FORM.test(key)) return unchanged;
  const options = rescueOptions(engine, local);
  const pending = engine.pendingClarification;
  const earlier = pending && questionKey(pending.question);
  const scope = /\b(?:it|that|this|they|them)\b/.test(key) ? engine.lastMeaningfulIntent ?? '' : '';
  const cached = state.accepted.find(item => item.keys.includes(key) && item.scope === scope && options.includes(item.intent));
  if (cached) return accept(cached.intent, cached.confidence, 'intent-rescue-cache');

  if (!earlier || pending.createdAtTurn !== engine.turn || !sharesSubject(earlier, key) ||
      !options.length || state.disabled || state.count >= MAX_RESCUES ||
      state.attempted.includes(key) || state.attempted.includes(earlier)) return unchanged;

  state.attempted.push(...new Set([key, earlier]));
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
      state.accepted.push({ keys: [...new Set([key, earlier])], scope, intent: result.intent, confidence: result.confidence });
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
    const analysis = { ...local.analysis, intent, attribute: 'overview' };
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
