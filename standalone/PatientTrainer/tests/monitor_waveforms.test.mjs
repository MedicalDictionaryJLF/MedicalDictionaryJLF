import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildMonitorProfile,
  createLiveSignalState,
  advanceLiveSignals,
  sampleEcgAt,
  samplePlethAt,
  sampleRespAt,
  sampleCapnoAt,
  MONITOR_PRESETS
} from '../src/monitorWaveforms.js';

const stemi = buildMonitorProfile({
  id: 'chest_pain_acs_risk',
  monitorProfile: { rhythm:'sinus', displayLead:'II', hr:96, rr:20, stShiftMv:0.28, stShape:'plateau', respiratoryPattern:'spontaneous', respIrregularity:0.14 }
}, { hr:96, rr:20 });
assert.equal(stemi.displayLead, 'II');
assert.ok(stemi.stShiftMv >= 0.20);
assert.equal(stemi.respiratoryPattern, 'spontaneous');
const peterCaseProfile = buildMonitorProfile({ id:'chest_pain_acs_risk', monitorProfile:{ displayLead:'II', stShiftMv:0.18, stSlope:0.05 } }, { hr:96, rr:20 });
assert.ok(peterCaseProfile.stShiftMv >= 0.28, 'Peter inferior-STEMI lead II must retain clearly visible ST elevation even if an older case file supplies a smaller shift');

const samples = Array.from({length:2400}, (_,i)=>sampleEcgAt(i/600, stemi));
assert.ok(Math.max(...samples) > 0.7, 'lead II ECG must retain a clear R wave');
assert.ok(Math.min(...samples) < -0.1, 'lead II ECG must retain Q/S components');

const normal = buildMonitorProfile({ monitorProfile: { rhythm:'sinus', displayLead:'II', hr:96, rr:20, stShiftMv:0 } }, { hr:96, rr:20 });
const stSampleTime = 0.31;
assert.ok(sampleEcgAt(stSampleTime, stemi) > sampleEcgAt(stSampleTime, normal) + 0.08, 'inferior STEMI profile must visibly elevate lead-II ST segment');

const pleth = Array.from({length:1000}, (_,i)=>samplePlethAt(i/250, stemi));
assert.ok(Math.max(...pleth)-Math.min(...pleth) > 0.3, 'pleth must remain pulsatile');
const resp = Array.from({length:1600}, (_,i)=>sampleRespAt(i/100, stemi));
assert.ok(Math.max(...resp)-Math.min(...resp) > 1.0, 'spontaneous respiration must vary across the respiratory cycle');
const respMorph = buildMonitorProfile({ monitorProfile: { hr:80, rr:12, respiratoryPattern:'spontaneous', respIrregularity:0, inspiratoryFraction:0.22, expiratoryTau:3.4 } }, { hr:80, rr:12 });
const r0 = sampleRespAt(0.00, respMorph);
const rFast = sampleRespAt(0.55, respMorph);
const rPeak = sampleRespAt(1.10, respMorph);
const rLateExp = sampleRespAt(3.20, respMorph);
assert.ok((rFast - r0) > 0.55, 'spontaneous respiration must show a rapid inspiratory upstroke');
assert.ok(rLateExp < rPeak && rLateExp > r0 - 0.15, 'expiration must decay more slowly instead of mirroring inspiration');

const capnoProfile = buildMonitorProfile({ monitorProfile: { hr:80, rr:15, capnographyEnabled:true, etco2:4.8 } }, { hr:80, rr:15 });
const capno = Array.from({length:600}, (_,i)=>sampleCapnoAt(i/100, capnoProfile));
assert.ok(Math.max(...capno) > 0.8 && Math.min(...capno) <= 0.02, 'capnography sampler must generate expiratory plateau and inspiratory baseline');

const state = createLiveSignalState(stemi);
let sawBeat = false;
for (let i=0;i<360;i++) {
  const signal = advanceLiveSignals(state, 1/120, stemi, {hr:i < 180 ? 96 : 110, rr:20});
  sawBeat ||= Boolean(signal.beat);
  assert.ok(Number.isFinite(signal.ecg) && Number.isFinite(signal.pleth) && Number.isFinite(signal.resp));
  assert.ok(state.cardiacPhase >= 0 && state.cardiacPhase < 1);
}
assert.ok(sawBeat, 'live signal engine must expose beat events for monitor beeps');
assert.ok(MONITOR_PRESETS.inferior_stemi && MONITOR_PRESETS.atrial_fibrillation && MONITOR_PRESETS.asystole, 'monitor presets must support scenario-driven rhythm changes');

const monitorSource = fs.readFileSync(new URL('../src/vitalsMonitor.js', import.meta.url), 'utf8');
assert.ok(monitorSource.includes('stageEmbeddedMonitorUpdate'), 'monitor must separate staged controller state from displayed state');
assert.ok(monitorSource.includes('applyStagedMonitorUpdate'), 'staged settings must be explicitly applicable');
assert.ok(monitorSource.includes('updateEmbeddedMonitorPhysiology'), 'Patient Trainer must be able to update physiology live');
assert.ok(monitorSource.includes('SAMPLE_RATE = 250'), 'signal sampling must be independent of browser paint rate');
assert.ok(monitorSource.includes('SWEEP_SECONDS'), 'waveforms must use a persistent left-to-right sweep');
assert.ok(monitorSource.includes('ctx.clearRect(x, 0, wipe, height)'), 'only a narrow wipe band should be cleared at the sweep head');
assert.ok(monitorSource.includes('tryEnableMonitorSound'), 'monitor must attempt to start pulse sound when opened from the Monitor user gesture');
assert.ok(monitorSource.includes('playPulseTone'), 'monitor must generate a pulse-synchronous beep');
assert.ok(monitorSource.includes('Start NIBP'), 'NIBP must remain an interactive intermittent measurement');
assert.ok(monitorSource.includes('NIBP_SYS') && monitorSource.includes('NIBP_DIA'), 'NIBP must display systolic and diastolic pressure explicitly');
assert.ok(!monitorSource.includes('data-channel="art"'), 'standard ED monitor must not expose an invasive arterial-pressure channel');
assert.ok(monitorSource.includes("channelMarkup('ecg'"), 'monitor must use an ECG channel');
assert.ok(monitorSource.includes("channelMarkup('pleth'"), 'monitor must expose a pleth waveform channel');
console.log('PT-v13 ResusMonitor-style monitor logic tests passed');
