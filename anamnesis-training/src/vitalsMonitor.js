let monitorAnimation = null;
let monitorValueTimer = null;
let currentRuntime = null;

const GENERIC_ECG_PATHS = [new URL('../ECGs/peter_novak_ecg.png', import.meta.url).href];

export function openVitalsMonitor(patientCase) {
  const modal = document.getElementById('vitalsMonitorModal');
  const canvas = document.getElementById('vitalsMonitorCanvas');
  const title = document.getElementById('vitalsMonitorTitle');
  if (!modal || !canvas) return;

  stopVitalsMonitor();
  const baseline = extractVitals(patientCase);
  currentRuntime = makeRuntime(baseline, patientCase);
  if (title) title.textContent = `Live vitals monitor`;
  modal.classList.add('visible');
  modal.setAttribute('aria-hidden', 'false');
  resizeCanvas(canvas);
  renderValuePanel(currentRuntime, baseline, patientCase);

  const draw = () => {
    if (!currentRuntime) return;
    drawMonitorCanvas(canvas, currentRuntime);
    monitorAnimation = requestAnimationFrame(draw);
  };
  draw();
  monitorValueTimer = window.setInterval(() => {
    if (!currentRuntime) return;
    currentRuntime.values = jitterValues(baseline);
    currentRuntime.nibpHistory = updateNibpHistory(currentRuntime.nibpHistory, currentRuntime.values);
    renderValuePanel(currentRuntime, baseline, patientCase);
  }, 1400);
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
  const label = patientCase?.ecg?.label || 'ECG recording';
  if (title) title.textContent = label;

  const sources = [];
  if (patientCase?.ecg?.imagePath) sources.push(patientCase.ecg.imagePath);
  sources.push(...GENERIC_ECG_PATHS.filter((item) => !sources.includes(item)));
  let index = 0;
  fallback.hidden = true;
  img.hidden = false;
  img.onerror = () => {
    index += 1;
    if (index < sources.length) {
      img.src = `${sources[index]}?v=${Date.now()}`;
    } else {
      img.hidden = true;
      fallback.hidden = false;
    }
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
  if (canvas && modal?.classList.contains('visible')) resizeCanvas(canvas);
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

function firstNumber(value, fallback) {
  const match = String(value || '').match(/\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(',', '.')) : fallback;
}

function makeRuntime(baseline, patientCase) {
  const startValues = jitterValues(baseline);
  return {
    start: performance.now(),
    values: startValues,
    baseline,
    patientCase,
    rhythmSeed: Math.random() * 1000,
    nibpHistory: makeNibpHistory(startValues)
  };
}

function makeNibpHistory(v) {
  const now = new Date();
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(now.getTime() - (4 - i) * 3 * 60 * 1000);
    const drift = (i - 4) * 2;
    return { time: d.toTimeString().slice(0, 5), sbp: clamp(v.sbp + drift + Math.round(randomBetween(-2, 2)), 70, 240), dbp: clamp(v.dbp + Math.round(drift / 2) + Math.round(randomBetween(-2, 2)), 40, 140) };
  });
}

function updateNibpHistory(history, v) {
  if (!history?.length) return makeNibpHistory(v);
  const copy = history.slice();
  const now = new Date();
  copy[copy.length - 1] = { time: now.toTimeString().slice(0, 5), sbp: v.sbp, dbp: v.dbp };
  return copy;
}

function jitterValues(b) {
  return {
    hr: clamp(Math.round(b.hr + randomBetween(-2, 3)), 35, 180),
    rr: clamp(Math.round(b.rr + randomBetween(-1, 1)), 6, 45),
    spo2: clamp(Math.round(b.spo2 + randomBetween(-1, 1)), 70, 100),
    temp: Math.round((b.temp + randomBetween(-0.1, 0.1)) * 10) / 10,
    sbp: clamp(Math.round(b.sbp + randomBetween(-4, 4)), 70, 240),
    dbp: clamp(Math.round(b.dbp + randomBetween(-3, 3)), 40, 140)
  };
}

function randomBetween(min, max) { return min + Math.random() * (max - min); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function resizeCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const box = canvas.getBoundingClientRect();
  const width = Math.max(1000, Math.floor(box.width));
  const height = Math.max(560, Math.floor(box.height));
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function drawMonitorCanvas(canvas, runtime) {
  const ctx = canvas.getContext('2d');
  const width = canvas.clientWidth || 1280;
  const height = canvas.clientHeight || 720;
  const now = performance.now();
  const t = (now - runtime.start) / 1000;
  const v = runtime.values;
  const left = 26;
  const top = 22;
  const right = width - 26;
  const bottom = height - 26;
  const panelX = Math.floor(width * 0.735);
  const waveRight = panelX - 22;
  const footerY = bottom - 94;

  ctx.clearRect(0, 0, width, height);
  drawBezel(ctx, width, height);
  drawScreen(ctx, left, top, right - left, bottom - top);
  drawHeader(ctx, left, top, right, runtime.patientCase);
  drawPanelLines(ctx, panelX, top + 42, right, bottom - 78, footerY);
  drawWaveLabels(ctx, left, top);

  const waveW = waveRight - left - 14;
  const hr = v.hr || runtime.baseline.hr || 80;
  const rr = v.rr || runtime.baseline.rr || 16;
  const spo2 = v.spo2 || runtime.baseline.spo2 || 98;

  drawTrace(ctx, left + 12, top + 122, waveW, 64, '#39ff14', (x) => ecgWave((x / 120) + t * (hr / 60) + runtime.rhythmSeed), 2.3);
  drawMvScale(ctx, waveRight - 32, top + 114);
  drawTrace(ctx, left + 12, top + 282, waveW, 50, '#43e9ff', (x) => plethWave((x / 165) + t * (hr / 64), spo2), 2.4);
  drawTrace(ctx, left + 12, top + 430, waveW * 0.88, 46, '#fff400', (x) => respWave((x / 260) + t * (rr / 60)), 2.2);
  drawNibpHistory(ctx, left, footerY, waveRight, bottom, runtime.nibpHistory);
  drawRightValues(ctx, panelX, top + 48, right, bottom - 78, v);
  drawFooterButtons(ctx, left, bottom - 68, right, bottom);
}

function drawBezel(ctx, width, height) {
  const r = 20;
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, '#111827');
  g.addColorStop(0.5, '#06080c');
  g.addColorStop(1, '#1f2937');
  roundedRect(ctx, 0, 0, width, height, r, g, '#2b3038', 3);
  roundedRect(ctx, 16, 14, width - 32, height - 28, 16, '#000', '#141a22', 2);
}

function drawScreen(ctx, x, y, w, h) {
  const g = ctx.createRadialGradient(x + w * 0.5, y + h * 0.4, 10, x + w * 0.5, y + h * 0.45, w * 0.65);
  g.addColorStop(0, '#050b08');
  g.addColorStop(1, '#000');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#1f2937';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
}

function drawHeader(ctx, left, top, right, patientCase) {
  const time = new Date().toTimeString().slice(0, 8);
  ctx.strokeStyle = '#46515c';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(left + 10, top + 58); ctx.lineTo(right - 10, top + 58); ctx.stroke();
  ctx.font = '700 20px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#f3f4f6';
  ctx.fillText('OR 3', left + 38, top + 38);
  ctx.fillText('ADULT', left + 140, top + 38);
  ctx.fillText(time, (left + right) / 2 - 34, top + 38);
  ctx.fillText(patientCase?.monitorUnit || 'ICU', right - 126, top + 38);
  ctx.fillStyle = '#39ff14';
  ctx.fillRect(right - 70, top + 26, 20, 10);
  ctx.strokeStyle = '#94a3b8';
  ctx.strokeRect(right - 74, top + 22, 28, 18);
}

function drawPanelLines(ctx, panelX, top, right, bottom, footerY) {
  ctx.strokeStyle = '#3b4651';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(panelX, top - 28); ctx.lineTo(panelX, footerY); ctx.stroke();
  [top + 155, top + 305, top + 420, bottom].forEach((y) => { ctx.beginPath(); ctx.moveTo(panelX, y); ctx.lineTo(right - 8, y); ctx.stroke(); });
}

function drawWaveLabels(ctx, left, top) {
  ctx.font = '700 20px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#39ff14'; ctx.fillText('II', left + 30, top + 112); ctx.fillText('x1.0', left + 118, top + 112); ctx.fillText('MON', left + 198, top + 112);
  ctx.fillStyle = '#43e9ff'; ctx.fillText('PLETH', left + 30, top + 246);
  ctx.fillStyle = '#fff400'; ctx.fillText('RESP', left + 30, top + 388);
}

function drawMvScale(ctx, x, y) {
  ctx.strokeStyle = '#39ff14';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 8, y); ctx.moveTo(x + 4, y); ctx.lineTo(x + 4, y + 64); ctx.moveTo(x, y + 64); ctx.lineTo(x + 8, y + 64); ctx.stroke();
  ctx.fillStyle = '#39ff14'; ctx.font = '14px ui-monospace, monospace'; ctx.fillText('1mV', x + 12, y + 36);
}

function drawTrace(ctx, x0, baselineY, width, amplitude, color, fn, lineWidth = 2) {
  ctx.save();
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  for (let x = 0; x <= width; x += 2) {
    const y = baselineY - fn(x) * amplitude;
    if (x === 0) ctx.moveTo(x0 + x, y); else ctx.lineTo(x0 + x, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawNibpHistory(ctx, left, y, waveRight, bottom, history) {
  ctx.strokeStyle = '#3b4651'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(waveRight, y); ctx.stroke();
  ctx.fillStyle = '#d1d5db'; ctx.font = '18px ui-monospace, monospace'; ctx.fillText('NIBP LIST', left + 20, y + 28);
  const startX = left + 142;
  const gap = Math.max(118, (waveRight - startX - 70) / 5);
  history.forEach((item, i) => {
    const x = startX + i * gap;
    const map = Math.round(item.dbp + (item.sbp - item.dbp) / 3);
    ctx.fillStyle = '#d1d5db'; ctx.fillText(item.time, x, y + 28);
    ctx.fillStyle = classifyBP(item.sbp, item.dbp) === 'crit' ? '#ff4040' : '#ff3b30';
    ctx.fillText(`${item.sbp}/${item.dbp} (${map})`, x, y + 56);
  });
}

function drawRightValues(ctx, panelX, top, right, bottom, v) {
  const x = panelX + 22;
  const map = Math.round(v.dbp + (v.sbp - v.dbp) / 3);
  const lowHr = v.hr < 50;
  const highHr = v.hr > 110;
  const lowBp = v.sbp < 90;
  ctx.font = '700 22px ui-monospace, monospace';
  ctx.fillStyle = '#39ff14'; ctx.fillText('HR', x, top + 20); ctx.font = '700 16px ui-monospace, monospace'; ctx.fillText('bpm', x + 100, top + 20); ctx.fillText('50 120', right - 96, top + 18);
  ctx.font = '900 86px ui-monospace, monospace'; ctx.fillText(String(v.hr), x + 34, top + 126);
  ctx.font = '700 16px ui-monospace, monospace'; if (lowHr || highHr) { ctx.fillStyle = '#ff3b30'; ctx.fillText(lowHr ? 'LOW HR' : 'HIGH HR', x + 174, top + 124); drawHeartIcon(ctx, x + 186, top + 86); }

  ctx.fillStyle = '#ff3b30'; ctx.font = '700 24px ui-monospace, monospace'; ctx.fillText('NIBP', x, top + 188); ctx.font = '700 16px ui-monospace, monospace'; ctx.fillText('mmHg', x + 94, top + 184);
  ctx.font = '900 62px ui-monospace, monospace'; ctx.fillText(`${v.sbp}/${v.dbp}`, x + 28, top + 264); ctx.font = '900 36px ui-monospace, monospace'; ctx.fillText(`(${map})`, right - 95, top + 256);
  ctx.font = '700 18px ui-monospace, monospace'; ctx.fillText('MAP', x + 20, top + 296); if (lowBp) ctx.fillText('LOW BP', right - 126, top + 296);

  ctx.fillStyle = '#43e9ff'; ctx.font = '700 22px ui-monospace, monospace'; ctx.fillText('SpO₂', x, top + 342); ctx.font = '700 16px ui-monospace, monospace'; ctx.fillText('%', x + 105, top + 342); ctx.fillText('90 100', right - 96, top + 340);
  ctx.font = '900 54px ui-monospace, monospace'; ctx.fillText(String(v.spo2), x + 36, top + 408); drawBarStack(ctx, right - 60, top + 364, '#43e9ff');
  ctx.font = '700 20px ui-monospace, monospace'; ctx.fillText('PR', x, top + 456); ctx.fillText('/min', x + 86, top + 456); ctx.fillText('50 120', right - 96, top + 454); ctx.font = '900 52px ui-monospace, monospace'; ctx.fillText(String(v.hr), x + 36, top + 520);
  ctx.fillStyle = '#d1d5db'; ctx.font = '700 22px ui-monospace, monospace'; ctx.fillText('TEMP', x, bottom - 34); ctx.fillText('°C', x + 92, bottom - 34); ctx.font = '900 40px ui-monospace, monospace'; ctx.fillText(v.temp.toFixed(1), x + 130, bottom - 20);
  ctx.fillStyle = '#fff400'; ctx.font = '900 36px ui-monospace, monospace'; ctx.fillText(String(v.rr), panelX - 105, top + 392); ctx.font = '700 18px ui-monospace, monospace'; ctx.fillText('RESP', panelX - 58, top + 378); ctx.fillText('/min', panelX - 56, top + 402);
}

function drawFooterButtons(ctx, left, y, right, bottom) {
  const labels = ['ALARM\nRESET', 'NIBP\nSTART/STOP', 'REVIEW', 'TREND', 'ZERO\nALL', 'ALARMS\nSETUP', 'MENU'];
  const gap = 4;
  const w = (right - left - gap * (labels.length - 1)) / labels.length;
  labels.forEach((label, i) => {
    const x = left + i * (w + gap);
    const g = ctx.createLinearGradient(0, y, 0, bottom);
    g.addColorStop(0, i === 0 ? '#1948a8' : '#121820');
    g.addColorStop(1, i === 0 ? '#0a2470' : '#05080c');
    roundedRect(ctx, x, y, w, bottom - y - 10, 8, g, '#1f2937', 1);
    ctx.fillStyle = '#d1d5db'; ctx.font = '700 14px ui-monospace, monospace';
    label.split('\n').forEach((line, j) => ctx.fillText(line, x + w * 0.46, y + 26 + j * 18));
  });
}

function drawHeartIcon(ctx, x, y) {
  ctx.save(); ctx.fillStyle = '#ff3b30'; ctx.beginPath(); ctx.moveTo(x, y + 10); ctx.bezierCurveTo(x - 20, y - 8, x - 36, y + 18, x, y + 38); ctx.bezierCurveTo(x + 36, y + 18, x + 20, y - 8, x, y + 10); ctx.fill(); ctx.restore();
}
function drawBarStack(ctx, x, y, color) { ctx.fillStyle = color; for (let i = 0; i < 6; i++) ctx.fillRect(x, y + i * 10, 18, 5); }

function roundedRect(ctx, x, y, w, h, r, fill, stroke, lineWidth = 1) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
}

function ecgWave(t) {
  const p = ((t % 1) + 1) % 1;
  return gaussian(p, 0.14, 0.025) * 0.12 - gaussian(p, 0.265, 0.012) * 0.18 + gaussian(p, 0.295, 0.009) * 1.15 - gaussian(p, 0.325, 0.012) * 0.35 + gaussian(p, 0.58, 0.06) * 0.32 + Math.sin(t * 34) * 0.01;
}
function plethWave(t, spo2) {
  const p = ((t % 1) + 1) % 1;
  const quality = spo2 < 92 ? 0.82 : 1;
  const upstroke = Math.exp(-Math.pow((p - 0.18) / 0.08, 2));
  const dicrotic = Math.exp(-Math.pow((p - 0.48) / 0.06, 2)) * 0.28;
  const decay = Math.max(0, 1 - p) * 0.38;
  return quality * (upstroke + dicrotic + decay - 0.18) + Math.sin(t * 20) * 0.015;
}
function respWave(t) { return Math.sin(t * Math.PI * 2) * 0.82 + Math.sin(t * Math.PI * 4) * 0.08; }
function gaussian(x, mu, sigma) { return Math.exp(-Math.pow(x - mu, 2) / (2 * sigma * sigma)); }

function renderValuePanel(runtime, baseline, patientCase) {
  const panel = document.getElementById('vitalsValues');
  const note = document.getElementById('vitalsClinicalNote');
  if (!panel) return;
  const v = runtime.values;
  panel.innerHTML = [
    valueTile('HR', `${v.hr}`, '/min', classifyHR(v.hr)),
    valueTile('BP', `${v.sbp}/${v.dbp}`, 'mmHg', classifyBP(v.sbp, v.dbp)),
    valueTile('SpO₂', `${v.spo2}`, '%', classifySpO2(v.spo2)),
    valueTile('RR', `${v.rr}`, '/min', classifyRR(v.rr)),
    valueTile('Temp', `${v.temp.toFixed(1)}`, '°C', classifyTemp(v.temp))
  ].join('');
  if (note) note.textContent = buildClinicalMonitorNote(v, patientCase);
}
function valueTile(label, value, unit, status) { return `<div class="vital-tile ${status}"><span>${label}</span><strong>${value}</strong><small>${unit}</small></div>`; }
function classifyHR(hr) { return hr > 100 ? 'warn' : hr < 50 ? 'warn' : 'ok'; }
function classifyBP(sbp, dbp) { return sbp >= 140 || dbp >= 90 ? 'warn' : sbp < 90 ? 'crit' : 'ok'; }
function classifySpO2(spo2) { return spo2 < 90 ? 'crit' : spo2 < 94 ? 'warn' : 'ok'; }
function classifyRR(rr) { return rr > 22 || rr < 10 ? 'warn' : 'ok'; }
function classifyTemp(temp) { return temp >= 38 ? 'warn' : temp < 35.5 ? 'warn' : 'ok'; }
function buildClinicalMonitorNote(v, patientCase) {
  const parts = [];
  if (v.hr > 100) parts.push('tachycardic');
  if (v.sbp >= 140 || v.dbp >= 90) parts.push('hypertensive range');
  if (v.spo2 < 94) parts.push('reduced oxygen saturation');
  if (v.rr > 22) parts.push('tachypnoea');
  if (v.temp >= 38) parts.push('febrile');
  return `Monitor reflects selected case: ${parts.length ? parts.join(', ') : 'currently stable monitor values'}.`;
}
