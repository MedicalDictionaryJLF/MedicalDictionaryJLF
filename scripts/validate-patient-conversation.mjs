import { INTENTS } from '../anamnesis-training/src/data/interviewSchema.js';
import { PATIENT_CASES } from '../anamnesis-training/src/cases/index.js';
import { getAuthoredCase } from '../anamnesis-training/src/cases/caseFactory.js';
import { CONVERSATION_FACTS } from '../anamnesis-training/src/cases/conversationFacts.js';
import { PatientEngine } from '../anamnesis-training/src/patientEngine.js';
import { FACT_STATE, retrieveFacts, validateConversationCase } from '../anamnesis-training/src/dialogue/clinicalFacts.js';
import { attributesByIntent } from '../anamnesis-training/src/dialogue/questionAnalysis.js';
import { realizeEnglish } from '../anamnesis-training/src/dialogue/responseTemplates.js';

const unansweredStates = new Set([FACT_STATE.UNKNOWN, FACT_STATE.NOT_AUTHORED]);
const authorableStates = new Set([FACT_STATE.PRESENT, FACT_STATE.ABSENT, FACT_STATE.UNKNOWN, FACT_STATE.NOT_APPLICABLE]);

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

  const engine = new PatientEngine(patient);
  const { essential, caseCritical, recommended, criticalSafety } = engine.getDebriefPriorities();
  const gradedGaps = [...new Set([...essential, ...caseCritical, ...recommended, ...criticalSafety])]
    .filter(intent => !engine.answerFor(intent))
    .map(intent => ({ intent, critical: essential.includes(intent) || caseCritical.includes(intent) || criticalSafety.includes(intent),
      paths: INTENTS[intent].answerKeys }));
  return {
    caseId: patient.id,
    errors,
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
    console.log(`${item.caseId}: ${item.errors.length} invalid answers, ${item.gradedGaps.length} graded topics without an authored reply, ${item.missingOrUnknown.length} unavailable or unknown facts/facets`);
    for (const error of item.errors) console.error(`  ${error}`);
  }
  console.log('Use --json for exact intent, facet and source paths.');
}

if (report.some(item => item.errors.length)) process.exitCode = 1;
