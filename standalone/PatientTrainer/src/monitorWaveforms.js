const TAU = Math.PI * 2;

/**
 * Monitor waveform presets are intentionally data, not UI.  The Patient
 * Trainer can switch a running monitor to one of these profiles without
 * remounting it, mirroring the controller/display separation used by
 * simulation monitors such as ResusMonitor.
 */
export const MONITOR_PRESETS = Object.freeze({
  sinus: { rhythm: 'sinus', qrsMs: 90, prMs: 160, stShiftMv: 0, pvcEvery: 0 },
  sinus_bradycardia: { rhythm: 'sinus', hr: 45, qrsMs: 92, prMs: 170, stShiftMv: 0 },
  sinus_tachycardia: { rhythm: 'sinus', hr: 125, qrsMs: 86, prMs: 135, stShiftMv: 0 },
  inferior_stemi: { rhythm: 'sinus', displayLead: 'II', stShiftMv: 0.28, stShape: 'plateau', stSlope: 0.08, tAmplitude: 0.34 },
  atrial_fibrillation: { rhythm: 'atrial_fibrillation', afIrregularity: 0.25, pAmplitude: 0 },
  ventricular_tachycardia: { rhythm: 'ventricular_tachycardia', hr: 165, qrsMs: 160 },
  asystole: { rhythm: 'asystole', hr: 0, pAmplitude: 0, rAmplitude: 0, tAmplitude: 0 },
  spontaneous_breathing: { respiratoryPattern: 'spontaneous', respIrregularity: 0.16, respiratoryAmplitude: 1, inspiratoryFraction: 0.22, expiratoryTau: 3.4 },
  ventilated: { respiratoryPattern: 'ventilator', respIrregularity: 0, respiratoryAmplitude: 1 },
  apnoea: { respiratoryPattern: 'apnoea', rr: 0 },
  capnography: { capnographyEnabled: true, etco2: 4.8, capnoPattern: 'normal' }
});

export function buildMonitorProfile(patientCase, vitals) {
  const supplied = patientCase?.monitorProfile || {};
  const hr = Number(supplied.hr ?? vitals?.hr ?? 80);
  const rr = Number(supplied.rr ?? vitals?.rr ?? 16);
  const inferredInferiorStemi = patientCase?.id === 'chest_pain_acs_risk' || /inferior\s+stemi/i.test(String(patientCase?.ecg?.label || ''));
  return {
    rhythm: supplied.rhythm || 'sinus',
    displayLead: supplied.displayLead || 'II',
    hr,
    rr,
    qrsMs: Number(supplied.qrsMs ?? 92),
    prMs: Number(supplied.prMs ?? 160),
    qtMs: Number(supplied.qtMs ?? 390),
    pAmplitude: Number(supplied.pAmplitude ?? 0.13),
    rAmplitude: Number(supplied.rAmplitude ?? 1.0),
    tAmplitude: Number(supplied.tAmplitude ?? 0.30),
    stShiftMv: inferredInferiorStemi ? Math.max(Number(supplied.stShiftMv ?? 0), 0.28) : Number(supplied.stShiftMv ?? 0),
    stSlope: inferredInferiorStemi ? Math.max(Number(supplied.stSlope ?? 0), 0.07) : Number(supplied.stSlope ?? 0),
    stShape: supplied.stShape || 'plateau',
    perfusionIndex: Number(supplied.perfusionIndex ?? 2.2),
    respiratoryPattern: supplied.respiratoryPattern || 'spontaneous',
    respiratoryAmplitude: Number(supplied.respiratoryAmplitude ?? 1),
    respIrregularity: Number(supplied.respIrregularity ?? 0.16),
    inspiratoryFraction: Number(supplied.inspiratoryFraction ?? 0.22),
    expiratoryTau: Number(supplied.expiratoryTau ?? 3.4),
    sighEvery: Number(supplied.sighEvery ?? 9),
    pulseTransitSec: Number(supplied.pulseTransitSec ?? 0.18),
    noise: Number(supplied.noise ?? 0.0035),
    baselineWander: Number(supplied.baselineWander ?? 0.012),
    pvcEvery: Number(supplied.pvcEvery ?? 0),
    afIrregularity: Number(supplied.afIrregularity ?? 0.20),
    capnographyEnabled: Boolean(supplied.capnographyEnabled ?? false),
    etco2: Number(supplied.etco2 ?? 4.8),
    capnoPattern: supplied.capnoPattern || 'normal',
    invasiveBpEnabled: Boolean(supplied.invasiveBpEnabled ?? false),
    arterialPulsePressureScale: Number(supplied.arterialPulsePressureScale ?? 1)
  };
}

export function applyPresetToProfile(profile, presetName, overrides = {}) {
  const preset = MONITOR_PRESETS[presetName] || {};
  Object.assign(profile, preset, overrides);
  return profile;
}

/**
 * Stateful signal engine. Cardiac and respiratory phase are retained when
 * target values change, so the visible past is never regenerated.
 */
export function createLiveSignalState(profile = {}) {
  return {
    elapsed: 0,
    cardiacPhase: 0,
    respiratoryPhase: 0,
    beatIndex: 0,
    breathIndex: 0,
    beatRateFactor: 1,
    breathRateFactor: 1,
    breathAmplitudeFactor: 1,
    previous: { ecg: 0, pleth: 0, resp: 0, capno: 0, art: 0 },
    lastHr: Number(profile.hr || 80),
    lastRr: Number(profile.rr || 16),
    lastBeatAt: -Infinity,
    lastBreathAt: -Infinity
  };
}

export function advanceLiveSignals(state, dtSec, profile, inputs = {}) {
  const dt = clamp(Number(dtSec || 0), 0, 0.12);
  state.elapsed += dt;

  const targetHr = clamp(Number(inputs.hr ?? profile.hr ?? state.lastHr ?? 80), 0, 250);
  const targetRr = clamp(Number(inputs.rr ?? profile.rr ?? state.lastRr ?? 16), 0, 60);
  // Smooth physiological drivers; numeric updates must not deform the already
  // drawn trace or cause a phase reset.
  state.lastHr += (targetHr - state.lastHr) * Math.min(1, dt * 2.2);
  state.lastRr += (targetRr - state.lastRr) * Math.min(1, dt * 1.25);

  let beat = false;
  let breath = false;

  if (profile.rhythm !== 'asystole' && state.lastHr > 1) {
    const cardiacHz = (state.lastHr / 60) * Math.max(0.35, state.beatRateFactor);
    state.cardiacPhase += dt * cardiacHz;
    while (state.cardiacPhase >= 1) {
      state.cardiacPhase -= 1;
      state.beatIndex += 1;
      beat = true;
      state.lastBeatAt = state.elapsed;
      if (profile.rhythm === 'atrial_fibrillation') {
        state.beatRateFactor = clamp(1 + profile.afIrregularity * pseudoNoise(state.beatIndex * 9.71), 0.52, 1.62);
      } else {
        state.beatRateFactor = 1;
      }
    }
  }

  const respPattern = profile.respiratoryPattern || 'spontaneous';
  if (respPattern !== 'apnoea' && state.lastRr > 0.5) {
    const respiratoryHz = (state.lastRr / 60) * Math.max(0.35, state.breathRateFactor);
    state.respiratoryPhase += dt * respiratoryHz;
    while (state.respiratoryPhase >= 1) {
      state.respiratoryPhase -= 1;
      state.breathIndex += 1;
      breath = true;
      state.lastBreathAt = state.elapsed;
      const irregularity = (respPattern === 'regular' || respPattern === 'ventilator') ? 0.01 : profile.respIrregularity;
      state.breathRateFactor = clamp(1 + irregularity * pseudoNoise(state.breathIndex * 5.31 + 0.9), 0.64, 1.38);
      const ampJitter = (respPattern === 'regular' || respPattern === 'ventilator') ? 0.015 : 0.18;
      state.breathAmplitudeFactor = clamp(1 + ampJitter * pseudoNoise(state.breathIndex * 7.83 + 2.1), 0.67, 1.52);
      if (profile.sighEvery > 0 && state.breathIndex > 0 && state.breathIndex % profile.sighEvery === 0 && respPattern !== 'ventilator') {
        state.breathAmplitudeFactor = 1.62;
        state.breathRateFactor *= 0.80;
      }
    }
  }

  const values = {
    ecg: liveEcgValue(state, profile),
    pleth: livePlethValue(state, profile),
    resp: liveRespValue(state, profile),
    capno: liveCapnoValue(state, profile),
    art: liveArterialValue(state, profile, inputs),
    beat,
    breath
  };
  state.previous = values;
  return values;
}

function liveEcgValue(state, profile) {
  if (profile.rhythm === 'asystole') return baselineNoise(state.elapsed, profile) * 0.22;
  if (profile.rhythm === 'ventricular_tachycardia') return ventricularTachycardiaPhase(state.cardiacPhase, profile) + baselineNoise(state.elapsed, profile);
  if (profile.rhythm === 'atrial_fibrillation') return atrialFibrillationPhase(state.cardiacPhase, profile, state.elapsed) + baselineNoise(state.elapsed, profile);

  const isPvc = profile.pvcEvery > 0 && state.beatIndex > 0 && state.beatIndex % profile.pvcEvery === 0;
  if (isPvc) return pvcPhase(state.cardiacPhase) + baselineNoise(state.elapsed, profile);
  return sinusMorphologyByPhase(state.cardiacPhase, state.lastHr, profile) + baselineNoise(state.elapsed, profile);
}

function livePlethValue(state, profile) {
  const period = 60 / Math.max(25, state.lastHr || profile.hr || 80);
  const transitPhase = (profile.pulseTransitSec || 0.18) / period;
  const phase = positiveMod(state.cardiacPhase - transitPhase, 1);
  const perfusion = clamp(profile.perfusionIndex / 2.2, 0.22, 1.8);
  const respiratoryModulation = 1 + 0.04 * Math.sin(TAU * state.respiratoryPhase);
  return perfusion * respiratoryModulation * plethMorphology(phase) + 0.005 * pseudoNoise(state.elapsed * 71.7);
}

function liveRespValue(state, profile) {
  if (profile.respiratoryPattern === 'apnoea') return 0.007 * pseudoNoise(state.elapsed * 8.8);
  if (profile.respiratoryPattern === 'cheyne_stokes') {
    const envelope = 0.10 + 0.90 * (0.5 + 0.5 * Math.sin(TAU * state.elapsed / 34));
    return profile.respiratoryAmplitude * envelope * spontaneousBreathShape(state.respiratoryPhase, profile);
  }
  const ventilated = profile.respiratoryPattern === 'ventilator' || profile.respiratoryPattern === 'regular';
  const shape = ventilated ? ventilatorBreathShape(state.respiratoryPhase) : spontaneousBreathShape(state.respiratoryPhase, profile);
  const microVariation = ventilated ? 0 : 0.035 * pseudoNoise(state.elapsed * 4.9) + 0.020 * Math.sin(TAU * state.elapsed / 7.8);
  return profile.respiratoryAmplitude * state.breathAmplitudeFactor * shape + microVariation;
}

function liveCapnoValue(state, profile) {
  if (!profile.capnographyEnabled) return 0;
  if (profile.respiratoryPattern === 'apnoea') return 0;
  return capnogramMorphology(state.respiratoryPhase, profile.capnoPattern);
}

function liveArterialValue(state, profile, inputs = {}) {
  if (!profile.invasiveBpEnabled) return 0;
  const systolic = Number(inputs.sbp ?? 120);
  const diastolic = Number(inputs.dbp ?? 80);
  const pulsePressure = Math.max(10, systolic - diastolic);
  return profile.arterialPulsePressureScale * arterialMorphology(state.cardiacPhase) * pulsePressure + diastolic;
}

/* Pure samplers remain exported for tests and future static previews. */
export function sampleEcgAt(timeSec, profile) {
  const rhythm = profile.rhythm;
  if (rhythm === 'asystole') return baselineNoise(timeSec, profile) * 0.25;
  if (rhythm === 'ventricular_tachycardia') return sampleVentricularTachycardia(timeSec, profile);
  if (rhythm === 'atrial_fibrillation') return sampleAtrialFibrillation(timeSec, profile);
  return sampleSinusFamily(timeSec, profile);
}

export function samplePlethAt(timeSec, profile) {
  const hr = Math.max(25, profile.hr || 80);
  const period = 60 / hr;
  const phase = positiveMod(timeSec - (profile.pulseTransitSec || 0.18), period) / period;
  const perfusion = clamp(profile.perfusionIndex / 2.2, 0.28, 1.7);
  return perfusion * plethMorphology(phase) + 0.005 * pseudoNoise(timeSec * 67.1);
}

export function sampleRespAt(timeSec, profile) {
  const rr = Math.max(1, profile.rr || 16);
  const period = 60 / rr;
  if (profile.respiratoryPattern === 'apnoea') return 0.008 * pseudoNoise(timeSec * 9.4);
  if (profile.respiratoryPattern === 'cheyne_stokes') {
    const envelope = 0.13 + 0.87 * (0.5 + 0.5 * Math.sin(TAU * timeSec / 35));
    return profile.respiratoryAmplitude * envelope * spontaneousBreathShape(positiveMod(timeSec, period) / period, profile);
  }
  if (profile.respiratoryPattern === 'spontaneous' || profile.respiratoryPattern === 'irregular') {
    const breath = irregularBreathAt(timeSec, period, profile.respIrregularity || 0.14);
    return profile.respiratoryAmplitude * breath.amplitude * spontaneousBreathShape(breath.phase, profile) + 0.025 * pseudoNoise(timeSec * 4.3);
  }
  return profile.respiratoryAmplitude * ventilatorBreathShape(positiveMod(timeSec, period) / period);
}

export function sampleCapnoAt(timeSec, profile) {
  if (!profile.capnographyEnabled) return 0;
  const rr = Math.max(1, profile.rr || 16);
  const period = 60 / rr;
  return capnogramMorphology(positiveMod(timeSec, period) / period, profile.capnoPattern);
}

function sinusMorphologyByPhase(phase, hr, profile) {
  const period = 60 / Math.max(25, hr || 80);
  return sinusMorphologyBySeconds(phase * period, period, profile);
}

function sinusMorphologyBySeconds(phaseSec, period, profile) {
  const pCenter = Math.min(0.12, period * 0.18);
  const pr = Math.min(profile.prMs / 1000, period * 0.30);
  const qrsStart = Math.max(pCenter + 0.055, pr);
  const qrsWidth = clamp(profile.qrsMs / 1000, 0.065, 0.18);
  const rCenter = qrsStart + qrsWidth * 0.46;
  const qCenter = rCenter - qrsWidth * 0.22;
  const sCenter = rCenter + qrsWidth * 0.24;
  const stStart = qrsStart + qrsWidth * 0.98;
  const qt = clamp(profile.qtMs / 1000, 0.28, Math.max(0.31, period * 0.72));
  const tCenter = Math.min(qrsStart + qt * 0.70, period * 0.80);
  const tSigma = clamp(0.055 * (80 / Math.max(35, 60 / period)) ** 0.25, 0.04, 0.075);
  const stEnd = Math.min(period * 0.86, tCenter + tSigma * 1.35);

  let y = 0;
  y += profile.pAmplitude * gaussian(phaseSec, pCenter, 0.026);
  y += -0.13 * profile.rAmplitude * gaussian(phaseSec, qCenter, qrsWidth * 0.09);
  y += 1.00 * profile.rAmplitude * gaussian(phaseSec, rCenter, qrsWidth * 0.075);
  y += -0.28 * profile.rAmplitude * gaussian(phaseSec, sCenter, qrsWidth * 0.11);
  y += profile.tAmplitude * gaussian(phaseSec, tCenter, tSigma);

  if (phaseSec >= stStart && phaseSec <= stEnd && profile.stShiftMv) {
    const rise = smoothStep((phaseSec - stStart) / 0.020);
    const fallStart = Math.max(stStart + 0.08, tCenter - tSigma * 0.40);
    const fall = phaseSec <= fallStart ? 1 : 1 - smoothStep((phaseSec - fallStart) / Math.max(0.055, stEnd - fallStart));
    const plateauF = clamp((phaseSec - stStart) / Math.max(0.06, fallStart - stStart), 0, 1);
    const shape = profile.stShape === 'convex'
      ? 1 + 0.11 * Math.sin(Math.PI * plateauF)
      : profile.stShape === 'upslope'
        ? 0.90 + 0.20 * plateauF
        : 1;
    const slope = 1 + profile.stSlope * (plateauF - 0.5);
    y += profile.stShiftMv * rise * fall * shape * slope;
  }
  return y;
}

function sampleSinusFamily(timeSec, profile) {
  const hr = Math.max(25, profile.hr || 80);
  const period = 60 / hr;
  const beatIndex = Math.floor(timeSec / period);
  const phaseSec = positiveMod(timeSec, period);
  const isPvc = profile.pvcEvery > 0 && beatIndex > 0 && beatIndex % profile.pvcEvery === 0;
  if (isPvc) return pvcComplex(phaseSec, period) + baselineNoise(timeSec, profile);
  return sinusMorphologyBySeconds(phaseSec, period, profile) + baselineNoise(timeSec, profile);
}

function sampleAtrialFibrillation(timeSec, profile) {
  const nominalPeriod = 60 / Math.max(35, profile.hr || 90);
  const beat = irregularBeatAt(timeSec, nominalPeriod, profile.afIrregularity);
  const phaseSec = timeSec - beat.start;
  const qrsWidth = clamp(profile.qrsMs / 1000, 0.07, 0.13);
  const rCenter = 0.035 + qrsWidth * 0.45;
  let y = 0.025 * Math.sin(TAU * 6.4 * timeSec) + 0.018 * Math.sin(TAU * 8.7 * timeSec + 1.2);
  y += -0.12 * gaussian(phaseSec, rCenter - qrsWidth * 0.21, qrsWidth * 0.09);
  y += profile.rAmplitude * beat.amplitude * gaussian(phaseSec, rCenter, qrsWidth * 0.075);
  y += -0.24 * gaussian(phaseSec, rCenter + qrsWidth * 0.25, qrsWidth * 0.12);
  y += 0.22 * gaussian(phaseSec, rCenter + 0.27, 0.07);
  return y + baselineNoise(timeSec, profile);
}

function atrialFibrillationPhase(phase, profile, elapsed) {
  const qrsWidthPhase = clamp((profile.qrsMs / 1000) / (60 / Math.max(35, profile.hr || 90)), 0.07, 0.22);
  const r = gaussian(phase, 0.16, qrsWidthPhase * 0.10);
  const q = -0.12 * gaussian(phase, 0.13, qrsWidthPhase * 0.12);
  const s = -0.26 * gaussian(phase, 0.20, qrsWidthPhase * 0.15);
  const t = 0.22 * gaussian(phase, 0.48, 0.075);
  const fibrillatory = 0.024 * Math.sin(TAU * 6.2 * elapsed) + 0.016 * Math.sin(TAU * 8.9 * elapsed + 1.4);
  return profile.rAmplitude * r + q + s + t + fibrillatory;
}

function sampleVentricularTachycardia(timeSec, profile) {
  const period = 60 / Math.max(100, profile.hr || 150);
  return ventricularTachycardiaPhase(positiveMod(timeSec, period) / period, profile) + baselineNoise(timeSec, profile);
}

function ventricularTachycardiaPhase(phase) {
  const qrs = 1.05 * gaussian(phase, 0.34, 0.105) - 0.62 * gaussian(phase, 0.53, 0.11);
  const t = -0.22 * gaussian(phase, 0.76, 0.11);
  return qrs + t;
}

function pvcPhase(phase) {
  return 0.92 * gaussian(phase, 0.24, 0.07) - 0.72 * gaussian(phase, 0.38, 0.075) - 0.18 * gaussian(phase, 0.70, 0.10);
}

function pvcComplex(phaseSec, period) {
  const center = Math.min(0.18, period * 0.28);
  return 0.92 * gaussian(phaseSec, center, 0.055) - 0.72 * gaussian(phaseSec, center + 0.075, 0.06) - 0.18 * gaussian(phaseSec, center + 0.30, 0.09);
}

function plethMorphology(phase) {
  const systolic = phase < 0.15
    ? Math.pow(clamp(phase / 0.15, 0, 1), 2.8)
    : Math.exp(-(phase - 0.15) * 3.35);
  const notch = -0.13 * gaussian(phase, 0.41, 0.022);
  const dicrotic = 0.10 * gaussian(phase, 0.49, 0.035);
  const baseline = 0.025 * Math.exp(-phase * 2.2);
  return 0.94 * systolic + notch + dicrotic + baseline - 0.08;
}

function arterialMorphology(phase) {
  const upstroke = phase < 0.13 ? Math.pow(phase / 0.13, 2.4) : Math.exp(-(phase - 0.13) * 3.4);
  const notch = -0.10 * gaussian(phase, 0.40, 0.022);
  const rebound = 0.07 * gaussian(phase, 0.48, 0.035);
  return clamp(upstroke + notch + rebound, 0, 1.15);
}

function capnogramMorphology(phase, pattern = 'normal') {
  if (pattern === 'bronchospasm') {
    if (phase < 0.28) return 0;
    if (phase < 0.50) return smoothStep((phase - 0.28) / 0.22) * 0.82;
    if (phase < 0.77) return 0.82 + 0.16 * ((phase - 0.50) / 0.27);
    if (phase < 0.84) return 0.98 * (1 - smoothStep((phase - 0.77) / 0.07));
    return 0;
  }
  if (phase < 0.30) return 0;
  if (phase < 0.38) return smoothStep((phase - 0.30) / 0.08);
  if (phase < 0.76) return 0.95 + 0.05 * ((phase - 0.38) / 0.38);
  if (phase < 0.83) return 1 - smoothStep((phase - 0.76) / 0.07);
  return 0;
}

function spontaneousBreathShape(phase, profile = {}) {
  // Spontaneous impedance-respiration morphology: inspiration is visibly
  // quicker than expiration. This is intentionally asymmetric so a conscious,
  // spontaneously breathing patient does not look mechanically ventilated.
  const inspiratoryFraction = clamp(Number(profile.inspiratoryFraction ?? 0.22), 0.16, 0.38);
  const shoulderFraction = Math.min(0.07, (1 - inspiratoryFraction) * 0.16);
  const expirationStart = inspiratoryFraction + shoulderFraction;
  const baseline = -0.82;
  const peak = 1.02;

  if (phase < inspiratoryFraction) {
    const f = clamp(phase / inspiratoryFraction, 0, 1);
    // Fast inspiratory upstroke with a rounded finish, not a sine wave.
    const rise = 1 - Math.pow(1 - f, 3.2);
    return baseline + (peak - baseline) * rise;
  }

  if (phase < expirationStart) {
    const f = clamp((phase - inspiratoryFraction) / Math.max(0.001, shoulderFraction), 0, 1);
    return peak - 0.10 * smoothStep(f);
  }

  const f = clamp((phase - expirationStart) / Math.max(0.001, 1 - expirationStart), 0, 1);
  const tau = clamp(Number(profile.expiratoryTau ?? 3.4), 1.8, 6.0);
  const normalizedExp = (Math.exp(-tau * f) - Math.exp(-tau)) / (1 - Math.exp(-tau));
  const slowExpiration = baseline + (peak - 0.10 - baseline) * normalizedExp;
  // Small late-expiratory drift keeps a spontaneously breathing trace from
  // looking geometrically perfect while preserving the slow expiratory slope.
  return slowExpiration + 0.018 * Math.sin(Math.PI * f);
}

function ventilatorBreathShape(phase) {
  return -0.82 + 1.82 * 0.5 * (1 - Math.cos(TAU * phase));
}

function irregularBreathAt(timeSec, nominalPeriod, irregularity) {
  let start = -nominalPeriod * 2;
  let i = -2;
  let duration = nominalPeriod;
  while (start + duration <= timeSec) {
    start += duration;
    i += 1;
    const variation = 1 + irregularity * pseudoNoise(i * 5.31 + 0.8);
    duration = nominalPeriod * clamp(variation, 0.68, 1.38);
  }
  const phase = clamp((timeSec - start) / duration, 0, 0.9999);
  let amplitude = clamp(1 + 0.14 * pseudoNoise(i * 7.83 + 2.1), 0.72, 1.42);
  if (i > 0 && i % 9 === 0) amplitude *= 1.52;
  return { phase, amplitude };
}

function irregularBeatAt(timeSec, nominalPeriod, irregularity) {
  let start = -nominalPeriod * 3;
  let i = -3;
  while (start + nominalPeriod * 1.6 < timeSec) {
    const variation = 1 + irregularity * pseudoNoise(i * 13.17);
    start += nominalPeriod * clamp(variation, 0.55, 1.55);
    i += 1;
  }
  return { start, amplitude: 0.88 + 0.18 * pseudoNoise(i * 7.31) };
}

function baselineNoise(t, profile) {
  return (profile.baselineWander || 0) * Math.sin(TAU * 0.23 * t) + (profile.noise || 0) * pseudoNoise(t * 83.7);
}
function smoothStep(f) { const x = clamp(f, 0, 1); return x * x * (3 - 2 * x); }
function gaussian(x, mu, sigma) { return Math.exp(-((x - mu) ** 2) / (2 * sigma ** 2)); }
function positiveMod(x, m) { return ((x % m) + m) % m; }
function pseudoNoise(x) { return Math.sin(x * 12.9898 + 78.233) * 0.5 + Math.sin(x * 4.1414 + 19.19) * 0.5; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
