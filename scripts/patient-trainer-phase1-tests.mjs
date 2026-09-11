import assert from 'node:assert/strict';
import { PATIENT_CASES } from '../anamnesis-training/src/patientCase.js';
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

{
  const state = createEncounterState();
  const actions = getExaminationActions(chest, state);
  assert.ok(actions.length >= 4, 'Chest pain case exposes several examination actions');
  assert.equal(actions.some((item) => item.finding), false, 'Findings are hidden before examination');
  assert.equal(performExamination(chest, state, 'cardiovascular').ok, true);
  assert.match(state.examFindings.cardiovascular, /heart/i);
  assert.ok(evaluateExamination(chest, state).percent < 100, 'Partial examination is not treated as complete');
  performExamination(chest, state, 'general');
  performExamination(chest, state, 'perfusion');
  performExamination(chest, state, 'pulses');
  performExamination(chest, state, 'respiratory');
  assert.equal(evaluateExamination(chest, state).percent, 100, 'Required chest examination actions can be completed');
}

{
  const state = createEncounterState();
  assert.equal(addDifferential(state, 'Acute coronary syndrome').ok, true);
  assert.equal(addDifferential(state, 'Pulmonary embolism').ok, true);
  assert.equal(addDifferential(state, 'Aortic dissection').ok, true);
  const reasoning = evaluateDifferential(chest, state, 'NSTEMI');
  assert.equal(reasoning.primaryMatched, true, 'Primary diagnosis aliases are recognised');
  assert.equal(reasoning.primaryRank, 1, 'Ranked board is preserved');
  assert.ok(reasoning.percent >= 90, 'Strong differential earns a strong local score');
}

{
  const state = createEncounterState();
  addDifferential(state, 'Acute cholecystitis');
  addDifferential(state, 'Biliary colic');
  addDifferential(state, 'Pancreatitis');
  performExamination(abdomen, state, 'general');
  performExamination(abdomen, state, 'abdomen');
  performExamination(abdomen, state, 'bowelSounds');
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
