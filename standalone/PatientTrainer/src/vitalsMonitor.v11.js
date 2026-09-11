import { buildMonitorProfile, sampleEcgAt, samplePlethAt, sampleRespAt } from './monitorWaveforms.v11.js';

let monitorAnimation = null;
let monitorValueTimer = null;
let currentRuntime = null;
let embeddedAnimation = null;
let embeddedValueTimer = null;
let embeddedRuntime = null;
let embeddedResizeObserver = null;

const GENERIC_ECG_PATHS = [new URL('../ECGs/peter_novak_ecg.png', import.meta.url).href];

export function openVitalsMonitor(patientCase) {
  const modal = document.getElementById('vitalsMonitorModal');
  const canvas = document.getElementById('vitalsMonitorCanvas');
  const title = document.getElementById('vitalsMonitorTitle');
  if (!modal || !canvas) return;

  stopVitalsMonitor();
  const baseline = extractVitals(patientCase);
  currentRuntime = makeRuntime(baseline, patientCase);
  if (title) title.textContent = 'Live bedside monitor';
  modal.classList.add('visible');
  modal.setAttribute('aria-hidden', 'false');
  resizeModalCanvas(canvas);
  renderValuePanel(currentRuntime, patientCase);
  runModalLoop(canvas, patientCase);
}

export function mountEmbeddedVitalsMonitor(container, patientCase) {
  if (!container) return;
  stopEmbeddedVitalsMonitor();
  const baseline = extractVitals(patientCase);
  embeddedRuntime = makeRuntime(baseline, patientCase);
  embeddedRuntime.paused = false;

  container.innerHTML = `
    <div class="embedded-monitor-shell">
      <div class="embedded-monitor-topbar">
        <div><span class="monitor-status-dot"></span><strong>BED 03 · ADULT</strong></div>
        <div class="monitor-status-right"><span>Lead ${escapeHtml(embeddedRuntime.profile.displayLead)}</span><span>Room air</span><span data-monitor-clock></span></div>
      </div>
      <div class="embedded-monitor-screen-wrap">
        <canvas class="embedded-monitor-canvas" data-embedded-monitor-canvas aria-label="Live bedside patient monitor"></canvas>
      </div>
      <div class="embedded-monitor-note" data-embedded-monitor-note></div>
      <div class="embedded-monitor-controls">
        <button type="button" class="monitor-control-button" data-monitor-toggle>Pause</button>
        <button type="button" class="monitor-control-button primary" data-monitor-nibp>Start NIBP</button>
        <button type="button" class="monitor-control-button" data-monitor-trend-reset>Clear NIBP history</button>
      </div>
    </div>`;

  const canvas = container.querySelector('[data-embedded-monitor-canvas]');
  const note = container.querySelector('[data-embedded-monitor-note]');
  const clock = container.querySelector('[data-monitor-clock]');
  if (!canvas) return;

  resizeEmbeddedCanvas(canvas);
  renderMonitorNote(note, embeddedRuntime.values, patientCase);
  const draw = () => {
    if (!embeddedRuntime) return;
    if (clock) clock.textContent = new Date().toTimeString().slice(0, 8);
    drawMonitorCanvas(canvas, embeddedRuntime);
    embeddedAnimation = requestAnimationFrame(draw);
  };
  draw();

  embeddedValueTimer = window.setInterval(() => {
    if (!embeddedRuntime || embeddedRuntime.paused) return;
    embeddedRuntime.values = updateContinuousValues(embeddedRuntime);
    renderMonitorNote(note, embeddedRuntime.values, patientCase);
  }, 1100);

  if ('ResizeObserver' in window) {
    embeddedResizeObserver = new ResizeObserver(() => resizeEmbeddedCanvas(canvas));
    embeddedResizeObserver.observe(canvas.parentElement || canvas);
  }

  container.querySelector('[data-monitor-toggle]')?.addEventListener('click', (event) => {
    if (!embeddedRuntime) return;
    embeddedRuntime.paused = !embeddedRuntime.paused;
    event.currentTarget.textContent = embeddedRuntime.paused ? 'Resume' : 'Pause';
  });
  container.querySelector('[data-monitor-nibp]')?.addEventListener('click', (event) => {
    if (!embeddedRuntime) return;
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Measuring…';
    embeddedRuntime.nibpMeasuringUntil = performance.now() + 1500;
    window.setTimeout(() => {
      if (!embeddedRuntime) return;
      const measured = measureNibp(embeddedRuntime.baseline);
      embeddedRuntime.values.sbp = measured.sbp;
      embeddedRuntime.values.dbp = measured.dbp;
      embeddedRuntime.values.map = measured.map;
      embeddedRuntime.nibpHistory = appendNibpHistory(embeddedRuntime.nibpHistory, measured);
      embeddedRuntime.nibpMeasuringUntil = 0;
      button.disabled = false;
      button.textContent = 'Start NIBP';
      renderMonitorNote(note, embeddedRuntime.values, patientCase);
    }, 1500);
  });
  container.querySelector('[data-monitor-trend-reset]')?.addEventListener('click', () => {
    if (!embeddedRuntime) return;
    embeddedRuntime.nibpHistory = [];
  });
}

export function stopEmbeddedVitalsMonitor() {
  if (embeddedAnimation) cancelAnimationFrame(embeddedAnimation);
  if (embeddedValueTimer) clearInterval(embeddedValueTimer);
  try { embeddedResizeObserver?.disconnect?.(); } catch {}
  embeddedAnimation = null;
  embeddedValueTimer = null;
  embeddedResizeObserver = null;
  embeddedRuntime = null;
}

export function stopVitalsMonitor() {
  if (monitorAnimation) cancelAnimationFrame(monitorAnimation);
  if (monitorValueTimer) clearInterval(monitorValueTimer);
  monitorAnimation = null;
  monitorValueTimer = null;
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
  const canvas = document.getElementById('vitalsMonitorCanvas');
  const modal = document.getElementById('vitalsMonitorModal');
  if (canvas && modal?.classList.contains('visible')) resizeModalCanvas(canvas);
}

function runModalLoop(canvas, patientCase) {
  const draw = () => {
    if (!currentRuntime) return;
    drawMonitorCanvas(canvas, currentRuntime);
    monitorAnimation = requestAnimationFrame(draw);
  };
  draw();
  monitorValueTimer = window.setInterval(() => {
    if (!currentRuntime) return;
    currentRuntime.values = updateContinuousValues(currentRuntime);
    renderValuePanel(currentRuntime, patientCase);
  }, 1100);
}

function makeRuntime(baseline, patientCase) {
  const profile = buildMonitorProfile(patientCase, baseline);
  const values = {
    ...baseline,
    map: Math.round(baseline.dbp + (baseline.sbp - baseline.dbp) / 3)
  };
  return {
    start: performance.now(),
    baseline,
    values,
    profile,
    patientCase,
    nibpHistory: makeInitialNibpHistory(values),
    nibpMeasuringUntil: 0,
    paused: false
  };
}

function extractVitals(patientCase) {
  const vitals = patientCase?.vitals || {};
  const bpMatch = String(vitals.bp || '').match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
  return {
    hr: firstNumber(vitals.hr, 80),
    rr: firstNumber(vitals.rr, 16),
    spo2: firstNumber(vitals.spo2, 98),
    temp: firstNumber(vitals.temperature, 36.8),
    sbp: bpMatch ? Number(bpMatch[1]) : 125,
    dbp: bpMatch ? Number(bpMatch[2]) : 80
  };
}

function updateContinuousValues(runtime) {
  const b = runtime.baseline;
  const profile = runtime.profile;
  const rhythm = profile.rhythm;
  const hrNoise = rhythm === 'atrial_fibrillation' ? randomBetween(-7, 8) : randomBetween(-2, 2);
  return {
    ...runtime.values,
    hr: clamp(Math.round(b.hr + hrNoise), 25, 220),
    rr: clamp(Math.round(b.rr + randomBetween(-1, 1)), 4, 50),
    spo2: clamp(Math.round(b.spo2 + randomBetween(-0.6, 0.6)), 70, 100),
    temp: Math.round((b.temp + randomBetween(-0.08, 0.08)) * 10) / 10
  };
}

function measureNibp(baseline) {
  const sbp = clamp(Math.round(baseline.sbp + randomBetween(-4, 4)), 70, 240);
  const dbp = clamp(Math.round(baseline.dbp + randomBetween(-3, 3)), 40, 140);
  return { sbp, dbp, map: Math.round(dbp + (sbp - dbp) / 3), time: new Date().toTimeString().slice(0, 5) };
}

function makeInitialNibpHistory(values) {
  const now = Date.now();
  return Array.from({ length: 4 }, (_, i) => {
    const t = new Date(now - (3 - i) * 5 * 60_000);
    const sbp = Math.round(values.sbp + randomBetween(-3, 3));
    const dbp = Math.round(values.dbp + randomBetween(-2, 2));
    return { time: t.toTimeString().slice(0, 5), sbp, dbp, map: Math.round(dbp + (sbp - dbp) / 3) };
  });
}

function appendNibpHistory(history, measured) {
  return [...(Array.isArray(history) ? history : []), measured].slice(-5);
}

function resizeEmbeddedCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const box = canvas.getBoundingClientRect();
  const width = Math.max(720, Math.floor(box.width || 1100));
  const height = clamp(Math.round(window.innerHeight * 0.48), 340, 500);
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function resizeModalCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const box = canvas.getBoundingClientRect();
  const width = Math.max(760, Math.floor(box.width || 1100));
  const height = clamp(Math.round(window.innerHeight * 0.58), 390, 580);
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function drawMonitorCanvas(canvas, runtime) {
  const ctx = canvas.getContext('2d');
  const width = canvas.clientWidth || 1100;
  const height = canvas.clientHeight || 440;
  const nowSec = (performance.now() - runtime.start) / 1000;
  const v = runtime.values;

  ctx.clearRect(0, 0, width, height);
  const bezel = 10;
  const screenX = bezel + 6;
  const screenY = bezel + 6;
  const screenW = width - (bezel + 6) * 2;
  const screenH = height - (bezel + 6) * 2;
  drawBezel(ctx, width, height);
  roundedRect(ctx, screenX, screenY, screenW, screenH, 9, '#020504', '#34414c', 1.5);

  const headerH = 34;
  const historyH = clamp(screenH * 0.16, 58, 76);
  const contentTop = screenY + headerH;
  const contentBottom = screenY + screenH - historyH;
  const panelX = screenX + screenW * 0.73;
  const waveLeft = screenX + 10;
  const waveRight = panelX - 10;
  const waveW = waveRight - waveLeft;
  const waveH = contentBottom - contentTop;
  const rowH = waveH / 3;

  drawHeader(ctx, screenX, screenY, screenW, runtime);
  drawWaveGrid(ctx, waveLeft, contentTop, waveW, waveH);
  drawSeparator(ctx, panelX, contentTop, contentBottom);

  const profile = { ...runtime.profile, hr: v.hr, rr: v.rr };
  const frozenTime = runtime.paused ? runtime.pausedAtSec ?? nowSec : nowSec;
  if (runtime.paused && runtime.pausedAtSec == null) runtime.pausedAtSec = nowSec;
  if (!runtime.paused) runtime.pausedAtSec = null;

  drawWaveRow(ctx, {
    x: waveLeft, y: contentTop, w: waveW, h: rowH,
    label: `${profile.displayLead}  x1`, color: '#55ff42',
    seconds: 6.4, now: frozenTime,
    sampler: (t) => sampleEcgAt(t, profile), amplitude: rowH * 0.30,
    baselineOffset: 0.06
  });
  drawCalibrationPulse(ctx, waveRight - 44, contentTop + rowH * 0.20, rowH * 0.38, '#55ff42');

  drawWaveRow(ctx, {
    x: waveLeft, y: contentTop + rowH, w: waveW, h: rowH,
    label: 'PLETH', color: '#35dfff', seconds: 6.4, now: frozenTime,
    sampler: (t) => samplePlethAt(t, profile), amplitude: rowH * 0.42,
    baselineOffset: 0.10
  });

  drawWaveRow(ctx, {
    x: waveLeft, y: contentTop + rowH * 2, w: waveW, h: rowH,
    label: 'RESP', color: '#f4e62a', seconds: 12.0, now: frozenTime,
    sampler: (t) => sampleRespAt(t, profile), amplitude: rowH * 0.34,
    baselineOffset: 0
  });

  drawNumericPanel(ctx, panelX, contentTop, screenX + screenW, contentBottom, v, runtime);
  drawNibpHistory(ctx, screenX, contentBottom, screenX + screenW, screenY + screenH, runtime.nibpHistory, runtime.nibpMeasuringUntil);
}

function drawBezel(ctx, width, height) {
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, '#2b3540');
  g.addColorStop(0.18, '#161e27');
  g.addColorStop(1, '#10161d');
  roundedRect(ctx, 0, 0, width, height, 18, g, '#455563', 2);
  ctx.strokeStyle = 'rgba(255,255,255,.08)';
  ctx.strokeRect(9, 9, width - 18, height - 18);
}

function drawHeader(ctx, x, y, w, runtime) {
  ctx.fillStyle = '#0a100f';
  ctx.fillRect(x, y, w, 34);
  ctx.strokeStyle = '#26342f';
  ctx.beginPath(); ctx.moveTo(x, y + 34); ctx.lineTo(x + w, y + 34); ctx.stroke();
  ctx.font = '600 13px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#e9f1ee';
  ctx.fillText('BED 03', x + 14, y + 21);
  ctx.fillText('ADULT', x + 80, y + 21);
  ctx.fillStyle = '#8da39b';
  ctx.fillText(`ECG ${runtime.profile.displayLead}`, x + w * 0.38, y + 21);
  ctx.fillText(new Date().toTimeString().slice(0, 8), x + w * 0.56, y + 21);
  ctx.fillStyle = '#55ff42';
  ctx.beginPath(); ctx.arc(x + w - 24, y + 17, 5, 0, Math.PI * 2); ctx.fill();
}

function drawWaveGrid(ctx, x, y, w, h) {
  ctx.save();
  ctx.fillStyle = '#020604';
  ctx.fillRect(x, y, w, h);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(41,75,57,.22)';
  for (let gx = x; gx <= x + w; gx += 20) { ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); ctx.stroke(); }
  for (let gy = y; gy <= y + h; gy += 20) { ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(55,102,75,.30)';
  for (let gx = x; gx <= x + w; gx += 100) { ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); ctx.stroke(); }
  for (let gy = y; gy <= y + h; gy += 100) { ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); ctx.stroke(); }
  ctx.restore();
}

function drawWaveRow(ctx, { x, y, w, h, label, color, seconds, now, sampler, amplitude, baselineOffset }) {
  const baseline = y + h * (0.56 + baselineOffset);
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.font = '700 13px ui-monospace, monospace';
  ctx.fillStyle = color;
  ctx.fillText(label, x + 8, y + 17);
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 4;
  ctx.beginPath();
  const step = 1.5;
  for (let px = 0; px <= w; px += step) {
    const t = now - seconds + (px / w) * seconds;
    const value = sampler(t);
    const py = baseline - value * amplitude;
    if (px === 0) ctx.moveTo(x + px, py); else ctx.lineTo(x + px, py);
  }
  ctx.stroke();
  ctx.restore();
}

function drawCalibrationPulse(ctx, x, y, h, color) {
  const step = h * 0.42;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x, y + h); ctx.lineTo(x + 6, y + h); ctx.lineTo(x + 6, y + h - step); ctx.lineTo(x + 18, y + h - step); ctx.lineTo(x + 18, y + h); ctx.lineTo(x + 24, y + h);
  ctx.stroke();
  ctx.fillStyle = color; ctx.font = '9px ui-monospace, monospace'; ctx.fillText('1 mV', x - 2, y + h + 11);
}

function drawSeparator(ctx, x, top, bottom) {
  ctx.strokeStyle = '#33433e';
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
}

function drawNumericPanel(ctx, x, top, right, bottom, v, runtime) {
  const w = right - x;
  const h = bottom - top;
  const rows = [0, 0.24, 0.50, 0.75, 1].map(f => top + h * f);
  rows.slice(1, -1).forEach((yy) => {
    ctx.strokeStyle = '#273730'; ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(right, yy); ctx.stroke();
  });
  drawNumericBlock(ctx, x, rows[0], w, rows[1] - rows[0], 'HR', String(v.hr), 'bpm', '#55ff42', '50   120');
  drawNibpBlock(ctx, x, rows[1], w, rows[2] - rows[1], v, runtime);
  drawSpo2Block(ctx, x, rows[2], w, rows[3] - rows[2], v);

  const lastH = rows[4] - rows[3];
  ctx.fillStyle = '#f4e62a'; ctx.font = '700 12px ui-monospace, monospace'; ctx.fillText('RESP', x + 10, rows[3] + 18);
  ctx.font = `800 ${Math.max(28, Math.min(40, lastH * 0.48))}px ui-monospace, monospace`; ctx.fillText(String(v.rr), x + 14, rows[3] + lastH * 0.68);
  ctx.fillStyle = '#d8e0de'; ctx.font = '700 11px ui-monospace, monospace'; ctx.fillText('TEMP', x + w * 0.52, rows[3] + 18);
  ctx.font = `800 ${Math.max(22, Math.min(30, lastH * 0.38))}px ui-monospace, monospace`; ctx.fillText(v.temp.toFixed(1), x + w * 0.52, rows[3] + lastH * 0.66);
  ctx.font = '600 9px ui-monospace, monospace'; ctx.fillText('/min', x + 54, rows[3] + lastH * 0.68); ctx.fillText('°C', x + w * 0.82, rows[3] + lastH * 0.66);
}

function drawNumericBlock(ctx, x, y, w, h, label, value, unit, color, limits) {
  ctx.fillStyle = color;
  ctx.font = '700 12px ui-monospace, monospace';
  ctx.fillText(label, x + 10, y + 18);
  ctx.font = '600 9px ui-monospace, monospace';
  if (unit) ctx.fillText(unit, x + Math.max(48, w * 0.42), y + 17);
  if (limits) ctx.fillText(limits, x + w - 68, y + 17);
  const valueSize = Math.max(30, Math.min(55, h * 0.54));
  ctx.font = `800 ${valueSize}px ui-monospace, monospace`;
  ctx.fillText(value, x + 14, y + h * 0.76);
}

function drawNibpBlock(ctx, x, y, w, h, v, runtime) {
  const map = v.map ?? Math.round(v.dbp + (v.sbp - v.dbp) / 3);
  ctx.fillStyle = '#ff5a4f';
  ctx.font = '700 12px ui-monospace, monospace';
  ctx.fillText('NIBP', x + 10, y + 18);
  ctx.font = '600 9px ui-monospace, monospace';
  ctx.fillText('mmHg', x + Math.max(55, w * 0.36), y + 17);
  if (runtime.nibpMeasuringUntil > performance.now()) ctx.fillText('MEASURING', x + w - 68, y + 17);
  const valueSize = Math.max(27, Math.min(45, h * 0.47));
  ctx.font = `800 ${valueSize}px ui-monospace, monospace`;
  ctx.fillText(`${v.sbp}/${v.dbp}`, x + 14, y + h * 0.67);
  ctx.font = '700 11px ui-monospace, monospace';
  ctx.fillStyle = '#ff8a82';
  ctx.fillText(`MAP ${map}`, x + 15, y + h * 0.88);
}

function drawSpo2Block(ctx, x, y, w, h, v) {
  ctx.fillStyle = '#35dfff';
  ctx.font = '700 12px ui-monospace, monospace';
  ctx.fillText('SpO₂', x + 10, y + 18);
  ctx.font = '600 9px ui-monospace, monospace';
  ctx.fillText('%', x + Math.max(52, w * 0.31), y + 17);
  ctx.fillText('90   100', x + w - 68, y + 17);
  const valueSize = Math.max(30, Math.min(50, h * 0.50));
  ctx.font = `800 ${valueSize}px ui-monospace, monospace`;
  ctx.fillText(String(v.spo2), x + 14, y + h * 0.66);
  ctx.font = '700 10px ui-monospace, monospace';
  ctx.fillText(`PR ${v.hr}`, x + 15, y + h * 0.88);
}

function drawNibpHistory(ctx, left, top, right, bottom, history, measuringUntil) {
  ctx.fillStyle = '#07100d';
  ctx.fillRect(left, top, right - left, bottom - top);
  ctx.strokeStyle = '#33433e'; ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(right, top); ctx.stroke();
  ctx.fillStyle = '#b8c5c0'; ctx.font = '700 10px ui-monospace, monospace'; ctx.fillText('NIBP TREND', left + 10, top + 16);
  if (measuringUntil > performance.now()) { ctx.fillStyle = '#f3d56a'; ctx.fillText('CUFF CYCLING…', left + 86, top + 16); }
  const items = Array.isArray(history) ? history.slice(-5) : [];
  if (!items.length) {
    ctx.fillStyle = '#64776f'; ctx.font = '600 10px ui-monospace, monospace'; ctx.fillText('No measurements recorded', left + 10, top + 38); return;
  }
  const startX = left + 100;
  const available = right - startX - 8;
  const colW = available / items.length;
  items.forEach((item, i) => {
    const x = startX + i * colW;
    ctx.fillStyle = '#8ea39a'; ctx.font = '600 9px ui-monospace, monospace'; ctx.fillText(item.time, x, top + 18);
    ctx.fillStyle = '#ff6a60'; ctx.font = '700 12px ui-monospace, monospace'; ctx.fillText(`${item.sbp}/${item.dbp}`, x, top + 38);
    ctx.fillStyle = '#a8b8b0'; ctx.font = '600 9px ui-monospace, monospace'; ctx.fillText(`MAP ${item.map}`, x, top + 53);
  });
}

function renderMonitorNote(note, v, patientCase) {
  if (!note) return;
  const parts = [];
  if (v.hr > 100) parts.push('tachycardia');
  if (v.sbp >= 140 || v.dbp >= 90) parts.push('elevated NIBP');
  if (v.spo2 < 94) parts.push('reduced SpO₂');
  if (v.rr > 22) parts.push('tachypnoea');
  note.textContent = `Live monitor · ${parts.length ? parts.join(' · ') : 'stable current parameters'} · ECG lead ${patientCase?.monitorProfile?.displayLead || 'II'}`;
}

function renderValuePanel(runtime, patientCase) {
  const panel = document.getElementById('vitalsValues');
  const note = document.getElementById('vitalsClinicalNote');
  if (panel) {
    const v = runtime.values;
    panel.innerHTML = [
      valueTile('HR', v.hr, '/min'), valueTile('NIBP', `${v.sbp}/${v.dbp}`, 'mmHg'), valueTile('SpO₂', v.spo2, '%'), valueTile('RR', v.rr, '/min'), valueTile('Temp', v.temp.toFixed(1), '°C')
    ].join('');
  }
  renderMonitorNote(note, runtime.values, patientCase);
}

function valueTile(label, value, unit) { return `<div class="vital-tile"><span>${label}</span><strong>${value}</strong><small>${unit}</small></div>`; }
function firstNumber(value, fallback) { const m = String(value || '').match(/\d+(?:[.,]\d+)?/); return m ? Number(m[0].replace(',', '.')) : fallback; }
function randomBetween(min, max) { return min + Math.random() * (max - min); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function roundedRect(ctx, x, y, w, h, r, fill, stroke, lineWidth = 1) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
}
function escapeHtml(value) { return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
