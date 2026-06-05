import { intentsById } from './data/intentDefinitions.js';
import { layReplacements, responseTemplates } from './data/responseTemplates.js';

export function generatePatientReply({ patientCase, state, detection, quality }) {
  if (detection.kind === 'empty') return 'I did not catch a question. Could you ask me something specific?';
  if (detection.kind === 'ambiguous') return detection.clarification ?? pick(responseTemplates.uncertain);
  if (detection.kind === 'uncertain') return uncertainReply(patientCase, state, detection);

  const answerIntents = detection.answerIntents?.length ? detection.answerIntents : detection.matchedIntents;
  const allAnsweredIntentsCovered = answerIntents.length > 0 && answerIntents.every((intent) => state.coveredIntents.includes(intent.id));
  const answerParts = answerIntents
    .map((intent) => answerIntent(patientCase, state, intent.id, detection.normalized, { allowRepeatedPrefix: allAnsweredIntentsCovered }))
    .filter(Boolean);

  if (!answerParts.length) return uncertainReply(patientCase, state, detection);

  let reply = mergeAnswers(answerParts, patientCase, state);
  reply = applyPersonality(reply, patientCase, state, detection, quality);
  return reply;
}

export function answerIntent(patientCase, state, intentId, normalizedQuestion = '', options = {}) {
  const intent = intentsById[intentId];
  if (!intent) return '';

  const repeated = state.coveredIntents.includes(intentId);
  const rawValue = getIntentValue(patientCase, intentId);
  if (!rawValue) return fallbackForIntent(intentId);

  if (intent.sensitive && shouldGuardSensitiveAnswer(patientCase, state, intent, normalizedQuestion)) {
    return guardedAnswer(patientCase, state, intentId);
  }

  let answer = applyReliability(rawValue, patientCase, intentId);
  answer = applyHealthLiteracy(answer, patientCase);

  if (intentId === 'chief_complaint' || intentId === 'open_history') {
    answer = addSpontaneousDetails(answer, patientCase, state, intentId);
  }

  if (repeated && options.allowRepeatedPrefix !== false) {
    return pick(responseTemplates.repeated).replace('{answer}', lowercaseFirst(answer));
  }

  return answer;
}

export function getIntentValue(patientCase, intentId) {
  const structuredAnswer = answerStructuredIntent(patientCase, intentId);
  if (structuredAnswer) return structuredAnswer;

  if (intentId === 'introduction') {
    const { name, age, sex } = patientCase.identity;
    return `My name is ${name}. I am ${age} years old. I am ${sex.toLowerCase()}.`;
  }
  if (intentId === 'occupation') {
    return `I work as a ${patientCase.identity.occupation}.`;
  }
  if (intentId === 'living_situation') {
    return String(patientCase.identity.livingSituation)
      .replace(/^Lives\b/, 'I live')
      .replace(/\bhis\b/gi, 'my')
      .replace(/\bher\b/gi, 'my');
  }

  const intent = intentsById[intentId];
  if (!intent) return '';
  const values = (intent.answerPaths ?? [])
    .map((path) => getByPath(patientCase, path))
    .filter((value) => value !== undefined && value !== null && value !== '');
  return formatValue(values.length === 1 ? values[0] : values);
}

function answerStructuredIntent(patientCase, intentId) {
  const id = normalizeIntentAlias(intentId);
  const sex = patientCase.identity.sex;
  const city = patientCase.identity.residence || patientCase.identity.addressCity || cityFromCase(patientCase);
  const dob = patientCase.identity.dateOfBirth || approximateDob(patientCase.identity.age);
  const admissionTime = patientCase.administrative?.admissionTime || defaultAdmissionTime(patientCase);

  const patientAnswers = {
    greeting: 'Hello.',
    identity_name: `My name is ${patientCase.identity.name}.`,
    identity_age: `I am ${patientCase.identity.age} years old.`,
    identity_dob: `I was born ${dob}.`,
    identity_sex: `I am ${String(sex).toLowerCase()}.`,
    identity_residence: `I live in ${city}.`,
    identity_address: `I live in ${city}.`,
    administrative_admission_time: `I came to the hospital ${admissionTime}.`,
    administrative_arrival_method: patientCase.administrative?.arrivalMethod || patientCase.administrative?.arrivalMode || arrivalMode(patientCase),
    administrative_arrival_mode: patientCase.administrative?.arrivalMethod || patientCase.administrative?.arrivalMode || arrivalMode(patientCase),
    hpi_site: patientCase.hpi.site,
    hpi_onset: patientCase.hpi.onset,
    hpi_circumstances: patientCase.hpi.circumstances,
    hpi_character: patientCase.hpi.character,
    hpi_radiation: patientCase.hpi.radiation,
    hpi_severity: patientCase.hpi.severity,
    hpi_exacerbating: formatValue(patientCase.hpi.exacerbatingFactors),
    hpi_relieving: formatValue(patientCase.hpi.relievingFactors),
    hpi_timing: patientCase.hpi.timing,
    hpi_course: patientCase.hpi.course,
    hpi_associated_symptoms: patientCase.hpi.associatedSymptoms,
    headache: extractRos(patientCase, 'headNeck', 'No headache.'),
    dizziness: dizzinessAnswer(patientCase),
    visual_problems: extractRos(patientCase, 'headNeck', 'No visual problems.'),
    hearing_problems: 'My hearing is okay.',
    speech_problems: extractRos(patientCase, 'neurological', 'No speech problems.'),
    sore_throat: extractRos(patientCase, 'headNeck', 'No sore throat.'),
    fatigue: extractRos(patientCase, 'general', 'I feel tired.'),
    night_sweats: extractRos(patientCase, 'general', 'No night sweats.'),
    dysphagia: 'No difficulty swallowing.',
    abdominal_pain: patientCase.symptoms.chestPain?.startsWith('No') ? 'No abdominal pain.' : patientCase.ros.gastrointestinal,
    diarrhea: bowelSpecific(patientCase, 'diarrhea'),
    constipation: bowelSpecific(patientCase, 'constipation'),
    blood_in_stool: bowelSpecific(patientCase, 'blood in stool'),
    dysuria: patientCase.symptoms.urinarySymptoms,
    urinary_frequency: patientCase.symptoms.urinarySymptoms,
    nocturia: nocturiaAnswer(patientCase),
    incontinence: 'No incontinence.',
    pmh_chronic_diseases: patientCase.pastMedicalHistory.summary,
    pmh_hypertension: pmhSpecific(patientCase, 'high blood pressure', 'hypertension'),
    pmh_diabetes: pmhSpecific(patientCase, 'diabetes'),
    pmh_dyslipidemia: pmhSpecific(patientCase, 'cholesterol'),
    pmh_ischemic_heart_disease: patientCase.pastMedicalHistory.cardiac,
    pmh_cardiovascular_disease: cardiovascularHistoryAnswer(patientCase),
    pmh_previous_mi: cardiovascularHistoryAnswer(patientCase),
    pmh_angina: cardiovascularHistoryAnswer(patientCase),
    pmh_stent: cardiovascularHistoryAnswer(patientCase),
    pmh_bypass: cardiovascularHistoryAnswer(patientCase),
    pmh_arrhythmia: patientCase.caseType === 'chestPainACS' ? 'No known arrhythmia.' : 'No known arrhythmia that I know of.',
    pmh_heart_failure: 'No known heart failure.',
    pmh_kidney_disease: 'No known kidney disease.',
    pmh_lung_disease: patientCase.pastMedicalHistory.respiratory,
    pmh_thyroid: 'No known thyroid disease.',
    pmh_liver_disease: 'No known liver disease.',
    specialist_care: specialistAnswer(patientCase),
    planned_operation: 'No planned operation that I know of.',
    operation_date: operationDetail(patientCase, 'date'),
    operation_approach: operationDetail(patientCase, 'approach'),
    operation_complications: operationDetail(patientCase, 'complications'),
    previous_examinations: previousExamAnswer(patientCase),
    previous_ecg: previousSpecific('ECG', patientCase),
    previous_blood_tests: previousSpecific('blood tests', patientCase),
    previous_ultrasound: previousSpecific('ultrasound', patientCase),
    previous_ct: 'No CT scan recently that I remember.',
    previous_mri: 'No MRI that I remember.',
    allergy_reaction: allergyReaction(patientCase),
    allergy_environment_food: 'No food or environmental allergies that I know of.',
    allergy_pollen: 'No, I do not have a pollen allergy.',
    medication_regular: formatMedication(patientCase),
    medication_otc: medicationPart(patientCase, 'otc'),
    medication_supplements: medicationPart(patientCase, 'supplements'),
    medication_dose: formatMedication(patientCase),
    medication_frequency: formatMedication(patientCase),
    medication_indication: medicationIndication(patientCase),
    medication_adherence: patientCase.medication?.misuseHistory || 'I try to take them regularly, but I sometimes forget.',
    medication_nitroglycerin_current: 'No, I have not used nitroglycerin for this pain.',
    medication_nitroglycerin_previous: 'No, I have never used nitroglycerin before.',
    medication_antianginal: 'No regular medicine specifically for angina or chest pain.',
    gyn_menstruation: gynAnswer(patientCase, 'summary'),
    gyn_lmp: gynAnswer(patientCase, 'summary'),
    gyn_menopause: patientCase.identity.sex === 'Female' ? 'No menopause.' : 'That does not apply to me.',
    gyn_contraception: gynAnswer(patientCase, 'summary'),
    gyn_pregnancy: gynAnswer(patientCase, 'pregnancyPossibility'),
    gyn_children: gynAnswer(patientCase, 'summary'),
    gyn_deliveries: gynAnswer(patientCase, 'summary'),
    gyn_c_section: gynAnswer(patientCase, 'summary'),
    gyn_miscarriage: gynAnswer(patientCase, 'summary'),
    gyn_pelvic_pain: patientCase.identity.sex === 'Female' ? 'No separate pelvic pain apart from this problem.' : 'That does not apply to me.',
    family_parents: patientCase.familyHistory.summary,
    family_mother: patientCase.familyHistory.summary,
    family_father: patientCase.familyHistory.summary,
    family_cardiovascular: patientCase.familyHistory.summary,
    family_stroke: patientCase.familyHistory.summary,
    family_diabetes: patientCase.familyHistory.summary,
    family_cancer: patientCase.familyHistory.summary,
    family_genetic: 'No known genetic disease in the family.',
    epidemiology_travel: patientCase.epidemiology.travel,
    epidemiology_animals: patientCase.epidemiology.animals,
    epidemiology_covid_vaccination: patientCase.epidemiology.vaccination,
    epidemiology_covid_infection: 'I had COVID in the past, but not recently.',
    epidemiology_contact: 'No known infectious contact recently.',
    epidemiology_tick: 'No tick bite recently.',
    epidemiology_food: patientCase.epidemiology?.suspiciousFood || 'No suspicious food that I can think of.',
    social_employment: employmentAnswer(patientCase),
    social_occupation: `I work as a ${patientCase.identity.occupation}.`,
    social_marital_status: maritalAnswer(patientCase),
    social_living_situation: String(patientCase.socialHistory.living || patientCase.identity.livingSituation || 'I live at home.')
      .replace(/^Lives\b/, 'I live')
      .replace(/\bhis\b/gi, 'my')
      .replace(/\bher\b/gi, 'my'),
    social_housing: housingAnswer(patientCase),
    social_housing_floor: floorAnswer(patientCase),
    social_housing_elevator: elevatorAnswer(patientCase),
    substance_smoking: patientCase.substanceUse.smoking,
    substance_smoking_pack_years: patientCase.substanceUse.smoking,
    substance_alcohol: patientCase.substanceUse.alcohol,
    substance_coffee: patientCase.substanceUse.coffee || 'I drink coffee, but not excessively.',
    substance_black_tea: patientCase.substanceUse.blackTea || 'Only occasionally.',
    substance_caffeine: patientCase.substanceUse.caffeine || patientCase.substanceUse.coffee || 'No energy drinks.',
    substance_drugs: patientCase.substanceUse.recreationalDrugs
  };

  if (patientAnswers[id]) return patientAnswers[id];
  if (id.startsWith('vital_')) return objectiveAnswer(patientCase, 'vitalSigns', id);
  if (id.startsWith('exam_')) return objectiveAnswer(patientCase, 'localExamination', id) || objectiveAnswer(patientCase, 'generalExamination', id);
  if (id.startsWith('lab_')) return labAnswer(patientCase, id);
  return '';
}

function normalizeIntentAlias(intentId) {
  const aliases = {
    pain_site: 'hpi_site',
    pain_onset: 'hpi_onset',
    pain_circumstances: 'hpi_circumstances',
    pain_character: 'hpi_character',
    pain_radiation: 'hpi_radiation',
    pain_severity: 'hpi_severity',
    pain_exacerbating: 'hpi_exacerbating',
    pain_relieving: 'hpi_relieving',
    pain_timing: 'hpi_timing',
    pain_course: 'hpi_course',
    pain_associated_symptoms: 'hpi_associated_symptoms',
    medication: 'medication_regular',
    smoking: 'substance_smoking',
    alcohol: 'substance_alcohol',
    recreational_drugs: 'substance_drugs',
    travel: 'epidemiology_travel',
    animal_exposure: 'epidemiology_animals',
    vaccination: 'epidemiology_covid_vaccination',
    gynecological_history: 'gyn_menstruation',
    pregnancy_possibility: 'gyn_pregnancy',
    known_copd_asthma: 'pmh_lung_disease',
    past_medical_history: 'pmh_chronic_diseases',
    operations: 'operations',
    hospitalizations: 'hospitalizations'
  };
  return aliases[intentId] ?? intentId;
}

function addSpontaneousDetails(answer, patientCase, state, intentId) {
  const details = patientCase.chiefComplaint.spontaneousDetails ?? [];
  const disclosureLevel = patientCase.disclosureRules?.spontaneousDisclosureLevel ?? 1;
  const difficultyPenalty = state.difficulty === 'advanced' ? 1 : 0;
  const talkativeBoost = (patientCase.personality?.talkativeness ?? 0.5) > 0.7 ? 1 : 0;
  const allowed = Math.max(0, disclosureLevel + talkativeBoost - difficultyPenalty);

  if (intentId === 'chief_complaint') {
    return answer;
  }
  return [answer, ...details.slice(0, allowed)].join(' ');
}

function uncertainReply(patientCase, state, detection) {
  if (detection.kind === 'weak_match' && detection.bestIntent) {
    const answer = answerIntent(patientCase, state, detection.bestIntent.id, detection.normalized);
    if (answer) return answer;
  }
  if (state.currentSymptom === 'pain') return 'I am not sure what you mean. Could you ask that another way?';
  if (patientCase.hpi.mainSymptom.toLowerCase().includes('breath')) {
    return 'I am not sure if you mean my breathing or something else. Could you ask that another way?';
  }
  return pick(responseTemplates.uncertain);
}

function shouldGuardSensitiveAnswer(patientCase, state, intent, normalizedQuestion) {
  const guardedness = patientCase.personality?.guardedness ?? 0.3;
  const rapport = state.rapport;
  const firstTime = !state.coveredIntents.includes(intent.id);
  const direct = isDirectSensitiveQuestion(intent.id, normalizedQuestion);

  if (intent.requiresDirectQuestion && !direct) return true;
  if (!patientCase.disclosureRules?.sensitiveTopicsRequireRapport) return false;
  if (!firstTime) return false;
  return guardedness > 0.35 && rapport < 0.68 && !direct;
}

function guardedAnswer(patientCase, state, intentId) {
  if (intentId === 'alcohol' && patientCase.disclosureRules?.alcoholRequiresFollowUp) {
    return 'Only occasionally.';
  }
  if (intentId === 'recreational_drugs') {
    return 'No, nothing like that.';
  }
  if (intentId === 'gynecological_history' || intentId === 'pregnancy_possibility') {
    return 'My periods are usually normal, but I can answer more directly if you need something specific.';
  }
  return pick(responseTemplates.guardedSensitive);
}

function isDirectSensitiveQuestion(intentId, normalizedQuestion) {
  const directTerms = {
    smoking: ['smoke', 'cigarette', 'tobacco'],
    alcohol: ['alcohol', 'beer', 'wine', 'spirits', 'how much do you drink'],
    recreational_drugs: ['recreational drugs', 'street drugs', 'cocaine', 'cannabis', 'marijuana', 'use drugs'],
    gynecological_history: ['period', 'pregnant', 'pregnancy', 'contraception', 'vaginal'],
    pregnancy_possibility: ['pregnant', 'pregnancy', 'missed period']
  };
  return (directTerms[intentId] ?? []).some((term) => normalizedQuestion.includes(term));
}

function applyReliability(answer, patientCase, intentId) {
  const reliability = patientCase.reliability ?? {};
  let score = reliability.symptomDescription ?? 0.8;

  if (intentId.includes('onset') || intentId.includes('timing')) score = reliability.timeRecall ?? score;
  if (intentId === 'medication' || intentId === 'inhaler_medication') score = reliability.medicationRecall ?? score;
  if (['smoking', 'alcohol', 'recreational_drugs'].includes(intentId)) score = reliability.substanceUseHonesty ?? score;

  if (score >= 0.7) return answer;
  return pick(responseTemplates.lowReliability).replace('{answer}', lowercaseFirst(answer));
}

function applyHealthLiteracy(answer, patientCase) {
  if ((patientCase.personality?.healthLiteracy ?? 0.5) >= 0.55) return answer;
  return Object.entries(layReplacements).reduce((current, [technical, lay]) => {
    const regex = new RegExp(technical, 'gi');
    return current.replace(regex, lay);
  }, answer);
}

function mergeAnswers(parts, patientCase, state) {
  const unique = [...new Set(parts.map((part) => String(part).trim()).filter(Boolean))];
  if (unique.length === 1) return unique[0];
  return unique
    .map((answer, index) => (index === 0 ? answer : pick(responseTemplates.transition).replace('{answer}', lowercaseFirst(answer))))
    .join(' ');
}

function applyPersonality(reply, patientCase, state, detection, quality) {
  const personality = patientCase.personality ?? {};
  let styled = reply;

  if ((personality.talkativeness ?? 0.5) < 0.35 && detection.matchedIntents.length === 1) {
    styled = styled.split('. ').slice(0, 2).join('. ');
    if (!styled.endsWith('.')) styled += '.';
  }

  const answerIntents = detection.answerIntents?.length ? detection.answerIntents : detection.matchedIntents;
  if ((personality.anxiety ?? 0.5) > 0.65 && state.turn < 5 && answerIntents.some((intent) => ['chief_complaint', 'dyspnea', 'pain_severity', 'hpi_severity'].includes(intent.id))) {
    styled = `${styled} ${pick(responseTemplates.anxiousAdditions)}`;
  }

  if (quality.tags.includes('empathic') && (personality.cooperativeness ?? 0.5) > 0.65) {
    styled = `${pick(responseTemplates.openingAcknowledgement)} ${styled}`;
  }

  return styled;
}

function fallbackForIntent(intentId) {
  if (intentId === 'introduction') return 'Yes, you can ask me questions. My name and basic details are on the chart.';
  return '';
}

function cityFromCase(patientCase) {
  const living = patientCase.identity.livingSituation || '';
  if (patientCase.id === 'chestPainACS') return 'Martin';
  if (patientCase.id === 'abdominalPainAppendicitis') return 'Zilina';
  if (patientCase.id === 'dyspneaCOPD') return 'the same town as my daughter';
  return living.replace(/^Lives?\s+(with .*?\s+)?in\s+/i, '').replace(/\.$/, '') || 'my town';
}

function approximateDob(age) {
  if (!age) return 'I do not remember the exact date right now';
  return `about ${new Date().getFullYear() - Number(age)}`;
}

function defaultAdmissionTime(patientCase) {
  if (patientCase.caseType === 'chestPainACS') return 'earlier today, about two hours after the pain started';
  if (patientCase.caseType === 'appendicitis') return 'this morning because the pain got worse';
  if (patientCase.caseType === 'copdExacerbation') return 'today because my breathing was getting worse';
  return 'today';
}

function arrivalMode(patientCase) {
  if (patientCase.caseType === 'chestPainACS') return 'My wife brought me here by car.';
  if (patientCase.caseType === 'appendicitis') return 'A friend brought me by car.';
  if (patientCase.caseType === 'copdExacerbation') return 'My daughter brought me here.';
  return 'I came to the hospital with help from family.';
}

function extractRos(patientCase, section, fallback) {
  return patientCase.ros?.[section] || fallback;
}

function dizzinessAnswer(patientCase) {
  if (patientCase.caseType === 'chestPainACS') return 'I felt slightly dizzy during the pain.';
  return 'No dizziness.';
}

function bowelSpecific(patientCase, topic) {
  const answer = patientCase.symptoms.bowelSymptoms || patientCase.ros.gastrointestinal || '';
  if (topic === 'diarrhea' && /no diarrhea/i.test(answer)) return 'No diarrhea.';
  if (topic === 'constipation' && /constipation/i.test(answer)) return answer.includes('No') ? 'No constipation.' : answer;
  if (topic === 'blood in stool' && /blood/i.test(answer)) return answer;
  return answer || 'No bowel problems.';
}

function nocturiaAnswer(patientCase) {
  return patientCase.caseType === 'chestPainACS' ? 'I wake once at night to urinate.' : 'No, I do not wake often at night to urinate.';
}

function pmhSpecific(patientCase, ...needles) {
  const summary = `${patientCase.pastMedicalHistory.summary} ${patientCase.pastMedicalHistory.cardiovascularRisk ?? ''} ${patientCase.pastMedicalHistory.respiratory ?? ''}`;
  return needles.some((needle) => summary.toLowerCase().includes(needle.toLowerCase()))
    ? summary
    : `No known ${needles[0]}.`;
}

function cardiovascularHistoryAnswer(patientCase) {
  if (patientCase.caseType === 'chestPainACS') {
    return 'I have high blood pressure and high cholesterol. I have never had a heart attack, stent, or bypass.';
  }
  return patientCase.pastMedicalHistory?.cardiac || 'No known heart disease, heart attack, stent, or bypass.';
}

function specialistAnswer(patientCase) {
  if (patientCase.caseType === 'chestPainACS') return 'I mainly see my general practitioner, not a regular cardiologist.';
  if (patientCase.caseType === 'copdExacerbation') return 'I have seen a lung doctor before, but not very regularly.';
  return 'No regular specialist follow-up.';
}

function operationDetail(patientCase, detail) {
  const item = Array.isArray(patientCase.operationsHospitalizations?.details)
    ? patientCase.operationsHospitalizations.details[0]
    : null;
  if (!item) {
    if (detail === 'date') return 'I do not remember the exact date.';
    if (detail === 'approach') return 'I am not sure whether it was open or laparoscopic.';
    return 'No complications that I know of.';
  }
  if (detail === 'date') return item.exactDateKnown ? item.approximateDate : `I do not remember exactly. It was ${item.approximateDate}.`;
  if (detail === 'approach') return item.approach === 'unknown'
    ? 'I am not sure whether it was open or laparoscopic. I was young.'
    : `It was ${item.approach}.`;
  return item.complications ? `There were ${item.complications}.` : 'No complications that I know of.';
}

function previousExamAnswer(patientCase) {
  if (patientCase.caseType === 'chestPainACS') return 'I had blood tests last year and an ECG maybe two years ago.';
  if (patientCase.caseType === 'appendicitis') return 'I do not remember any recent tests before today.';
  return 'I had lung tests before when they diagnosed COPD.';
}

function previousSpecific(test, patientCase) {
  const text = previousExamAnswer(patientCase);
  return text.toLowerCase().includes(test.toLowerCase()) ? text : `No previous ${test} that I remember.`;
}

function allergyReaction(patientCase) {
  const text = formatValue(patientCase.allergies);
  if (/rash|swollen/i.test(text)) return text;
  if (/no known/i.test(text)) return 'I have not had any allergic reaction that I know of.';
  return text;
}

function formatMedication(patientCase) {
  return formatValue(patientCase.medication);
}

function medicationPart(patientCase, part) {
  const text = formatMedication(patientCase);
  if (part === 'supplements') return /supplement|vitamin|herbal/i.test(text) ? text : 'No supplements, vitamins, or herbal products.';
  return /ibuprofen|paracetamol|over the counter|otc/i.test(text) ? text : 'No regular over-the-counter drugs.';
}

function medicationIndication(patientCase) {
  if (patientCase.caseType === 'chestPainACS') return 'The ramipril is for blood pressure and atorvastatin is for cholesterol.';
  if (patientCase.caseType === 'copdExacerbation') return 'The inhalers are for COPD, ramipril is for blood pressure, and omeprazole is for reflux.';
  return 'I do not take regular prescribed medication.';
}

function gynAnswer(patientCase, key) {
  if (patientCase.identity.sex !== 'Female') return 'That does not apply to me.';
  return patientCase.gynecologicalHistory?.[key] || patientCase.gynecologicalHistory?.summary || 'Nothing unusual gynecologically.';
}

function employmentAnswer(patientCase) {
  if (/retired/i.test(patientCase.identity.occupation)) return 'I am retired.';
  return `I work as a ${patientCase.identity.occupation}.`;
}

function maritalAnswer(patientCase) {
  const living = `${patientCase.identity.livingSituation} ${patientCase.socialHistory?.living ?? ''}`;
  if (/wife|husband|married/i.test(living)) return 'I am married.';
  if (/roommate/i.test(living)) return 'I am single and live with roommates.';
  if (/daughter/i.test(living)) return 'I live with my daughter.';
  return 'My marital situation is not very relevant to this problem.';
}

function housingAnswer(patientCase) {
  const living = patientCase.identity.livingSituation || patientCase.socialHistory?.living || '';
  if (/apartment/i.test(living)) return 'I live in an apartment.';
  if (/house/i.test(living)) return 'I live in a house.';
  return living || 'I have stable housing.';
}

function floorAnswer(patientCase) {
  const living = patientCase.identity.livingSituation || '';
  if (/third-floor|third floor/i.test(living)) return 'I live on the third floor.';
  if (/ground-floor|ground floor/i.test(living)) return 'I live on the ground floor.';
  return 'There are no important stairs at home.';
}

function elevatorAnswer(patientCase) {
  const living = patientCase.identity.livingSituation || '';
  if (/elevator/i.test(living)) return 'Yes, there is an elevator.';
  return 'No elevator is needed where I live.';
}

function objectiveAnswer(patientCase, section, intentId) {
  const defaults = objectiveDefaults(patientCase);
  return patientCase[section]?.[intentId] || defaults[intentId] || '';
}

function labAnswer(patientCase, intentId) {
  const defaults = objectiveDefaults(patientCase);
  return patientCase.labs?.[intentId] || defaults[intentId] || 'That lab value is not available in this case.';
}

function objectiveDefaults(patientCase) {
  const common = {
    vital_weight: 'Weight is approximately 84 kg.',
    vital_height: 'Height is approximately 176 cm.',
    vital_bmi: 'BMI is approximately 27.',
    exam_consciousness: 'On examination, the patient is conscious and responsive.',
    exam_orientation: 'The patient is oriented to person, place, and time.',
    exam_hydration: 'Mucosa are moist; no marked dehydration.',
    exam_nutrition: 'Nutrition status is average.',
    exam_gait: 'Gait is not formally assessed in bed.',
    exam_speech: 'Speech is clear.',
    exam_skin: 'No major rash is seen.',
    exam_edema: patientCase.symptoms.edema || 'No peripheral edema.',
    exam_lymph_nodes: 'No enlarged cervical lymph nodes.',
    exam_thyroid: 'Thyroid is not enlarged.',
    exam_jvp: 'JVP is not visibly elevated.',
    exam_carotids: 'Carotid pulses are palpable without obvious bruit.',
    exam_palpation: 'There is no significant tenderness on palpation.',
    exam_guarding: 'There is no guarding.',
    exam_bowel_sounds: 'Bowel sounds are present.',
    exam_blumberg: 'Blumberg sign is negative.',
    exam_murphy: 'Murphy sign is negative.',
    exam_mcburney: 'McBurney point is not tender.',
    exam_rovsing: 'Rovsing sign is negative.',
    exam_tapotement: 'Renal tapotement is negative.',
    exam_pulses: 'Peripheral pulses are palpable.',
    exam_capillary_refill: 'Capillary refill is under 2 seconds.',
    exam_spine: 'No acute spinal abnormality is noted.',
    lab_hb: 'Hemoglobin is within the reference range.',
    lab_rbc: 'RBC count is within the reference range.',
    lab_hct: 'Hematocrit is within the reference range.',
    lab_platelets: 'Platelets are within the reference range.',
    lab_creatinine: 'Creatinine is within the reference range.',
    lab_urea: 'Urea is within the reference range.',
    lab_sodium: 'Sodium is within the reference range.',
    lab_potassium: 'Potassium is within the reference range.',
    lab_chloride: 'Chloride is within the reference range.',
    lab_calcium: 'Calcium is within the reference range.',
    lab_alt: 'ALT is within the reference range.',
    lab_ast: 'AST is within the reference range.',
    lab_bilirubin: 'Bilirubin is within the reference range.',
    lab_glucose: 'Glucose is mildly elevated or not yet available depending on bedside testing.',
    lab_cholesterol: 'Cholesterol history is known, but acute lipid results are not available.',
    lab_ldl: 'LDL is not available in this acute case.',
    lab_hdl: 'HDL is not available in this acute case.',
    lab_triglycerides: 'Triglycerides are not available in this acute case.',
    lab_tsh: 'TSH is not available in this acute case.',
    lab_troponin: 'Troponin is not available in this case.'
  };

  if (patientCase.caseType === 'chestPainACS') {
    return {
      ...common,
      vital_temperature: 'Temperature is 36.8 C.',
      vital_spo2: 'SpO2 is 96% on room air.',
      vital_hr: 'Heart rate is 96 per minute.',
      vital_rr: 'Respiratory rate is 18 per minute.',
      vital_bp: 'Blood pressure is 155/95 mmHg.',
      exam_general_appearance: 'On examination, he looks anxious and uncomfortable.',
      exam_lungs: 'Lungs are clear on auscultation.',
      exam_crackles: 'No crackles are heard.',
      exam_wheezing: 'No wheezing is heard.',
      exam_heart_sounds: 'Heart sounds S1 and S2 are present.',
      exam_murmur: 'No obvious murmur is heard.',
      exam_rhythm: 'Rhythm is regular.',
      exam_abdomen: 'Abdomen is soft and non-tender.',
      lab_wbc: 'WBC is within the reference range.',
      lab_crp: 'CRP is not significantly elevated.',
      lab_troponin: 'Troponin is elevated in the first available result.'
    };
  }

  if (patientCase.caseType === 'appendicitis') {
    return {
      ...common,
      vital_temperature: 'Temperature is 38.1 C.',
      vital_spo2: 'SpO2 is 98% on room air.',
      vital_hr: 'Heart rate is 104 per minute.',
      vital_rr: 'Respiratory rate is 18 per minute.',
      vital_bp: 'Blood pressure is 118/76 mmHg.',
      exam_general_appearance: 'She looks uncomfortable and prefers lying still.',
      exam_abdomen: 'The abdomen is tender in the right lower quadrant.',
      exam_palpation: 'Palpation shows right lower quadrant tenderness.',
      exam_guarding: 'There is mild guarding in the right lower abdomen.',
      exam_bowel_sounds: 'Bowel sounds are present but reduced.',
      exam_blumberg: 'Blumberg sign is positive in the right lower quadrant.',
      exam_murphy: 'Murphy sign is negative.',
      exam_mcburney: 'McBurney point is tender.',
      exam_rovsing: 'Rovsing sign is mildly positive.',
      exam_tapotement: 'Renal tapotement is negative.',
      lab_wbc: 'WBC is elevated at about 14 x 10^9/L.',
      lab_crp: 'CRP is elevated at about 55 mg/L.'
    };
  }

  return {
    ...common,
    vital_temperature: 'Temperature is 37.9 C.',
    vital_spo2: 'SpO2 is 89% on room air.',
    vital_hr: 'Heart rate is 108 per minute.',
    vital_rr: 'Respiratory rate is 26 per minute.',
    vital_bp: 'Blood pressure is 145/85 mmHg.',
    exam_general_appearance: 'He looks dyspneic and speaks in short phrases.',
    exam_skin: 'There is mild peripheral cyanosis.',
    exam_lungs: 'On examination, the lungs have diffuse wheezing with prolonged expiration.',
    exam_crackles: 'No focal crackles are dominant.',
    exam_wheezing: 'Diffuse expiratory wheezing is present.',
    exam_heart_sounds: 'Heart sounds are present but somewhat difficult to hear over wheezing.',
    exam_murmur: 'No clear murmur is heard.',
    exam_rhythm: 'Rhythm is regular and fast.',
    lab_wbc: 'WBC is mildly elevated.',
    lab_crp: 'CRP is mildly elevated.'
  };
}

function formatValue(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => Array.isArray(item) ? item : [item]).map(formatValue).filter(Boolean).join(' ');
  }
  if (typeof value === 'object') {
    return Object.values(value).map(formatValue).filter(Boolean).join(' ');
  }
  return String(value);
}

function getByPath(object, path) {
  return path.split('.').reduce((current, key) => current?.[key], object);
}

function lowercaseFirst(value) {
  const text = String(value);
  if (text.startsWith('I ') || text.startsWith("I'm") || text.startsWith('I do') || text.startsWith('I have')) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function pick(items) {
  return items[Math.floor(Math.random() * items.length)];
}
