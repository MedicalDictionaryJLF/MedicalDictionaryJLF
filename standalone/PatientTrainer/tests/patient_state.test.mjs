import assert from 'node:assert/strict';
import { PatientStateEngine, derivePatientPresentation } from '../src/patientState.js';
import { peterNovak } from '../src/cases/peterNovak.js';
import { janaKovacova } from '../src/cases/janaKovacova.js';

const peter = new PatientStateEngine(peterNovak);
let state = peter.getSnapshot();
assert.equal(state.physiology.hr, 96, 'Peter baseline HR should come from case vitals');
assert.equal(state.physiology.sbp, 154, 'Peter systolic BP should be parsed from case vitals');
assert.equal(state.symptoms.pain, 7, 'Peter initial pain should come from simulation state');
assert.ok(state.visual.sweating > 0.5, 'Peter should initially look clammy');
assert.ok(derivePatientPresentation(state).includes('Marked distress'));

peter.connectEquipment('monitor');
state = peter.getSnapshot();
assert.equal(state.equipment.monitor, true);
assert.equal(state.equipment.telemetry, true);
assert.equal(state.equipment.bpCuff, true);
assert.equal(state.equipment.spo2Probe, true);

const aspirinBefore = peter.getSnapshot();
const aspirin = peter.applyClinicalAction('Administer an aspirin loading dose');
assert.equal(aspirin.matched, true);
assert.equal(peter.getSnapshot().physiology.sbp, aspirinBefore.physiology.sbp, 'Aspirin should not invent an immediate BP effect');

const beforeNitrate = peter.getSnapshot();
const nitrate = peter.applyClinicalAction('Administer sublingual nitrate after checking blood pressure and contraindications');
state = peter.getSnapshot();
assert.equal(nitrate.matched, true);
assert.equal(nitrate.effectId, 'nitrate');
assert.ok(state.symptoms.pain < beforeNitrate.symptoms.pain, 'Nitrate case response should ease pain');
assert.ok(state.physiology.sbp < beforeNitrate.physiology.sbp, 'Nitrate case response should trend BP down');
assert.ok(state.visual.sweating < beforeNitrate.visual.sweating, 'Visible clamminess should ease with symptom improvement');

const oxygen = peter.applyClinicalAction('Apply supplemental oxygen if hypoxaemia develops');
assert.equal(oxygen.matched, true);
assert.equal(peter.getSnapshot().equipment.oxygen, true);
assert.equal(peter.getSnapshot().physiology.spo2, 96, 'Normoxic Peter should not receive an invented SpO2 jump');

const jana = new PatientStateEngine(janaKovacova);
const janaBefore = jana.getSnapshot();
const analgesia = jana.applyClinicalAction('Administer appropriate analgesia');
const janaAfter = jana.getSnapshot();
assert.equal(analgesia.matched, true);
assert.ok(janaAfter.symptoms.pain < janaBefore.symptoms.pain);
assert.ok(janaAfter.symptoms.distress < janaBefore.symptoms.distress);

const fluids = jana.applyClinicalAction('Establish IV access and start fluids if clinically indicated');
assert.equal(fluids.matched, true);
assert.equal(jana.getSnapshot().equipment.ivAccess, true);
assert.equal(jana.getSnapshot().equipment.infusion, true);

console.log('patient_state.test.mjs: PASS');
