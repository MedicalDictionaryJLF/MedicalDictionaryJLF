import assert from 'node:assert/strict';
import { PATIENT_CASES } from '../anamnesis-training/src/cases/index.js';
import {
  addDifferential,
  buildEncounterReport,
  createEncounterState,
  evaluateClosing,
  evaluateDifferential,
  evaluateExamination,
  getExaminationActions,
  performExamination
} from '../anamnesis-training/src/clinicalEncounter.js';

const chest = PATIENT_CASES.find((item) => item.id === 'chest_pain_acs_risk');
const abdomen = PATIENT_CASES.find((item) => item.id === 'abdominal_pain_cholecystitis');
assert.ok(chest && abdomen, 'Expected trainer cases are available');

function examine(patient, state, technique, siteId, options = {}) {
  return performExamination(patient, state, null, { caseId: patient.id, technique, siteId, environmentReady: true, ...options });
}
function completeExaminations(patient, state) {
  for (const action of getExaminationActions(patient, state).filter(item => item.required && item.assessed)) {
    for (const [technique, siteId] of action.steps) assert.ok(examine(patient, state, technique, siteId).ok);
  }
}

{
  const state = createEncounterState();
  const actions = getExaminationActions(chest, state);
  assert.ok(actions.length >= 4, 'Chest pain case exposes several examination actions');
  assert.equal(actions.some((item) => item.finding), false, 'Findings are hidden before examination');
  assert.equal(performExamination(chest, state, 'cardiovascular').ok, false, 'A generic button cannot complete an examination');
  assert.equal(examine(chest, state, 'auscultate', 'heart-aortic', { environmentReady: false }).ok, false);
  assert.equal(examine(chest, state, 'auscultate', 'heart-aortic', { caseId: abdomen.id }).ok, false);
  assert.equal(examine(chest, state, 'percuss', 'heart-aortic').ok, false);
  assert.equal(state.examActions.length, 0, 'Invalid and unavailable-environment actions are not recorded');
  assert.ok(examine(chest, state, 'auscultate', 'heart-aortic').ok);
  assert.equal(state.examined.includes('cardiovascular'), false);
  assert.equal(evaluateExamination(chest, state).percent, 0);
  assert.ok(examine(chest, state, 'auscultate', 'heart-aortic').record.repeated);
  assert.equal(evaluateExamination(chest, state).partial.find(item => item.label === 'Cardiac auscultation').completed, 1);
  completeExaminations(chest, state);
  assert.equal(evaluateExamination(chest, state).percent, 100, 'All required anatomical steps complete the examination');
}

{
  const state = createEncounterState();
  assert.equal(addDifferential(state, 'Acute coronary syndrome').ok, true);
  assert.equal(addDifferential(state, 'Pulmonary embolism').ok, true);
  assert.equal(addDifferential(state, 'Aortic dissection').ok, true);
  const reasoning = evaluateDifferential(chest, state, 'Inferior STEMI');
  assert.equal(reasoning.primaryMatched, true, 'Primary diagnosis aliases are recognised');
  assert.equal(reasoning.primaryRank, 1, 'Ranked board is preserved');
  assert.ok(reasoning.percent >= 90, 'Strong differential earns a strong local score');
}

{
  const state = createEncounterState();
  addDifferential(state, 'Acute cholecystitis');
  addDifferential(state, 'Biliary colic');
  addDifferential(state, 'Pancreatitis');
  assert.equal(examine(abdomen, state, 'palpate', 'abdomen-luq').record.documented, false);
  assert.match(examine(abdomen, state, 'palpate', 'abdomen-ruq').finding, /Right upper quadrant tenderness/);
  assert.doesNotMatch(state.examActions.at(-1).finding, /Murphy/);
  assert.match(examine(abdomen, state, 'palpate', 'murphy-ruq').finding, /Murphy/);
  completeExaminations(abdomen, state);
  const closingInput = {
    presentation: '43-year-old woman with right upper quadrant pain after a fatty meal with nausea, vomiting, fever and chills.',
    primaryDiagnosis: 'Acute cholecystitis',
    investigations: 'Request abdominal ultrasound, WBC and CRP plus liver tests and bilirubin.',
    management: 'Give analgesia and IV fluids and discuss urgently with the surgical senior regarding antibiotics and definitive care.'
  };
  const closing = evaluateClosing(abdomen, state, closingInput);
  assert.ok(closing.percent >= 85, 'Case-specific structured closing is recognised locally');
  const report = buildEncounterReport({ patientCase: abdomen, encounterState: state, interviewScore: 80, closingInput });
  assert.ok(report.encounterScore >= 80, 'Composite encounter score includes interview, examination, reasoning and closing');
  assert.equal(state.completed, true, 'Submitted encounter becomes complete');
}

{
  const state = createEncounterState();
  for (const name of ['A', 'B', 'C', 'D', 'E']) assert.equal(addDifferential(state, name).ok, true);
  assert.equal(addDifferential(state, 'F').ok, false, 'Differential board is capped at five diagnoses');
}

console.log('Patient Trainer Phase 1 tests: PASS');
