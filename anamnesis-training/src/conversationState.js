export function createConversationState(patientCase, options = {}, savedState = null) {
  if (savedState?.currentCaseId === patientCase.id) {
    return {
      ...baseState(patientCase, options),
      ...savedState,
      mode: options.mode ?? savedState.mode ?? 'practice',
      difficulty: options.difficulty ?? savedState.difficulty ?? 'intermediate'
    };
  }

  const state = baseState(patientCase, options);
  state.questionHistory.push({
    role: 'patient',
    text: patientCase.chiefComplaint.patientWords,
    intentIds: ['opening'],
    at: Date.now()
  });
  return state;
}

function baseState(patientCase, options) {
  const difficulty = options.difficulty ?? 'intermediate';
  return {
    currentCaseId: patientCase.id,
    currentTopic: null,
    currentSymptom: patientCase.hpi.mainSymptom,
    lastIntent: null,
    pendingClarificationIntent: null,
    lastAskedQuestion: '',
    coveredIntents: [],
    repeatedIntents: {},
    uncoveredRequiredIntents: [...patientCase.requiredChecklist],
    rapport: difficulty === 'beginner' ? 0.65 : difficulty === 'advanced' ? 0.45 : 0.5,
    patientAnxiety: patientCase.personality?.anxiety ?? 0.5,
    questionHistory: [],
    discoveredFacts: {},
    redFlagsAsked: [],
    redFlagsMissed: patientCase.redFlags?.map((flag) => flag.id) ?? [],
    differentialState: {},
    qualityEvents: [],
    debugTurns: [],
    mode: options.mode ?? 'practice',
    difficulty,
    turn: 0
  };
}

export function recordStudentQuestion(state, question, detection, quality) {
  state.turn += 1;
  state.lastAskedQuestion = question;
  state.questionHistory.push({
    role: 'student',
    text: question,
    intentIds: (detection.answerIntents ?? detection.matchedIntents).map((intent) => intent.id),
    quality,
    at: Date.now()
  });
}

export function recordPatientReply(state, reply, intentIds) {
  state.questionHistory.push({
    role: 'patient',
    text: reply,
    intentIds,
    at: Date.now()
  });
}

export function markIntentCovered(state, intentId, value) {
  const alreadyCovered = state.coveredIntents.includes(intentId);
  if (alreadyCovered) {
    state.repeatedIntents[intentId] = (state.repeatedIntents[intentId] ?? 0) + 1;
  } else {
    state.coveredIntents.push(intentId);
    state.repeatedIntents[intentId] = 0;
  }
  state.uncoveredRequiredIntents = state.uncoveredRequiredIntents.filter((id) => id !== intentId);
  if (value) state.discoveredFacts[intentId] = value;
}

export function updateTopicFromIntent(state, intentId) {
  if (!intentId) return;
  if (intentId === 'chief_complaint' || intentId.startsWith('pain_') || intentId.startsWith('hpi_') || intentId === 'migration') {
    state.currentTopic = 'pain';
    state.currentSymptom = state.currentSymptom || 'pain';
  }
  if (['dyspnea', 'cough', 'sputum', 'sputum_color', 'wheezing'].includes(intentId)) {
    state.currentTopic = 'respiratory';
    state.currentSymptom = 'breathing';
  }
  if (['smoking', 'alcohol', 'recreational_drugs', 'gynecological_history'].includes(intentId)) {
    state.currentTopic = 'sensitive';
  }
  state.lastIntent = intentId;
}

export function serializeConversationState(state) {
  return JSON.parse(JSON.stringify(state));
}
