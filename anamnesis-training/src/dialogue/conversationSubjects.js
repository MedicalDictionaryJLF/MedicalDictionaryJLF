import { PRESENTING_SYMPTOMS, MEDICATION_NAMES } from '../cases/conversationFacts.js';

const symptomLabels = {
  ros_chest_pain: 'chest pain', ros_back_pain: 'back pain', ros_headache: 'headache',
  ros_abdominal_pain: 'abdominal pain', ros_flank_pain: 'flank pain',
  ros_dyspnea: 'shortness of breath', ros_cough: 'cough', ros_dizziness: 'dizziness',
  ros_fever: 'fever', ros_nausea: 'nausea', ros_vomiting: 'vomiting',
  ros_palpitations: 'palpitations', ros_syncope: 'fainting', ros_edema: 'swelling'
};

const symptomAliases = {
  ros_chest_pain: /\bchest (?:pain|pressure|discomfort|tightness)\b/,
  ros_back_pain: /\b(?:back pain|pain in (?:your|the) back)\b/,
  ros_headache: /\b(?:headache|head pain|migraine)\b/,
  ros_abdominal_pain: /\b(?:abdominal|belly|stomach) pain\b/,
  ros_flank_pain: /\b(?:flank|loin|side) pain\b/,
  ros_dyspnea: /\b(?:shortness of breath|short of breath|breathlessness)\b/,
  ros_cough: /\bcough(?:ing)?\b/,
  ros_dizziness: /\b(?:dizziness|dizzy)\b/,
  ros_fever: /\bfever\b/,
  ros_nausea: /\bnausea\b/,
  ros_vomiting: /\bvomiting\b/,
  ros_palpitations: /\bpalpitations\b/,
  ros_syncope: /\b(?:fainting|fainted|passed out)\b/,
  ros_edema: /\b(?:ankle|leg) swelling\b/
};

export function symptomSubject(patient, intent, question = '') {
  const presenting = patient.presentingSymptom ?? PRESENTING_SYMPTOMS[patient.id];
  if (presenting && (intent === 'chief_complaint' || intent?.startsWith('hpi_') || presenting.aliases?.test(question))) {
    return { name: presenting.name, bodyArea: presenting.region, primary: true };
  }
  const name = patient.subjectAliases?.[intent]?.name ?? symptomLabels[intent];
  if (name) return { name, intent, primary: false };
  return null;
}

export function explicitSymptoms(patient, question) {
  const subjects = new Map();
  const add = subject => { if (subject) subjects.set(subject.primary ? 'primary' : subject.intent, subject); };
  const presenting = patient.presentingSymptom ?? PRESENTING_SYMPTOMS[patient.id];
  if (presenting?.aliases?.test(question)) add(symptomSubject(patient, 'chief_complaint'));
  for (const [id, pattern] of Object.entries(symptomAliases)) {
    const match = question.match(pattern)?.[0];
    if (match) add(symptomSubject(patient, id, match));
  }
  for (const [id, entry] of Object.entries(patient.subjectAliases ?? {})) {
    const match = entry.aliases?.find(alias => ` ${question} `.includes(` ${alias} `));
    if (match) add(symptomSubject(patient, id, match));
  }
  return [...subjects.values()];
}

export function medicationSubjectName(patient, question) {
  const names = new Set([...(patient.medicationFacts ?? []).map(item => item.name), ...MEDICATION_NAMES]);
  const matches = [...names].filter(name => ` ${question} `.includes(` ${name} `));
  return matches.length === 1 ? matches[0] : null;
}

export const ambiguousDrugQuestion = /^(?:(?:do|did) you (?:take (?:any )?drugs|(?:take|use) (?:any )?substances?)|drugs)$/;
export const ambiguousFamilyQuestion = /^(?:do you have (?:any )?(?:family(?: members)?|relatives)|and your family)$/;
export const ambiguousDurationQuestion = /^(?:and )?how long(?: is it| it is)?$/;

export function unavailableDetail(attribute, subject, intent) {
  if (intent === 'gyn_last_visit') return 'I don’t remember the date of my last gynaecology visit.';
  if (intent === 'ros_bowel_frequency') return 'I can’t say exactly how often I have a bowel movement.';
  if (intent === 'intake_last_meal') return 'I can describe my usual diet. I don’t have the details of my last meal.';
  if (intent === 'intake_recent_fluids') return 'I’m not sure how much I’ve had to drink today.';
  if (attribute === 'onset.time') return `I don’t remember exactly when ${subject ? `the ${subject.name}` : 'it'} started.`;
  if (attribute === 'onset.type') return 'I’m not sure whether it came on suddenly or gradually.';
  if (attribute === 'timing.duration') return 'I can’t say exactly how long it lasted.';
  if (attribute === 'timing.frequency') return 'I’m not sure how often it happens.';
  if (attribute.startsWith('medication.')) return 'I’m not sure about that detail of the medicine.';
  return subject ? `I don’t know that detail about the ${subject.name}.` : 'I’m not sure about that.';
}
