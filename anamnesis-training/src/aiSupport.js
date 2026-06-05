import { buildApiUrl, resolveContextWithAI, resolveIntentWithAI, rewritePatientAnswer } from '../../src/ai/client.js';
import { INTENTS } from './patientCase.js';

const AI_CONFIDENCE_THRESHOLD = 0.45;
const CONTEXTUAL_QUESTION = /\b(it|this|that|where exactly|when exactly|what type|what kind|what reaction)\b/i;

export function isAIAvailable() {
  if (window.ANAMNESIS_AI_ENABLED === false) return false;
  if (window.ANAMNESIS_AI_ENABLED === true) return true;
  return window.location.protocol === 'https:' && !['localhost', '127.0.0.1'].includes(window.location.hostname);
}

export async function prepareQuestionWithAI(engine, question) {
  const deterministic = engine.detect(question);
  const event = {
    studentQuestion: question,
    deterministicIntentGuess: deterministic.primaryIntent?.id || null,
    deterministicConfidence: deterministic.confidence || 0,
    aiAvailable: isAIAvailable(),
    aiAttempted: false,
    aiSucceeded: false,
    aiRescueUsed: false,
    aiSelectedIntent: null,
    aiConfidence: null,
    aiEndpoint: null,
    aiHttpStatus: null,
    aiContentType: null,
    aiError: null,
    finalResolutionSource: resolutionSourceFor(deterministic),
    resolvedIntent: deterministic.primaryIntent?.id || null,
    fallbackUsed: deterministic.responseScope === 'clarification',
    patientPhrasingUsed: false,
    errors: []
  };

  if (!event.aiAvailable || deterministic.responseScope === 'terminology_not_understood') {
    return { detection: deterministic, event };
  }

  let workingDetection = deterministic;
  if (CONTEXTUAL_QUESTION.test(question)) {
    event.aiAttempted = true;
    event.aiEndpoint = buildApiUrl('/api/context-resolve');
    try {
      const context = await resolveContextWithAI(question, recentConversation(engine), {
        lastMeaningfulIntent: engine.lastMeaningfulIntent,
        lastMeaningfulDomain: engine.lastMeaningfulDomain,
        activeSymptom: engine.currentSymptom
      }, intentOptions());
      event.aiSucceeded = true;
      event.aiSelectedIntent = context.intent || null;
      event.aiConfidence = context.confidence ?? null;
      event.aiHttpStatus = context._http?.status ?? null;
      event.aiContentType = context._http?.contentType ?? null;
      const resolvedIntent = validIntent(context.intent);
      workingDetection = resolvedIntent
        ? engine.detectionForResolvedIntent(question, resolvedIntent, 'Context resolver selected an existing deterministic intent.')
        : engine.detect(context.resolvedQuestion || question);
      if (resolvedIntent) {
        event.aiRescueUsed = true;
        event.finalResolutionSource = 'context-ai';
      }
    } catch (error) {
      event.aiError = error.message;
      event.aiHttpStatus = error.details?.status ?? null;
      event.aiContentType = error.details?.contentType ?? null;
      event.errors.push(`context-resolve: ${error.message}`);
    }
  }

  if (!workingDetection?.primaryIntent || workingDetection.confidence < AI_CONFIDENCE_THRESHOLD || workingDetection.responseScope === 'clarification') {
    event.aiAttempted = true;
    event.aiEndpoint = buildApiUrl('/api/intent-rescue');
    try {
      const rescue = await resolveIntentWithAI(question, intentOptions());
      event.aiSucceeded = true;
      event.aiSelectedIntent = rescue.intent || null;
      event.aiConfidence = rescue.confidence ?? null;
      event.aiHttpStatus = rescue._http?.status ?? null;
      event.aiContentType = rescue._http?.contentType ?? null;
      const resolvedIntent = validIntent(rescue.intent);
      if (resolvedIntent) {
        workingDetection = engine.detectionForResolvedIntent(question, resolvedIntent, 'Intent rescue selected an existing deterministic intent.');
        event.aiRescueUsed = true;
        event.finalResolutionSource = 'intent-rescue-ai';
      }
    } catch (error) {
      event.aiError = error.message;
      event.aiHttpStatus = error.details?.status ?? null;
      event.aiContentType = error.details?.contentType ?? null;
      event.errors.push(`intent-rescue: ${error.message}`);
    }
  }

  event.resolvedIntent = workingDetection?.primaryIntent?.id || null;
  event.fallbackUsed = workingDetection?.responseScope === 'clarification';
  if (!event.aiRescueUsed) event.finalResolutionSource = resolutionSourceFor(workingDetection || deterministic);
  return { detection: workingDetection || deterministic, event };
}

export async function phrasePatientReply(reply, event) {
  if (!isAIAvailable() || window.ANAMNESIS_PATIENT_PHRASING_ENABLED === false) return reply;
  try {
    const response = await rewritePatientAnswer(reply, 'patient');
    if (response.success && response.answer) {
      event.patientPhrasingUsed = true;
      return response.answer;
    }
  } catch (error) {
    event.aiError = error.message;
    event.aiHttpStatus = error.details?.status ?? null;
    event.aiContentType = error.details?.contentType ?? null;
    event.errors.push(`patient-phrasing: ${error.message}`);
  }
  return reply;
}

export function recordLearningEvent(event) {
  const entry = { ...event, recordedAt: new Date().toISOString() };
  console.info('anamnesis-learning-event', entry);
  if (!isAIAvailable()) return;
  fetch(buildApiUrl('/api/learning-events'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
    keepalive: true
  }).catch((error) => console.warn('Learning event upload failed:', error));
}

export function prepareAnonymousContribution(engine) {
  return {
    transcript: engine.transcript.map(({ role, text, intent }) => ({ role, text, intent })),
    score: engine.getScore(),
    missedItems: engine.getMissedFeedback(),
    debugIntentEvents: engine.debugTurns
  };
}

function recentConversation(engine) {
  return engine.transcript.slice(-8).map(({ role, text }) => ({
    role: role === 'patient' ? 'assistant' : 'user',
    text
  }));
}

function intentOptions() {
  return Object.entries(INTENTS).map(([id, intent]) => ({ id, description: intent.title }));
}

function validIntent(intent) {
  return typeof intent === 'string' && INTENTS[intent] ? intent : null;
}

function resolutionSourceFor(detection) {
  if (!detection?.primaryIntent || detection.responseScope === 'clarification') return 'fallback';
  if (detection.responseScope === 'terminology_not_understood') return 'fallback';
  return detection.directMappingUsed ? 'direct' : 'deterministic';
}
