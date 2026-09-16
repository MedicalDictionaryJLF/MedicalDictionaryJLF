import {
  buildMonitorProfile,
  createLiveSignalState,
  advanceLiveSignals,
  applyPresetToProfile
} from './monitorWaveforms.js';

let monitorAnimation = null;
let currentRuntime = null;
let embeddedAnimation = null;
let embeddedRuntime = null;
let embeddedResizeObserver = null;
let embeddedContainer = null;
let audioContext = null;
let patientStateSource = null;
let unsubscribePatientState = null;

const GENERIC_ECG_PATHS = [new URL('../ECGs/peter_novak_ecg.png', import.meta.url).href];
const SAMPLE_RATE = 250;
const SWEEP_SECONDS = 6;
const DEFAULT_TRANSITION_SEC = 4;

/**
 * ResusMonitor-inspired behaviour, implemented independently:
 * - display and controller state are separated
 * - settings can be staged then applied with a smooth transition
 * - channels update continuously without rebuilding visible history
 * - sound remains opt-in because browsers block autoplay
 */

export function setMonitorPatientStateSource(source) {
  unsubscribePatientState?.();
  unsubscribePatientState = null;
  patientStateSource = source || null;
  if (patientStateSource?.subscribe) {
    unsubscribePatientState = patientStateSource.subscribe((snapshot) => {
      const patch = snapshot?.physiology || {};
      if (embeddedRuntime) updateEmbeddedMonitorPhysiology(patch, { transitionSec: 2.5 });
      if (currentRuntime) updateRuntimePhysiology(currentRuntime, patch, 2.5);
    });
  }
}

export function mountEmbeddedVitalsMonitor(container, patientCase) {
  if (!container) return;
  stopEmbeddedVitalsMonitor();
  embeddedContainer = container;
  const baseline = currentPatientVitals(patientCase);
  embeddedRuntime = makeRuntime(baseline, patientCase);
  container.innerHTML = monitorMarkup(embeddedRuntime);
  bindEmbeddedElements(embeddedRuntime, container);
  tryEnableMonitorSound(embeddedRuntime, container);
  resizeMonitorCanvases(embeddedRuntime);
  renderAllNumerics(embeddedRuntime);
  renderNibpHistory(embeddedRuntime);
  updateAlarmState(embeddedRuntime);

  embeddedRuntime.lastFrameMs = performance.now();
  const frame = (timestamp) => {
    if (!embeddedRuntime) return;
    const dt = Math.max(0, Math.min(0.08, (timestamp - embeddedRuntime.lastFrameMs) / 1000));
    embeddedRuntime.lastFrameMs = timestamp;
    if (!embeddedRuntime.paused) advanceRuntime(embeddedRuntime, dt);
    updateMonitorClock(embeddedRuntime);
    embeddedAnimation = requestAnimationFrame(frame);
  };
  embeddedAnimation = requestAnimationFrame(frame);

  if ('ResizeObserver' in window) {
    embeddedResizeObserver = new ResizeObserver(() => resizeMonitorCanvases(embeddedRuntime));
    embeddedResizeObserver.observe(container);
  }
  return embeddedRuntime;
}

export function stopEmbeddedVitalsMonitor() {
  if (embeddedAnimation) cancelAnimationFrame(embeddedAnimation);
  try { embeddedResizeObserver?.disconnect?.(); } catch {}
  embeddedAnimation = null;
  embeddedResizeObserver = null;
  embeddedRuntime = null;
  embeddedContainer = null;
}

/** Stage changes without altering the display yet, like an instructor control. */
export function stageEmbeddedMonitorUpdate(patch = {}) {
  if (!embeddedRuntime || !patch || typeof patch !== 'object') return false;
  Object.assign(embeddedRuntime.stagedPatch, patch);
  return true;
}

/** Apply staged values to the running display, optionally over several seconds. */
export function applyStagedMonitorUpdate(options = {}) {
  if (!embeddedRuntime) return false;
  const patch = { ...embeddedRuntime.stagedPatch };
  embeddedRuntime.stagedPatch = {};
  return updateEmbeddedMonitorPhysiology(patch, options);
}

/**
 * Convenience API for Patient Trainer events. Numerical values trend smoothly
 * to new targets; rhythm/profile properties apply to newly generated samples.
 */
export function updateEmbeddedMonitorPhysiology(patch = {}, options = {}) {
  if (!embeddedRuntime || !patch || typeof patch !== 'object') return false;
  const durationSec = clamp(Number(options.transitionSec ?? patch.transitionSec ?? DEFAULT_TRANSITION_SEC), 0, 300);
  const numericKeys = ['hr', 'rr', 'spo2', 'temp', 'sbp', 'dbp', 'etco2'];
  const start = { ...embeddedRuntime.values };
  const target = { ...embeddedRuntime.targetValues };
  numericKeys.forEach((key) => {
    if (Number.isFinite(Number(patch[key]))) target[key] = Number(patch[key]);
  });
  target.map = Math.round(target.dbp + (target.sbp - target.dbp) / 3);
  embeddedRuntime.transition = {
    start,
    target,
    elapsed: 0,
    duration: durationSec
  };
  embeddedRuntime.targetValues = target;

  const profileKeys = [
    'rhythm', 'displayLead', 'qrsMs', 'prMs', 'qtMs', 'pAmplitude', 'rAmplitude',
    'tAmplitude', 'stShiftMv', 'stSlope', 'stShape', 'perfusionIndex',
    'respiratoryPattern', 'respiratoryAmplitude', 'respIrregularity', 'inspiratoryFraction', 'expiratoryTau', 'sighEvery',
    'pulseTransitSec', 'pvcEvery', 'afIrregularity', 'capnographyEnabled',
    'capnoPattern'
  ];
  profileKeys.forEach((key) => {
    if (patch[key] !== undefined) embeddedRuntime.profile[key] = patch[key];
  });
  if (Number.isFinite(Number(patch.etco2))) embeddedRuntime.profile.etco2 = Number(patch.etco2);
  refreshChannelMode(embeddedRuntime);
  return true;
}

export function applyEmbeddedMonitorPreset(presetName, overrides = {}, options = {}) {
  if (!embeddedRuntime) return false;
  const before = { ...embeddedRuntime.profile };
  applyPresetToProfile(embeddedRuntime.profile, presetName, overrides);
  const numeric = {};
  ['hr', 'rr', 'etco2'].forEach((key) => {
    if (embeddedRuntime.profile[key] !== before[key]) numeric[key] = embeddedRuntime.profile[key];
  });
  if (Object.keys(numeric).length) updateEmbeddedMonitorPhysiology(numeric, options);
  refreshChannelMode(embeddedRuntime);
  return true;
}

/* Legacy modal support retained for the existing Patient Trainer shell. */
export function openVitalsMonitor(patientCase) {
  const modal = document.getElementById('vitalsMonitorModal');
  const canvas = document.getElementById('vitalsMonitorCanvas');
  const title = document.getElementById('vitalsMonitorTitle');
  if (!modal || !canvas) return;
  stopVitalsMonitor();
  if (title) title.textContent = 'Live bedside monitor';
  modal.classList.add('visible');
  modal.setAttribute('aria-hidden', 'false');
  const baseline = currentPatientVitals(patientCase);
  currentRuntime = makeRuntime(baseline, patientCase);
  resizeLegacyCanvas(canvas);
  let previous = performance.now();
  const draw = (ts) => {
    if (!currentRuntime) return;
    const dt = Math.min(0.08, Math.max(0, (ts - previous) / 1000));
    previous = ts;
    if (!currentRuntime.paused) advanceRuntime(currentRuntime, dt, canvas);
    drawLegacyPreview(canvas, currentRuntime);
    monitorAnimation = requestAnimationFrame(draw);
  };
  monitorAnimation = requestAnimationFrame(draw);
}

export function stopVitalsMonitor() {
  if (monitorAnimation) cancelAnimationFrame(monitorAnimation);
  monitorAnimation = null;
  currentRuntime = null;
}

export function closeVitalsMonitor() {
  stopVitalsMonitor();
  const modal = document.getElementById('vitalsMonitorModal');
  if (modal) {
    modal.classList.remove('visible');
    modal.setAttribute('aria-hidden', 'true');
  }
}

export function openEcgViewer(patientCase) {
  const modal = document.getElementById('ecgViewerModal');
  const img = document.getElementById('ecgRecordingImage');
  const fallback = document.getElementById('ecgRecordingFallback');
  const title = document.getElementById('ecgViewerTitle');
  if (!modal || !img || !fallback) return;
  if (title) title.textContent = patientCase?.ecg?.label || 'ECG recording';

  const sources = [];
  if (patientCase?.ecg?.imagePath) sources.push(patientCase.ecg.imagePath);
  sources.push(...GENERIC_ECG_PATHS.filter((item) => !sources.includes(item)));
  let index = 0;
  fallback.hidden = true;
  img.hidden = false;
  img.onerror = () => {
    index += 1;
    if (index < sources.length) img.src = `${sources[index]}?v=${Date.now()}`;
    else { img.hidden = true; fallback.hidden = false; }
  };
  img.onload = () => { fallback.hidden = true; img.hidden = false; };
  img.src = `${sources[0]}?v=${Date.now()}`;
  modal.classList.add('visible');
  modal.setAttribute('aria-hidden', 'false');
}

export function closeEcgViewer() {
  const modal = document.getElementById('ecgViewerModal');
  if (modal) {
    modal.classList.remove('visible');
    modal.setAttribute('aria-hidden', 'true');
  }
}

export function resizeVisibleMonitor() {
  if (embeddedRuntime) resizeMonitorCanvases(embeddedRuntime);
  const canvas = document.getElementById('vitalsMonitorCanvas');
  const modal = document.getElementById('vitalsMonitorModal');
  if (canvas && modal?.classList.contains('visible')) resizeLegacyCanvas(canvas);
}


function currentPatientVitals(patientCase) {
  const fallback = extractVitals(patientCase);
  const snapshot = patientStateSource?.getSnapshot?.();
  const p = snapshot?.physiology || {};
  return {
    hr: finiteOr(p.hr, fallback.hr),
    rr: finiteOr(p.rr, fallback.rr),
    spo2: finiteOr(p.spo2, fallback.spo2),
    temp: finiteOr(p.temp, fallback.temp),
    sbp: finiteOr(p.sbp, fallback.sbp),
    dbp: finiteOr(p.dbp, fallback.dbp)
  };
}

function updateRuntimePhysiology(runtime, patch, transitionSec = 2.5) {
  if (!runtime || !patch) return;
  const target = { ...runtime.targetValues };
  ['hr','rr','spo2','temp','sbp','dbp'].forEach((key) => {
    const value = Number(patch[key]);
    if (Number.isFinite(value)) target[key] = value;
  });
  target.map = Math.round(target.dbp + (target.sbp - target.dbp) / 3);
  runtime.transition = { start: { ...runtime.values }, target, elapsed: 0, duration: Math.max(0, Number(transitionSec || 0)) };
  runtime.targetValues = target;
}

function finiteOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function makeRuntime(baseline, patientCase) {
  const profile = buildMonitorProfile(patientCase, baseline);
  const values = {
    ...baseline,
    etco2: Number(profile.etco2 || 4.8),
    map: Math.round(baseline.dbp + (baseline.sbp - baseline.dbp) / 3)
  };
  return {
    baseline,
    values: { ...values },
    targetValues: { ...values },
    profile,
    patientCase,
    signalState: createLiveSignalState(profile),
    stagedPatch: {},
    transition: null,
    paused: false,
    soundEnabled: false,
    lastAlarmToneAt: 0,
    lastFrameMs: performance.now(),
    sampleAccumulator: 0,
    nibpHistory: makeInitialNibpHistory(values),
    nibpMeasuring: false,
    elements: {},
    sweeps: {}
  };
}

function monitorMarkup(runtime) {
  const fourth = runtime.profile.capnographyEnabled ? 'capno' : 'resp';
  return `
    <div class="resus-monitor" data-resus-monitor>
      <header class="resus-monitor-header">
        <div class="resus-monitor-identity"><span class="monitor-online-dot"></span><strong>BED 03</strong><span>ADULT</span><span class="monitor-connection">SIM CONNECTED</span></div>
        <div class="resus-monitor-meta"><span>ECG ${escapeHtml(runtime.profile.displayLead)}</span><span>25 mm/s</span><span>10 mm/mV</span><time data-monitor-clock></time></div>
      </header>

      <div class="resus-monitor-channels">
        ${channelMarkup('ecg', 'ECG', 'bpm', 'green', 'II', 'HR')}
        ${channelMarkup('pleth', 'SpO₂', '%', 'yellow', 'PLETH', 'SpO₂')}
        ${bpChannelMarkup(runtime)}
        ${fourth === 'capno'
          ? channelMarkup('capno', 'EtCO₂', 'kPa', 'white', 'CO₂', 'EtCO₂', true)
          : channelMarkup('resp', 'RR', '/min', 'white', 'RESP', 'RR')}
      </div>

      <div class="resus-monitor-history" data-nibp-history></div>

      <footer class="resus-monitor-footer">
        <div class="resus-monitor-alarm" data-monitor-alarm><span></span><strong>No active alarm</strong></div>
        <div class="resus-monitor-controls">
          <button type="button" class="monitor-control-button" data-monitor-sound>Sound starting…</button>
          <button type="button" class="monitor-control-button" data-monitor-freeze>Freeze</button>
          <button type="button" class="monitor-control-button primary" data-monitor-nibp>Start NIBP</button>
          <button type="button" class="monitor-control-button" data-monitor-trend-reset>Clear BP history</button>
        </div>
      </footer>
    </div>`;
}

function channelMarkup(key, label, unit, color, waveLabel, numericKey, secondary = false) {
  return `
    <section class="resus-channel resus-channel-${key}" data-channel="${key}">
      <div class="resus-numeric resus-${color}">
        <span>${label}</span>
        <strong data-monitor-value="${numericKey}">--</strong>
        <small>${unit}</small>
      </div>
      <div class="resus-wave-panel" data-wave-panel="${key}">
        <div class="resus-wave-label"><strong>${waveLabel}</strong>${secondary ? '<small>RESP source</small>' : ''}</div>
        <canvas data-monitor-wave="${key}" aria-label="${label} waveform"></canvas>
        <span class="resus-sweep-head" data-sweep-head="${key}"></span>
      </div>
    </section>`;
}

function bpChannelMarkup() {
  // Standard ED configuration: non-invasive oscillometric cuff only.
  // Systolic, diastolic and MAP are shown explicitly; there is no arterial
  // pressure waveform unless a future invasive-line module is deliberately built.
  return `
    <section class="resus-channel resus-channel-nibp" data-channel="nibp">
      <div class="resus-numeric resus-red resus-nibp-numeric">
        <span>NIBP</span>
        <div class="nibp-number-grid">
          <div><small>SYS</small><strong data-monitor-value="NIBP_SYS">--</strong></div>
          <div><small>DIA</small><strong data-monitor-value="NIBP_DIA">--</strong></div>
          <div><small>MAP</small><strong data-monitor-value="MAP">--</strong></div>
        </div>
        <small class="nibp-unit">mmHg</small>
      </div>
      <div class="resus-nibp-status">
        <div><span>Last cuff</span><strong data-nibp-last-time>--:--</strong></div>
        <div class="nibp-cuff-state" data-nibp-state>Manual NIBP</div>
      </div>
    </section>`;
}

function bindEmbeddedElements(runtime, container) {
  runtime.elements.container = container;
  runtime.elements.clock = container.querySelector('[data-monitor-clock]');
  runtime.elements.alarm = container.querySelector('[data-monitor-alarm]');
  runtime.elements.history = container.querySelector('[data-nibp-history]');
  runtime.elements.nibpTime = container.querySelector('[data-nibp-last-time]');
  runtime.elements.nibpState = container.querySelector('[data-nibp-state]');
  runtime.elements.numeric = {};
  ['HR', 'SpO₂', 'NIBP_SYS', 'NIBP_DIA', 'MAP', 'RR', 'EtCO₂'].forEach((key) => {
    runtime.elements.numeric[key] = container.querySelector(`[data-monitor-value="${key}"]`);
  });

  runtime.elements.canvases = {};
  runtime.elements.heads = {};
  container.querySelectorAll('[data-monitor-wave]').forEach((canvas) => {
    const key = canvas.dataset.monitorWave;
    runtime.elements.canvases[key] = canvas;
    runtime.elements.heads[key] = container.querySelector(`[data-sweep-head="${key}"]`);
    runtime.sweeps[key] = createSweepState();
  });

  container.querySelector('[data-monitor-freeze]')?.addEventListener('click', (event) => {
    runtime.paused = !runtime.paused;
    runtime.lastFrameMs = performance.now();
    event.currentTarget.textContent = runtime.paused ? 'Resume' : 'Freeze';
    container.classList.toggle('monitor-frozen', runtime.paused);
  });

  container.querySelector('[data-monitor-sound]')?.addEventListener('click', async (event) => {
    if (!runtime.soundEnabled) {
      const ok = await enableMonitorSound(runtime);
      event.currentTarget.textContent = ok ? 'Sound on' : 'Enable sound';
      event.currentTarget.classList.toggle('active', ok);
    } else {
      runtime.soundEnabled = false;
      event.currentTarget.textContent = 'Sound off';
      event.currentTarget.classList.remove('active');
    }
  });

  container.querySelector('[data-monitor-nibp]')?.addEventListener('click', (event) => startNibpMeasurement(runtime, event.currentTarget));
  container.querySelector('[data-monitor-trend-reset]')?.addEventListener('click', () => {
    runtime.nibpHistory = [];
    renderNibpHistory(runtime);
  });
}

function advanceRuntime(runtime, dt) {
  updateTransition(runtime, dt);
  runtime.sampleAccumulator += dt;
  const step = 1 / SAMPLE_RATE;
  while (runtime.sampleAccumulator >= step) {
    runtime.sampleAccumulator -= step;
    const signals = advanceLiveSignals(runtime.signalState, step, runtime.profile, runtime.values);
    drawSignalSample(runtime, signals, step);
    if (signals.beat) {
      if (runtime.soundEnabled) playPulseTone(runtime.values.spo2);
      pulseNumeric(runtime, 'HR');
    }
  }
  renderAllNumerics(runtime);
  updateAlarmState(runtime);
}

function updateTransition(runtime, dt) {
  const t = runtime.transition;
  if (!t) return;
  t.elapsed += dt;
  const f = t.duration <= 0 ? 1 : smoothStep(clamp(t.elapsed / t.duration, 0, 1));
  Object.keys(t.target).forEach((key) => {
    const a = Number(t.start[key]);
    const b = Number(t.target[key]);
    if (Number.isFinite(a) && Number.isFinite(b)) runtime.values[key] = a + (b - a) * f;
  });
  runtime.values.map = Math.round(runtime.values.dbp + (runtime.values.sbp - runtime.values.dbp) / 3);
  if (f >= 1) runtime.transition = null;
}

function drawSignalSample(runtime, signals, dt) {
  const channels = Object.keys(runtime.elements.canvases || {});
  channels.forEach((key) => {
    const value = signals[key];
    if (!Number.isFinite(value)) return;
    const canvas = runtime.elements.canvases[key];
    const sweep = runtime.sweeps[key];
    if (!canvas || !sweep) return;
    const width = canvas._cssWidth || canvas.clientWidth;
    const height = canvas._cssHeight || canvas.clientHeight;
    if (!width || !height) return;

    sweep.elapsed = (sweep.elapsed || 0) + dt;
    const x = ((sweep.elapsed % SWEEP_SECONDS) / SWEEP_SECONDS) * width;
    const y = signalToY(key, value, height, runtime);
    const ctx = canvas.getContext('2d');
    const color = channelColor(key);
    const wrap = sweep.prevX !== null && x < sweep.prevX;
    const wipe = Math.max(10, width * 0.020);
    ctx.clearRect(x, 0, wipe, height);
    if (wrap) {
      ctx.clearRect(0, 0, wipe, height);
      sweep.prevX = null;
      sweep.prevY = null;
    }
    if (sweep.prevX !== null && sweep.prevY !== null) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = key === 'ecg' ? 1.65 : 1.8;
      ctx.shadowColor = color;
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.moveTo(sweep.prevX, sweep.prevY);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.restore();
    }
    sweep.prevX = x;
    sweep.prevY = y;
    const head = runtime.elements.heads[key];
    if (head) head.style.left = `${(x / width) * 100}%`;
  });
}

function signalToY(key, value, height, runtime) {
  if (key === 'ecg') return height * 0.56 - value * height * 0.31;
  if (key === 'pleth') return height * 0.72 - value * height * 0.58;
  if (key === 'resp') return height * 0.52 - value * height * 0.35;
  if (key === 'capno') return height * 0.82 - clamp(value, 0, 1.1) * height * 0.68;
  if (key === 'art') {
    const min = Math.max(0, runtime.values.dbp - 20);
    const max = runtime.values.sbp + 20;
    return height * (1 - clamp((value - min) / Math.max(1, max - min), 0.03, 0.97));
  }
  return height * 0.5;
}

function resizeMonitorCanvases(runtime) {
  if (!runtime?.elements?.canvases) return;
  Object.entries(runtime.elements.canvases).forEach(([key, canvas]) => {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(260, Math.round(rect.width));
    const height = Math.max(54, Math.round(rect.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas._cssWidth = width;
      canvas._cssHeight = height;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      runtime.sweeps[key] = createSweepState();
    }
  });
}

function createSweepState() {
  return { elapsed: 0, prevX: null, prevY: null };
}

function refreshChannelMode(runtime) {
  if (!runtime?.elements?.container || runtime.profile.capnographyEnabled === Boolean(runtime.elements.canvases.capno)) return;
  // Capnography changes the fourth channel DOM, so remount this monitor only.
  const container = runtime.elements.container;
  const staged = { ...runtime.stagedPatch };
  const snapshot = { ...runtime.values };
  const profile = { ...runtime.profile };
  const patientCase = runtime.patientCase;
  mountEmbeddedVitalsMonitor(container, patientCase);
  if (embeddedRuntime) {
    Object.assign(embeddedRuntime.values, snapshot);
    Object.assign(embeddedRuntime.targetValues, snapshot);
    Object.assign(embeddedRuntime.profile, profile);
    Object.assign(embeddedRuntime.stagedPatch, staged);
  }
}

function renderAllNumerics(runtime) {
  const e = runtime.elements.numeric || {};
  setText(e.HR, Math.round(runtime.values.hr));
  setText(e['SpO₂'], Math.round(runtime.values.spo2));
  setText(e.NIBP_SYS, Math.round(runtime.values.sbp));
  setText(e.NIBP_DIA, Math.round(runtime.values.dbp));
  setText(e.MAP, Math.round(runtime.values.map));
  setText(e.RR, Math.round(runtime.values.rr));
  setText(e['EtCO₂'], Number(runtime.values.etco2).toFixed(1));
}

function renderNibpHistory(runtime) {
  const panel = runtime.elements.history;
  if (!panel) return;
  const history = runtime.nibpHistory.slice(-5).reverse();
  panel.innerHTML = `<span class="nibp-history-title">NIBP history</span>${history.length
    ? history.map((item) => `<div class="nibp-history-item"><time>${escapeHtml(item.time)}</time><strong>${item.sbp}/${item.dbp}</strong><small>MAP ${item.map}</small></div>`).join('')
    : '<div class="nibp-history-empty">No cuff measurements recorded.</div>'}`;
  if (runtime.elements.nibpTime) runtime.elements.nibpTime.textContent = history[0]?.time || '--:--';
}

function startNibpMeasurement(runtime, button) {
  if (!runtime || runtime.nibpMeasuring) return;
  runtime.nibpMeasuring = true;
  button.disabled = true;
  button.textContent = 'Measuring…';
  if (runtime.elements.nibpState) runtime.elements.nibpState.textContent = 'Cuff inflating…';
  window.setTimeout(() => {
    if (!runtime) return;
    const measured = measureNibp(runtime.targetValues);
    runtime.values.sbp = measured.sbp;
    runtime.values.dbp = measured.dbp;
    runtime.values.map = measured.map;
    runtime.nibpHistory = appendNibpHistory(runtime.nibpHistory, measured);
    runtime.nibpMeasuring = false;
    button.disabled = false;
    button.textContent = 'Start NIBP';
    if (runtime.elements.nibpState) runtime.elements.nibpState.textContent = 'Manual NIBP';
    renderAllNumerics(runtime);
    renderNibpHistory(runtime);
  }, 1600);
}

function updateAlarmState(runtime) {
  const panel = runtime.elements.alarm;
  if (!panel) return;
  const alarms = [];
  if (runtime.profile.rhythm === 'asystole') alarms.push(['red', 'ASYSTOLE']);
  else if (runtime.profile.rhythm === 'ventricular_tachycardia') alarms.push(['red', 'VENTRICULAR TACHYCARDIA']);
  if (runtime.values.spo2 < 90) alarms.push(['red', 'SpO₂ LOW']);
  else if (runtime.values.spo2 < 94) alarms.push(['yellow', 'SpO₂ LOW']);
  if (runtime.values.sbp < 90) alarms.push(['red', 'NIBP SYS LOW']);
  if (runtime.values.hr > 130) alarms.push(['yellow', 'HR HIGH']);
  const alarm = alarms[0];
  panel.className = `resus-monitor-alarm ${alarm ? `alarm-${alarm[0]}` : ''}`;
  const label = panel.querySelector('strong');
  if (label) label.textContent = alarm ? alarm[1] : 'No active alarm';
  if (alarm?.[0] === 'red' && runtime.soundEnabled) playAlarmTone(runtime);
}

async function tryEnableMonitorSound(runtime, container) {
  const button = container.querySelector('[data-monitor-sound]');
  const ok = await enableMonitorSound(runtime);
  if (!button) return;
  button.textContent = ok ? 'Sound on' : 'Enable sound';
  button.classList.toggle('active', ok);
  if (!ok) {
    // If browser policy blocks the initial resume, the first direct interaction
    // with the monitor retries inside an explicit user gesture.
    const retry = async () => {
      const retried = await enableMonitorSound(runtime);
      button.textContent = retried ? 'Sound on' : 'Enable sound';
      button.classList.toggle('active', retried);
      if (retried) container.removeEventListener('pointerdown', retry, true);
    };
    container.addEventListener('pointerdown', retry, true);
  }
}

async function enableMonitorSound(runtime) {
  try {
    await ensureAudioContext();
    runtime.soundEnabled = Boolean(audioContext && audioContext.state === 'running');
    return runtime.soundEnabled;
  } catch {
    runtime.soundEnabled = false;
    return false;
  }
}

async function ensureAudioContext() {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') await audioContext.resume();
}

function playPulseTone(spo2) {
  if (!audioContext || audioContext.state !== 'running') return;
  const now = audioContext.currentTime;
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const sat = clamp(Number(spo2 || 98), 70, 100);
  osc.frequency.value = 560 + (sat - 70) * 10.5;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.060, now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.085);
  osc.connect(gain).connect(audioContext.destination);
  osc.start(now); osc.stop(now + 0.090);
}

function playAlarmTone(runtime) {
  const nowMs = performance.now();
  if (nowMs - runtime.lastAlarmToneAt < 1400 || !audioContext || audioContext.state !== 'running') return;
  runtime.lastAlarmToneAt = nowMs;
  const now = audioContext.currentTime;
  [0, 0.18].forEach((offset) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.025, now + offset + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.11);
    osc.connect(gain).connect(audioContext.destination);
    osc.start(now + offset); osc.stop(now + offset + 0.12);
  });
}

function pulseNumeric(runtime, key) {
  const element = runtime.elements.numeric?.[key];
  if (!element) return;
  element.classList.remove('numeric-pulse');
  void element.offsetWidth;
  element.classList.add('numeric-pulse');
}

function updateMonitorClock(runtime) {
  if (runtime.elements.clock) runtime.elements.clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function channelColor(key) {
  if (key === 'ecg') return '#39e639';
  if (key === 'pleth') return '#f2df35';
  if (key === 'art') return '#ef4848';
  return '#f4f6f8';
}

function extractVitals(patientCase) {
  const vitals = patientCase?.vitals || {};
  const text = Object.values(vitals).join(' ');
  const bpText = vitals.bp || text;
  const bpMatch = String(bpText).match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
  return {
    hr: firstNumber(vitals.hr, 82),
    rr: firstNumber(vitals.rr, 16),
    spo2: firstNumber(vitals.spo2, 98),
    temp: firstNumber(vitals.temperature, 36.8),
    sbp: bpMatch ? Number(bpMatch[1]) : 125,
    dbp: bpMatch ? Number(bpMatch[2]) : 80
  };
}

function makeInitialNibpHistory(v) {
  const now = new Date();
  const map = Math.round(v.dbp + (v.sbp - v.dbp) / 3);
  return [{ time: now.toTimeString().slice(0, 5), sbp: Math.round(v.sbp), dbp: Math.round(v.dbp), map }];
}

function appendNibpHistory(history, measured) {
  const now = new Date();
  return [...history.slice(-4), { time: now.toTimeString().slice(0, 5), ...measured }];
}

function measureNibp(source) {
  const sbp = Math.round(Number(source.sbp || 120) + randomBetween(-3, 3));
  const dbp = Math.round(Number(source.dbp || 80) + randomBetween(-2, 2));
  return { sbp, dbp, map: Math.round(dbp + (sbp - dbp) / 3) };
}

/* Minimal single-canvas fallback retained for the old modal. */
function resizeLegacyCanvas(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(800, Math.round(rect.width || 1000));
  const height = Math.max(450, Math.round(rect.height || 560));
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  canvas._cssWidth = width; canvas._cssHeight = height;
  canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawLegacyPreview(canvas, runtime) {
  const ctx = canvas.getContext('2d');
  const w = canvas._cssWidth || canvas.clientWidth;
  const h = canvas._cssHeight || canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#050607'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#39e639'; ctx.font = '700 32px monospace'; ctx.fillText(`HR ${Math.round(runtime.values.hr)}`, 30, 50);
  ctx.fillStyle = '#f2df35'; ctx.fillText(`SpO₂ ${Math.round(runtime.values.spo2)}%`, 30, 100);
  ctx.fillStyle = '#ef4848'; ctx.fillText(`NIBP ${Math.round(runtime.values.sbp)}/${Math.round(runtime.values.dbp)}`, 30, 150);
  ctx.fillStyle = '#f4f6f8'; ctx.fillText(`RR ${Math.round(runtime.values.rr)}`, 30, 200);
}

function firstNumber(value, fallback) {
  const match = String(value || '').match(/\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(',', '.')) : fallback;
}
function setText(el, value) { if (el) el.textContent = String(value); }
function randomBetween(min, max) { return min + Math.random() * (max - min); }
function smoothStep(f) { const x = clamp(f, 0, 1); return x * x * (3 - 2 * x); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function escapeHtml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
