import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PatientEngine } from '../src/patientEngine.js';
import { peterNovak as PETER_NOVAK_CASE } from '../src/cases/peterNovak.js';
import { derivePatientAffect } from '../src/interaction/patientAffect.js';

const engine = new PatientEngine(PETER_NOVAK_CASE);
const baseline = engine.rapport;
const respectful = engine.ask('Hello, my name is Daniel. I am a medical student. Is it okay if I ask you a few questions?');
assert.ok(respectful.rapport > baseline, 'introduction and permission should improve rapport');
assert.ok(respectful.rapportEvent?.factors?.some((item) => item.id === 'introduction'));
assert.ok(respectful.rapportEvent?.factors?.some((item) => item.id === 'permission'));

const afterRespect = engine.rapport;
const hostile = engine.ask('Hurry up and just answer me, idiot.');
assert.ok(hostile.rapport < afterRespect - 10, 'hostile wording should materially reduce rapport');
assert.ok(engine.rapportEvents.length >= 2, 'rapport events should be retained for later debrief/webcam fusion');
const beforeExternal = engine.rapport;
const webcamHook = engine.applyRapportSignal({ delta: 3, source: 'mediapipe', label: 'Future eye-contact signal' });
assert.equal(webcamHook.source, 'mediapipe');
assert.equal(engine.rapport, Math.min(100, beforeExternal + 3));

const affect = derivePatientAffect({
  reply: 'I was frightened when the pressure started.',
  studentInput: 'Take your time. Tell me what worries you most.',
  rapport: 86,
  snapshot: { symptoms: { pain: 6, distress: 0.7 }, visual: { consciousness: 'alert' } },
  casePersonality: PETER_NOVAK_CASE.personality
});
assert.equal(affect.emotion, 'anxious');
assert.ok(affect.gazeEngagement > 0.7);

const rendererSource = fs.readFileSync(new URL('../src/scene/patient3DRenderer.js', import.meta.url), 'utf8');
const avatarSource = fs.readFileSync(new URL('../src/avatarAnimator.js', import.meta.url), 'utf8');
const speechSource = fs.readFileSync(new URL('../src/speech.js', import.meta.url), 'utf8');
const mainSource = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

assert.ok(rendererSource.includes('createFaceRig'), '3D renderer should contain procedural facial rig');
assert.ok(rendererSource.includes('setSpeaking(active'), '3D renderer should expose speaking state');
assert.ok(rendererSource.includes("this.viewMode = mode === 'examination' ? 'examination' : 'encounter'"));
assert.ok(avatarSource.includes('setAvatarSpeaking'));
assert.ok(avatarSource.includes('setAvatarViewMode'));
assert.ok(speechSource.includes('utterance.onboundary'));
assert.ok(mainSource.includes('onStart: () => setAvatarSpeaking(true, reply)'));
assert.ok(mainSource.includes("setAvatarViewMode(target === 'examination' ? 'examination' : 'encounter')"));
assert.ok(styles.includes('body[data-patient-workspace="examination"] .patient-focus-window'));
assert.ok(!styles.includes('body[data-patient-workspace="examination"] .patient-focus-window,\nbody[data-patient-workspace="investigations"] .patient-rail'));

console.log('Patient affect, speech, examination-presence and rapport regression tests passed.');
