import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PatientEngine } from '../src/patientEngine.js';
import { peterNovak as PETER_NOVAK_CASE } from '../src/cases/peterNovak.js';
import { derivePatientAffect } from '../src/interaction/patientAffect.js';
import { Patient3DRenderer } from '../src/scene/patient3DRenderer.js';

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

const avatarSource = fs.readFileSync(new URL('../src/avatarAnimator.js', import.meta.url), 'utf8');
const speechSource = fs.readFileSync(new URL('../src/speech.js', import.meta.url), 'utf8');
const mainSource = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

// Verify the preserved public speech and framing contract without a GPU context.
const speechState = { speech: { active: false }, elapsed: 3, stopDemo() {} };
Patient3DRenderer.prototype.setSpeaking.call(speechState, true, 'I have chest discomfort.');
assert.equal(speechState.speech.active, true);
assert.equal(speechState.speech.text, 'I have chest discomfort.');
Patient3DRenderer.prototype.pulseSpeechBoundary.call(speechState, { charIndex: 7 });
assert.equal(speechState.speech.index, 7);
Patient3DRenderer.prototype.setSpeaking.call(speechState, false);
assert.equal(speechState.speech.active, false);
const framedViews = [];
const frameState = { focus: view => framedViews.push(view) };
Patient3DRenderer.prototype.setViewMode.call(frameState, 'examination');
Patient3DRenderer.prototype.setViewMode.call(frameState, 'encounter');
assert.deepEqual(framedViews, ['patient', 'face']);
assert.ok(avatarSource.includes('setAvatarSpeaking'));
assert.ok(avatarSource.includes('setAvatarViewMode'));
assert.ok(speechSource.includes('utterance.onboundary'));
assert.ok(mainSource.includes('onStart: () => setAvatarSpeaking(true, reply)'));
assert.ok(mainSource.includes("setAvatarViewMode(target === 'examination' ? 'examination' : 'encounter')"));
assert.ok(styles.includes('body[data-patient-workspace="examination"] .patient-focus-window'));
assert.ok(!styles.includes('body[data-patient-workspace="examination"] .patient-focus-window,\nbody[data-patient-workspace="investigations"] .patient-rail'));

console.log('Patient affect, speech, examination-presence and rapport regression tests passed.');
