import { INTENTS } from '../anamnesis-training/src/data/interviewSchema.js';
import { PATIENT_CASES } from '../anamnesis-training/src/cases/index.js';
import { FACT_STATE, retrieveFacts, validateConversationCase } from '../anamnesis-training/src/dialogue/clinicalFacts.js';
import { attributesByIntent } from '../anamnesis-training/src/dialogue/questionAnalysis.js';

const report = PATIENT_CASES.map(patient => ({
  caseId: patient.id,
  missingOrUnknown: validateConversationCase(patient, attributesByIntent),
  authoredOverviewFields: Object.keys(INTENTS).filter(intent =>
    retrieveFacts(patient, intent).some(fact => fact.state === FACT_STATE.NARRATIVE))
}));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const item of report) {
    console.log(`${item.caseId}: ${item.missingOrUnknown.length} unauthored or unknown facts/facets, ${item.authoredOverviewFields.length} authored overview fields`);
  }
  console.log('Use --json for exact intent, facet and source paths.');
}
