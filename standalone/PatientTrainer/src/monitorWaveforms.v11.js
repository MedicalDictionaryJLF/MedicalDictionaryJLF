const TAU = Math.PI * 2;

export function buildMonitorProfile(patientCase, vitals) {
  const supplied = patientCase?.monitorProfile || {};
  const hr = Number(supplied.hr ?? vitals?.hr ?? 80);
  const rr = Number(supplied.rr ?? vitals?.rr ?? 16);
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
    stShiftMv: Number(supplied.stShiftMv ?? 0),
    stSlope: Number(supplied.stSlope ?? 0),
    perfusionIndex: Number(supplied.perfusionIndex ?? 2.2),
    respiratoryPattern: supplied.respiratoryPattern || 'regular',
    respiratoryAmplitude: Number(supplied.respiratoryAmplitude ?? 1),
    noise: Number(supplied.noise ?? 0.004),
    baselineWander: Number(supplied.baselineWander ?? 0.015),
    pvcEvery: Number(supplied.pvcEvery ?? 0),
    afIrregularity: Number(supplied.afIrregularity ?? 0.18)
  };
}

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
  const phase = positiveMod(timeSec, period) / period;
  // Pulse oximeter pleth: rapid systolic upstroke, slower diastolic decay and dicrotic notch.
  const upstroke = logisticPulse(phase, 0.08, 0.018);
  const decay = phase > 0.08 ? Math.exp(-(phase - 0.08) * 3.8) : 0;
  const notch = -0.12 * gaussian(phase, 0.42, 0.025);
  const rebound = 0.08 * gaussian(phase, 0.49, 0.035);
  const perfusion = clamp(profile.perfusionIndex / 2.2, 0.28, 1.7);
  return perfusion * (0.82 * upstroke * decay + notch + rebound) + 0.006 * pseudoNoise(timeSec * 67.1);
}

export function sampleRespAt(timeSec, profile) {
  const rr = Math.max(4, profile.rr || 16);
  const period = 60 / rr;
  const phase = positiveMod(timeSec, period) / period;
  const amp = profile.respiratoryAmplitude || 1;
  if (profile.respiratoryPattern === 'apnoea') return 0.01 * pseudoNoise(timeSec * 9.4);
  if (profile.respiratoryPattern === 'cheyne_stokes') {
    const envelope = 0.15 + 0.85 * (0.5 + 0.5 * Math.sin(TAU * timeSec / 35));
    return amp * envelope * skewBreath(phase);
  }
  if (profile.respiratoryPattern === 'irregular') {
    return amp * (0.88 + 0.12 * pseudoNoise(Math.floor(timeSec / period) * 3.1)) * skewBreath(phase);
  }
  return amp * skewBreath(phase);
}

function sampleSinusFamily(timeSec, profile) {
  const hr = Math.max(25, profile.hr || 80);
  const period = 60 / hr;
  const beatIndex = Math.floor(timeSec / period);
  const phaseSec = positiveMod(timeSec, period);
  const isPvc = profile.pvcEvery > 0 && beatIndex > 0 && beatIndex % profile.pvcEvery === 0;
  if (isPvc) return pvcComplex(phaseSec, period, profile) + baselineNoise(timeSec, profile);

  // Keep physiologic intervals in seconds; compress diastole as rate rises rather than narrowing QRS unrealistically.
  const pCenter = Math.min(0.12, period * 0.18);
  const pr = Math.min(profile.prMs / 1000, period * 0.30);
  const qrsStart = Math.max(pCenter + 0.055, pr);
  const qrsWidth = clamp(profile.qrsMs / 1000, 0.065, 0.14);
  const rCenter = qrsStart + qrsWidth * 0.46;
  const qCenter = rCenter - qrsWidth * 0.22;
  const sCenter = rCenter + qrsWidth * 0.24;
  const stStart = qrsStart + qrsWidth;
  const qt = clamp(profile.qtMs / 1000, 0.30, Math.max(0.32, period * 0.72));
  const tCenter = Math.min(qrsStart + qt * 0.70, period * 0.78);
  const tSigma = clamp(0.055 * (80 / hr) ** 0.25, 0.04, 0.075);

  let y = 0;
  y += profile.pAmplitude * gaussian(phaseSec, pCenter, 0.026);
  y += -0.13 * profile.rAmplitude * gaussian(phaseSec, qCenter, qrsWidth * 0.09);
  y += 1.00 * profile.rAmplitude * gaussian(phaseSec, rCenter, qrsWidth * 0.075);
  y += -0.28 * profile.rAmplitude * gaussian(phaseSec, sCenter, qrsWidth * 0.11);
  y += profile.tAmplitude * gaussian(phaseSec, tCenter, tSigma);

  if (phaseSec >= stStart && phaseSec <= tCenter - tSigma * 0.9) {
    const span = Math.max(0.04, tCenter - tSigma * 0.9 - stStart);
    const f = clamp((phaseSec - stStart) / span, 0, 1);
    y += profile.stShiftMv * (1 + profile.stSlope * (f - 0.5));
  }
  return y + baselineNoise(timeSec, profile);
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

function sampleVentricularTachycardia(timeSec, profile) {
  const period = 60 / Math.max(100, profile.hr || 150);
  const phase = positiveMod(timeSec, period) / period;
  // Broad, monomorphic complex with secondary repolarization.
  const qrs = 1.05 * gaussian(phase, 0.34, 0.105) - 0.62 * gaussian(phase, 0.53, 0.11);
  const t = -0.22 * gaussian(phase, 0.76, 0.11);
  return qrs + t + baselineNoise(timeSec, profile);
}

function pvcComplex(phaseSec, period, profile) {
  const center = Math.min(0.18, period * 0.28);
  return 0.92 * gaussian(phaseSec, center, 0.055) - 0.72 * gaussian(phaseSec, center + 0.075, 0.06) - 0.18 * gaussian(phaseSec, center + 0.30, 0.09);
}

function irregularBeatAt(timeSec, nominalPeriod, irregularity) {
  let start = -nominalPeriod * 3;
  let i = -3;
  while (start + nominalPeriod * 1.6 < timeSec) {
    const variation = 1 + irregularity * pseudoNoise(i * 13.17);
    start += nominalPeriod * clamp(variation, 0.55, 1.55);
    i += 1;
  }
  const amplitude = 0.88 + 0.18 * pseudoNoise(i * 7.31);
  return { start, amplitude };
}

function baselineNoise(t, profile) {
  return (profile.baselineWander || 0) * Math.sin(TAU * 0.23 * t) + (profile.noise || 0) * pseudoNoise(t * 83.7);
}

function skewBreath(phase) {
  // Faster inspiration and slower expiration, as typically seen with impedance respiration.
  if (phase < 0.38) return -0.82 + 1.82 * 0.5 * (1 - Math.cos(Math.PI * phase / 0.38));
  const f = (phase - 0.38) / 0.62;
  return 1.0 - 1.82 * 0.5 * (1 - Math.cos(Math.PI * f));
}

function logisticPulse(x, center, steepness) {
  return 1 / (1 + Math.exp(-(x - center) / steepness));
}
function gaussian(x, mu, sigma) { return Math.exp(-((x - mu) ** 2) / (2 * sigma ** 2)); }
function positiveMod(x, m) { return ((x % m) + m) % m; }
function pseudoNoise(x) { return Math.sin(x * 12.9898 + 78.233) * 0.5 + Math.sin(x * 4.1414 + 19.19) * 0.5; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
