import assert from 'node:assert/strict';
import { PatientEngine, normalize } from '../src/patientEngine.js';
import { PATIENT_CASES } from '../src/cases/index.js';

const patientCase = PATIENT_CASES.find((item) => item.id === 'chest_pain_acs_risk');
assert(patientCase, 'Chest pain case must exist');

{
  const engine = new PatientEngine(patientCase, { mode: 'simulation' });
  const age = engine.ask('How old are you?');
  assert.equal(age.detectedIntent, 'identity_age');
  const dob = engine.ask('When exactly?');
  assert.equal(dob.detectedIntent, 'identity_dob');
  assert.match(dob.reply, /14 March 1968/i);
}

{
  const engine = new PatientEngine(patientCase, { mode: 'simulation' });
  engine.ask('Why did you come to the hospital?');
  const relieving = engine.ask('Did anything help ease the pain?');
  assert.equal(relieving.detectedIntent, 'hpi_relieving');
  assert.match(relieving.reply, /rest/i);
  const timing = engine.ask('for how long was the pain lasting');
  assert.equal(timing.detectedIntent, 'hpi_timing');
  assert.match(timing.reply, /30 minutes/i);
  assert.equal(engine.currentSymptom.sourceIntent, 'chief_complaint');
  assert.equal(engine.currentSymptom.rootSourceIntent, 'chief_complaint');
  assert.equal(engine.currentSymptom.lastPropertyIntent, 'hpi_timing');
}

{
  const engine = new PatientEngine(patientCase, { mode: 'simulation' });
  const question = 'Did anything help ease the pain?';
  const fakeClarification = engine.makeDetection({
    kind: 'uncertain',
    responseScope: 'clarification',
    normalized: normalize(question),
    tokens: ['did', 'anything', 'help', 'ease', 'pain'],
    phrases: [],
    primaryIntent: null,
    answerIntents: [],
    candidates: []
  });
  engine.ask(question, fakeClarification);
  assert(engine.attemptedIntents.has('hpi_relieving'), 'Relieving factors should be credited as attempted');
  assert(!engine.askedIntents.has('hpi_relieving'), 'A forced clarification must not become a discovered fact');
  const missedHpi = engine.getMissedFeedback().find((area) => area.title === 'HPI / SOCRATES');
  assert(!missedHpi?.missing.includes('hpi_relieving'), 'Attempted relieving factors must not be reported as a student omission');
  assert(engine.getResolutionIssues().some((issue) => issue.intentId === 'hpi_relieving'), 'Recognition failure should be logged separately');
}

{
  const engine = new PatientEngine(patientCase, { mode: 'simulation' });
  const result = engine.ask('Exacerbating factors');
  assert.equal(result.feedbackLabel, 'Use patient-facing wording');
  const communication = engine.getCommunicationAssessment();
  assert(communication.issues.some((issue) => issue.type === 'checklist_shorthand'));
}

{
  const engine = new PatientEngine(patientCase, { mode: 'simulation' });
  engine.ask('Why did you come to the hospital?');
  engine.ask('Where is the pain located?');
  const breakdown = engine.getScoreBreakdown();
  for (const key of ['overall', 'essential', 'caseCritical', 'comprehensive', 'communication', 'engineResolvedCoverage']) {
    assert(Number.isFinite(breakdown[key]), `Score breakdown must include numeric ${key}`);
  }
  const debug = engine.getDebugExport();
  assert.equal(debug.appVersion, '2.3.0-debrief-coverage');
  assert(Array.isArray(debug.studentCoverage));
  assert(Array.isArray(debug.simulatorResolutionIssues));
}

console.log('Debrief regression tests passed.');
