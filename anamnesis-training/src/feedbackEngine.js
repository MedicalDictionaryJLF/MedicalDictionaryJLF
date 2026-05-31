import { intentsById } from './data/intentDefinitions.js';
import { abruptPhrases, empathicPhrases, technicalTerms } from './data/synonymDictionary.js';
import { getCoverageMap } from './scoringEngine.js';
import { getIntentValue } from './responseGenerator.js';

const LEADING_PATTERNS = [
  'right',
  "isn't it",
  "aren't you",
  'it is not',
  'you do not',
  'surely',
  'obviously'
];

export function evaluateQuestionQuality(question, detection, patientCase, state) {
  const normalized = normalize(question);
  const words = normalized.split(' ').filter(Boolean);
  const tags = [];

  if (empathicPhrases.some((phrase) => normalized.includes(phrase))) tags.push('empathic');
  if (abruptPhrases.some((phrase) => normalized.includes(phrase))) tags.push('harsh');
  if (LEADING_PATTERNS.some((phrase) => normalized.includes(phrase)) || /right\s*$/.test(normalized)) tags.push('leading');
  if (technicalTerms.some((term) => normalized.includes(term))) tags.push('tooTechnical');
  if (isOpenQuestion(normalized)) tags.push('openEnded');
  if (isClosedQuestion(normalized)) tags.push('closed');
  if (words.length <= 3 && !['matched', 'weak_match'].includes(detection.kind)) tags.push('vague');
  if (detection.kind === 'ambiguous') tags.push('vague');
  if (detection.matchedIntents.some((intent) => state.coveredIntents.includes(intent.id))) tags.push('repeated');
  if (detection.matchedIntents.some((intent) => patientCase.requiredChecklist.includes(intent.id))) tags.push('medicallyImportant');
  if (isRelevant(detection, patientCase)) tags.push('relevant');

  return {
    tags,
    label: qualityLabel(tags, detection),
    note: qualityNote(tags, detection)
  };
}

export function updateRapportFromQuality(state, quality) {
  let delta = 0;
  if (quality.tags.includes('empathic')) delta += 0.05;
  if (quality.tags.includes('openEnded')) delta += 0.015;
  if (quality.tags.includes('harsh')) delta -= 0.12;
  if (quality.tags.includes('leading')) delta -= 0.03;
  if (quality.tags.includes('tooTechnical')) delta -= 0.02;
  state.rapport = clamp(state.rapport + delta, 0, 1);
  state.patientAnxiety = clamp(state.patientAnxiety - Math.max(delta, 0) * 0.5 + (delta < 0 ? Math.abs(delta) * 0.4 : 0), 0, 1);
}

export function generateAdaptiveHint(patientCase, state) {
  if (state.mode === 'exam') return 'Hints are hidden in Exam Mode. Finish the interview to see the final evaluation.';

  const coverage = getCoverageMap(patientCase, state);
  const hpi = coverage.find((item) => item.id === 'socrates');
  const missingRequired = patientCase.requiredChecklist.filter((intent) => !state.coveredIntents.includes(intent));
  const missedRedFlag = patientCase.redFlags.find((flag) =>
    !flag.triggerIntents.some((intent) => state.coveredIntents.includes(intent))
  );

  if (hpi && hpi.percent < 70 && state.coveredIntents.includes('chief_complaint')) {
    return 'You have not fully explored the main symptom yet.';
  }

  const medicationSafety = ['medication', 'allergies'].filter((intent) => missingRequired.includes(intent));
  if (medicationSafety.length) {
    return 'Medication and allergy safety have not both been assessed yet.';
  }

  if (missedRedFlag) {
    return 'Some important red flags remain unassessed.';
  }

  const nextRequired = missingRequired.slice(0, state.difficulty === 'beginner' ? 4 : 2);
  if (nextRequired.length) {
    return `Consider broadening the interview to: ${formatDomainList(nextRequired)}.`;
  }

  return 'Required areas are covered. Consider optional social, epidemiological, or functional details, then finish the interview.';
}

export function generateStructuredSummary(patientCase, state) {
  const section = (title, intents) => {
    const lines = intents
      .filter((intentId) => state.coveredIntents.includes(intentId))
      .map((intentId) => `${intentsById[intentId]?.label ?? intentId}: ${state.discoveredFacts[intentId] ?? getIntentValue(patientCase, intentId)}`)
      .filter((line) => !line.endsWith(': '));
    return `${title}\n${lines.length ? lines.join('\n') : 'Not assessed.'}`;
  };

  return [
    'Generated Anamnesis Summary',
    '',
    `Patient: ${patientCase.identity.age}-year-old ${patientCase.identity.sex.toLowerCase()}, ${patientCase.identity.name}.`,
    '',
    section('Chief Complaint:', ['chief_complaint', 'open_history']),
    '',
    section('History of Present Illness:', [
      'pain_site',
      'pain_onset',
      'pain_circumstances',
      'pain_character',
      'pain_radiation',
      'migration',
      'pain_associated_symptoms',
      'pain_timing',
      'pain_exacerbating',
      'pain_relieving',
      'pain_severity',
      'pain_course'
    ]),
    '',
    section('Review of Systems:', [
      'fever',
      'nausea_vomiting',
      'dyspnea',
      'cough',
      'sputum',
      'sputum_color',
      'hemoptysis',
      'palpitations',
      'syncope',
      'edema',
      'weight_loss',
      'appetite',
      'bowel_symptoms',
      'urinary_symptoms',
      'wheezing',
      'cyanosis',
      'confusion'
    ]),
    '',
    section('Past Medical History:', ['past_medical_history', 'past_cardiac_history', 'cardiovascular_risk_factors', 'known_copd_asthma', 'operations', 'hospitalizations']),
    '',
    section('Medication:', ['medication', 'inhaler_medication', 'oxygen_use']),
    '',
    section('Allergies and Transfusions:', ['allergies', 'transfusions']),
    '',
    section('Family History:', ['family_history']),
    '',
    section('Social History:', ['occupation', 'living_situation', 'smoking', 'alcohol', 'recreational_drugs']),
    '',
    section('Epidemiology:', ['travel', 'animal_exposure', 'vaccination']),
    '',
    section('Gynecological History:', ['gynecological_history', 'pregnancy_possibility'])
  ].join('\n');
}

export function generateFinalReport(patientCase, state, score) {
  const missedCritical = patientCase.requiredChecklist.filter((intent) => !state.coveredIntents.includes(intent));
  const strongAreas = score.categories.filter((category) => category.percent >= 80).map((category) => category.label);
  const weakAreas = score.categories.filter((category) => category.percent < 60).map((category) => category.label);
  const repeated = Object.entries(state.repeatedIntents)
    .filter(([, count]) => count > 0)
    .map(([intent, count]) => `${intentsById[intent]?.label ?? intent} (${count + 1} times)`);

  return {
    finalScore: score.percentage,
    scoreByDomain: Object.fromEntries(score.categories.map((category) => [category.label, category.percent])),
    strongAreas,
    weakAreas,
    missedCriticalQuestions: missedCritical.map((intent) => intentsById[intent]?.label ?? intent),
    repeatedUnhelpfulQuestions: repeated,
    redFlagsAssessed: score.assessedRedFlags.map((flag) => flag.label),
    redFlagsMissed: score.missedRedFlags.map((flag) => flag.label),
    suggestedNextQuestions: missedCritical.slice(0, 6).map((intent) => suggestionForIntent(intent)),
    generatedSummary: generateStructuredSummary(patientCase, state),
    hiddenDiagnosis: patientCase.hiddenDiagnosis,
    teachingExplanation: patientCase.teachingObjectives.join(' '),
    missedFacts: missedCritical.map((intent) => ({
      intent,
      label: intentsById[intent]?.label ?? intent,
      fact: getIntentValue(patientCase, intent)
    }))
  };
}

function suggestionForIntent(intentId) {
  const suggestions = {
    chief_complaint: 'What brought you to the hospital today?',
    pain_site: 'Where exactly is the pain or main symptom?',
    pain_onset: 'When did it start?',
    pain_character: 'How would you describe it?',
    pain_radiation: 'Does it spread anywhere?',
    migration: 'Did the pain move from one place to another?',
    pain_severity: 'How severe is it from 0 to 10?',
    dyspnea: 'Do you feel short of breath?',
    sweating: 'Did you sweat with the pain?',
    nausea_vomiting: 'Any nausea or vomiting?',
    fever: 'Have you had fever or chills?',
    cough: 'Are you coughing?',
    sputum: 'Are you bringing up phlegm?',
    sputum_color: 'What color is the phlegm?',
    wheezing: 'Do you hear wheezing?',
    smoking: 'Do you smoke, and how much?',
    medication: 'What medicines do you take regularly?',
    allergies: 'Do you have any allergies?',
    family_history: 'Does anyone in your family have heart disease or serious illness?'
  };
  return suggestions[intentId] ?? `Ask about ${intentsById[intentId]?.label?.toLowerCase() ?? intentId}.`;
}

function qualityLabel(tags, detection) {
  if (tags.includes('harsh')) return 'Abrupt phrasing';
  if (tags.includes('tooTechnical')) return 'Too technical for patient';
  if (tags.includes('leading')) return 'Leading question';
  if (tags.includes('vague')) return 'Vague question';
  if (tags.includes('repeated') && !(detection.answerIntents ?? detection.matchedIntents).some((intent) => !intent.alreadyCovered)) return 'Repeated area';
  if (detection.contextualIntent) return 'Useful follow-up';
  const domainLabel = labelForAnsweredDomain(detection);
  if (domainLabel) return domainLabel;
  if (detection.kind === 'weak_match') return 'Likely useful question';
  if (tags.includes('empathic')) return 'Empathic question';
  if (tags.includes('medicallyImportant')) return 'Good question';
  if (tags.includes('relevant')) return 'Relevant question';
  return 'Needs clarification';
}

function labelForAnsweredDomain(detection) {
  const intent = (detection.answerIntents ?? detection.matchedIntents)[0];
  if (!intent || !['matched', 'weak_match'].includes(detection.kind)) return '';
  const labels = {
    identification: 'Identification',
    administrative: 'Identification',
    medication: 'Medication history',
    allergies: 'Allergy history',
    pastMedicalHistory: 'Past medical history',
    socialHistory: 'Social history',
    familyHistory: 'Family history',
    substanceUse: 'Social history',
    hpi: 'Good question',
    symptoms: 'Relevant question',
    ros: 'Relevant question',
    vitals: 'Objective request',
    examination: 'Objective request',
    labs: 'Objective request',
    operations: 'Operation history',
    epidemiology: 'Epidemiological history',
    gynecology: 'Gynecological history',
    chiefComplaint: 'Good opening question',
    communication: 'Communication'
  };
  return labels[intent.domain] ?? '';
}

function qualityNote(tags, detection) {
  if (tags.includes('tooTechnical')) return 'Use patient-friendly language and avoid diagnostic jargon.';
  if (tags.includes('leading')) return 'Ask neutrally so the patient can describe the symptom in their own words.';
  if (tags.includes('vague')) return 'Name the symptom or body system you want to assess.';
  if (tags.includes('repeated')) return 'This area was already covered; move to missing red flags or safety questions.';
  if (detection.contextualIntent) return 'The engine resolved this as a context-dependent follow-up.';
  return '';
}

function formatIntentList(intentIds) {
  return intentIds.map((intent) => intentsById[intent]?.label ?? intent.replaceAll('_', ' ')).join(', ');
}

function formatDomainList(intentIds) {
  const domains = intentIds.map((intent) => domainLabel(intentsById[intent]?.domain ?? 'history'));
  return [...new Set(domains)].join(', ');
}

function domainLabel(domain) {
  const labels = {
    communication: 'communication',
    chiefComplaint: 'chief complaint',
    hpi: 'main symptom history',
    symptoms: 'review of systems',
    ros: 'review of systems',
    pastMedicalHistory: 'past medical history',
    specialistCare: 'specialist care',
    operations: 'operations or hospitalizations',
    allergies: 'allergies',
    medication: 'medication',
    gynecology: 'gynecological history',
    familyHistory: 'family history',
    epidemiology: 'epidemiological history',
    socialHistory: 'social history',
    substanceUse: 'substance use',
    vitals: 'vital signs',
    examination: 'examination',
    labs: 'labs',
    identification: 'identification',
    administrative: 'administrative details'
  };
  return labels[domain] ?? domain;
}

function isOpenQuestion(normalized) {
  return /^(what|how|when|where|can you tell|could you tell|tell me|describe)/.test(normalized);
}

function isClosedQuestion(normalized) {
  return /^(do|does|did|is|are|have|has|were|was|can|could)\b/.test(normalized);
}

function isRelevant(detection, patientCase) {
  return detection.matchedIntents.some((intent) =>
    patientCase.requiredChecklist.includes(intent.id) || patientCase.optionalChecklist.includes(intent.id)
  );
}

function normalize(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ').trim();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
