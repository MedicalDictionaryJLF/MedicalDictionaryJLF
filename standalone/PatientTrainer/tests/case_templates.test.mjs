import assert from 'node:assert/strict';
import { PATIENT_CASES } from '../src/cases/index.js';
import { PatientEngine } from '../src/patientEngine.js';
import { RESPONSE_TEMPLATES } from '../src/dialogue/responseTemplates.js';

const peter = PATIENT_CASES.find((item) => item.id === 'chest_pain_acs_risk');
const jana = PATIENT_CASES.find((item) => item.id === 'abdominal_pain_cholecystitis');

assert(peter && jana, 'Both current cases must be exported');
assert.equal(peter.identity.name, 'Peter Novak');
assert.equal(peter.identity.dob, '14 March 1968');
assert.equal(jana.identity.name, 'Jana Kovacova');
assert.equal(jana.identity.dob, '22 February 1983');

for (const patientCase of PATIENT_CASES) {
  assert(!/^My name is\b/i.test(String(patientCase.identity.name)), 'Case name must be a value, not a pre-written sentence');
  assert(!/^I am \d+ years old/i.test(String(patientCase.identity.age)), 'Case age must be a value, not a pre-written sentence');
  assert(!/^I was born on\b/i.test(String(patientCase.identity.dob)), 'Case DOB must be a value, not a pre-written sentence');
}

assert.equal(RESPONSE_TEMPLATES.identity_dob, 'I was born on {identity.dob}.');

const engine = new PatientEngine(peter, { mode: 'simulation' });
assert.equal(engine.ask('What is your name?').reply, 'My name is Peter Novak.');
assert.equal(engine.ask('How old are you?').reply, 'I am 58 years old.');
assert.equal(engine.ask('What is your date of birth?').reply, 'I was born on 14 March 1968.');
assert.equal(engine.ask('Where do you live?').reply, 'I live in Martin.');
assert.equal(engine.ask('What do you do for work?').reply, 'I work as a bus driver.');

console.log('Case/template architecture tests passed.');
