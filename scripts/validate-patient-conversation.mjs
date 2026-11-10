import { INTENTS, QUESTION_AREAS } from '../anamnesis-training/src/data/interviewSchema.js';
import { PATIENT_CASES } from '../anamnesis-training/src/cases/index.js';
import { getAuthoredCase } from '../anamnesis-training/src/cases/caseFactory.js';
import { CONVERSATION_FACTS } from '../anamnesis-training/src/cases/conversationFacts.js';
import { PatientEngine } from '../anamnesis-training/src/patientEngine.js';
import { FACT_STATE, retrieveFacts, validateConversationCase } from '../anamnesis-training/src/dialogue/clinicalFacts.js';
import { attributesByIntent } from '../anamnesis-training/src/dialogue/questionAnalysis.js';
import { realizeEnglish } from '../anamnesis-training/src/dialogue/responseTemplates.js';

const unansweredStates = new Set([FACT_STATE.UNKNOWN, FACT_STATE.NOT_AUTHORED]);
const authorableStates = new Set([FACT_STATE.PRESENT, FACT_STATE.ABSENT, FACT_STATE.UNKNOWN, FACT_STATE.NOT_APPLICABLE]);

const basicAreas = new Set(['identification', 'chief_complaint', 'hpi_socrates', 'past_medical_history',
  'allergies_transfusions', 'medication', 'family_history', 'social_history', 'substance_use', 'closure']);
const basicIntents = QUESTION_AREAS.filter(area => basicAreas.has(area.id)).flatMap(area => area.intents);
basicIntents.push('identity_dob', 'intake_height', 'intake_weight', 'intake_marital_status', 'intake_children', 'intake_contact_person',
  'intake_birthplace', 'intake_siblings', 'intake_diet', 'intake_sleep', 'hpi_previous_episodes');

const report = PATIENT_CASES.map(patient => {
  const authored = getAuthoredCase(patient);
  const errors = [];
  const curated = CONVERSATION_FACTS[patient.id] ?? {};
  const local = authored.conversationFacts ?? {};
  for (const intent of new Set([...Object.keys(curated), ...Object.keys(local)])) {
    if (!Object.hasOwn(INTENTS, intent)) {
      errors.push(`Unknown intent ${intent}`);
      continue;
    }
    for (const attribute of Object.keys({ ...curated[intent], ...local[intent] })) {
      for (const fact of retrieveFacts(patient, intent, attribute)) {
        if (!authorableStates.has(fact.state) ||
            (!unansweredStates.has(fact.state) && !realizeEnglish(fact))) {
          errors.push(`Invalid structured answer for ${fact.id} (${fact.state})`);
        }
      }
    }
  }

  if (authored.familyOverviewTopics !== undefined) {
    const topics = authored.familyOverviewTopics;
    if (!Array.isArray(topics) || new Set(topics).size !== topics.length) {
      errors.push('familyOverviewTopics must be an array of unique family intent IDs');
    } else {
      for (const intent of topics) {
        if (!INTENTS.family_history.relatedIntents.includes(intent) ||
            !retrieveFacts(patient, intent).some(fact => !unansweredStates.has(fact.state) && realizeEnglish(fact))) {
          errors.push(`Family overview points to a missing or invalid answer for ${intent}`);
        }
      }
    }
  }

  for (const [id, entry] of Object.entries(authored.subjectAliases ?? {})) {
    if (INTENTS[id]?.domain !== 'ros' || (typeof entry?.name !== 'string' || !entry.name.trim()) || !Array.isArray(entry.aliases) ||
        !entry.aliases.every(alias => typeof alias === 'string' && alias.trim() && alias === alias.toLowerCase())) {
      errors.push(`Invalid symptom aliases for ${id}`);
    }
  }
  const symptomFacets = new Set(Object.values(attributesByIntent).flat());
  for (const [id, facets] of Object.entries(authored.subjectHistory ?? {})) {
    if (INTENTS[id]?.domain !== 'ros' || !facets || typeof facets !== 'object' || Array.isArray(facets) ||
        !Object.entries(facets).every(([facet, reply]) => symptomFacets.has(facet) && typeof reply === 'string' && reply.trim())) {
      errors.push(`Invalid symptom-specific history for ${id}`);
    }
  }

  const engine = new PatientEngine(patient);
  const { essential, caseCritical, recommended, criticalSafety } = engine.getDebriefPriorities();
  const basicGaps = basicIntents.filter(intent =>
    !engine.answerFor(intent) && !retrieveFacts(patient, intent).some(fact => fact.state === FACT_STATE.UNKNOWN))
    .map(intent => ({ intent, paths: INTENTS[intent].answerKeys }));
  const gradedGaps = [...new Set([...essential, ...caseCritical, ...recommended, ...criticalSafety])]
    .filter(intent => !engine.answerFor(intent))
    .map(intent => ({ intent, critical: essential.includes(intent) || caseCritical.includes(intent) || criticalSafety.includes(intent),
      paths: INTENTS[intent].answerKeys }));
  return {
    caseId: patient.id,
    errors,
    basicGaps,
    gradedGaps,
    missingOrUnknown: validateConversationCase(patient, attributesByIntent),
    authoredOverviewFields: Object.keys(INTENTS).filter(intent =>
      retrieveFacts(patient, intent).some(fact => fact.state === FACT_STATE.NARRATIVE))
  };
});

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const item of report) {
    console.log(`${item.caseId}: ${item.errors.length} invalid answers, ${item.basicGaps.length}/${basicIntents.length} basic topics missing, ${item.gradedGaps.length} graded topics without an authored reply, ${item.missingOrUnknown.length} unavailable or unknown facts/facets`);
    for (const error of item.errors) console.error(`  ${error}`);
  }
  console.log('Use --json for exact intent, facet and source paths.');
}

if (report.some(item => item.errors.length || item.basicGaps.length)) process.exitCode = 1;
