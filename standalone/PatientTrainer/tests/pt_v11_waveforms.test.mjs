import assert from 'node:assert/strict';
import { buildMonitorProfile, sampleEcgAt, samplePlethAt, sampleRespAt } from '../src/monitorWaveforms.v11.js';

const profile = buildMonitorProfile({ monitorProfile: { rhythm:'sinus', hr:96, rr:20, stShiftMv:0.14 } }, { hr:96, rr:20 });
assert.equal(profile.rhythm, 'sinus');
assert.equal(profile.hr, 96);
const samples = Array.from({length:2000}, (_,i)=>sampleEcgAt(i/500, profile));
assert.ok(Math.max(...samples) > 0.7, 'sinus ECG must have a physiologic R wave');
assert.ok(Math.min(...samples) < -0.1, 'sinus ECG must include negative Q/S components');
const pleth = Array.from({length:1000}, (_,i)=>samplePlethAt(i/250, profile));
assert.ok(Math.max(...pleth)-Math.min(...pleth) > 0.3, 'pleth must be pulsatile');
const resp = Array.from({length:1000}, (_,i)=>sampleRespAt(i/100, profile));
assert.ok(Math.max(...resp)-Math.min(...resp) > 1.0, 'respiration waveform must vary with the respiratory cycle');
const af = buildMonitorProfile({ monitorProfile: { rhythm:'atrial_fibrillation', hr:120 } }, { hr:120, rr:18 });
assert.notEqual(sampleEcgAt(1.1, af), sampleEcgAt(1.2, af));
const vt = buildMonitorProfile({ monitorProfile: { rhythm:'ventricular_tachycardia', hr:160 } }, { hr:160, rr:18 });
assert.ok(Number.isFinite(sampleEcgAt(0.5, vt)));
console.log('PT-v11 waveform engine tests passed');
