import { Patient3DRenderer } from './scene/patient3DRenderer.js';

const state = {
  renderer3d: null,
  mount: null,
  patientSnapshot: null,
  unsubscribePatientState: null,
  fallbackSvg: null,
  fallbackReady: false
};

export async function initAvatarAnimator(activeCase) {
  state.mount = document.getElementById('avatarMount');
  if (!state.mount) return false;
  state.renderer3d?.dispose?.();
  state.renderer3d = null;
  state.fallbackSvg = null;
  state.fallbackReady = false;

  try {
    const renderer = new Patient3DRenderer(state.mount, { activeCase });
    await renderer.init();
    state.renderer3d = renderer;
    if (state.patientSnapshot) renderer.setSnapshot(state.patientSnapshot);
    document.documentElement.classList.add('patient-3d-supported');
    return true;
  } catch (error) {
    console.warn('3D patient renderer unavailable; using 2D clinical fallback.', error);
    document.documentElement.classList.remove('patient-3d-supported');
    return loadSvgFallback();
  }
}

export function bindAvatarToPatientState(patientStateEngine) {
  state.unsubscribePatientState?.();
  state.unsubscribePatientState = null;
  if (!patientStateEngine?.subscribe) return;
  state.unsubscribePatientState = patientStateEngine.subscribe((snapshot) => {
    state.patientSnapshot = snapshot;
    state.renderer3d?.setSnapshot(snapshot);
    applyFallbackSnapshot(snapshot);
  });
}

export function reactAvatarToPatientReply(reply = '', result = {}) {
  const text = `${reply} ${result.detectedIntent || ''} ${result.feedbackLabel || ''}`;
  state.renderer3d?.reactToReply(text, result);
  if (!state.renderer3d && state.fallbackReady) applyFallbackReaction(text);
}

export function reactAvatarToExamination(examinationId = '', finding = '') {
  state.renderer3d?.reactToExamination(examinationId, finding);
  if (!state.renderer3d && state.fallbackReady) applyFallbackReaction(`${examinationId} ${finding}`);
}


export function setAvatarSpeaking(active, text = '') {
  state.renderer3d?.setSpeaking(Boolean(active), text);
  state.mount?.classList.toggle('patient-speaking', Boolean(active));
}

export function pulseAvatarSpeechBoundary() {
  state.renderer3d?.pulseSpeechBoundary?.();
}

export function setAvatarViewMode(mode = 'encounter') {
  state.renderer3d?.setViewMode(mode);
  state.mount?.setAttribute('data-patient-view', mode);
}

export function setAvatarEmotion(emotion = 'neutral') {
  state.renderer3d?.setEmotion(emotion);
  if (!state.renderer3d && state.fallbackReady) {
    state.mount?.classList.toggle('fallback-patient-distressed', emotion === 'pain' || emotion === 'worried');
  }
}

async function loadSvgFallback() {
  if (!state.mount) return false;
  try {
    const response = await fetch(new URL('../patient-avatar.svg', import.meta.url), { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Fallback avatar SVG not found (${response.status})`);
    const text = await response.text();
    state.mount.innerHTML = text;
    const svg = state.mount.querySelector('svg');
    if (svg) {
      svg.id = 'patientAvatarSvg';
      svg.classList.add('animated-patient-svg', 'patient-svg-fallback');
    }
    state.fallbackSvg = svg;
    state.fallbackReady = Boolean(svg);
    applyFallbackSnapshot(state.patientSnapshot || {});
    return state.fallbackReady;
  } catch (error) {
    console.error('Patient visual fallback failed:', error);
    state.mount.innerHTML = '<div class="avatar-fallback visible">Pt</div>';
    return false;
  }
}

function applyFallbackSnapshot(snapshot = {}) {
  if (!state.fallbackSvg) return;
  const visual = snapshot.visual || {};
  const equipment = snapshot.equipment || {};
  const setOpacity = (id, value) => {
    const el = state.fallbackSvg.querySelector(`#${id}`);
    if (el) el.style.opacity = String(value);
  };
  setOpacity('pallorOverlay', clamp(Number(visual.pallor || 0), 0, 1));
  setOpacity('sweatOverlay', clamp(Number(visual.sweating || 0), 0, 1));
  setOpacity('oxygenOverlay', equipment.oxygen ? 1 : 0);
  setOpacity('telemetryOverlay', equipment.telemetry || equipment.monitor ? 1 : 0);
  setOpacity('ecg12Overlay', equipment.ecg12 ? 1 : 0);
  setOpacity('spo2Overlay', equipment.spo2Probe || equipment.monitor ? 1 : 0);
  setOpacity('ivOverlay', equipment.ivAccess || equipment.infusion ? 1 : 0);
  setOpacity('infusionOverlay', equipment.infusion ? 1 : 0);
}

function applyFallbackReaction(text = '') {
  const lower = String(text).toLowerCase();
  const rest = state.fallbackSvg?.querySelector('#restArmGroup');
  const chest = state.fallbackSvg?.querySelector('#chestHandGroup');
  const abdomen = state.fallbackSvg?.querySelector('#abdomenHandGroup');
  const mode = /chest|pain|pressure|cardio|stern/.test(lower) ? 'chest' : /abdomen|stomach|nause/.test(lower) ? 'abdomen' : 'rest';
  if (rest) rest.style.opacity = mode === 'rest' ? '1' : '0';
  if (chest) chest.style.opacity = mode === 'chest' ? '1' : '0';
  if (abdomen) abdomen.style.opacity = mode === 'abdomen' ? '1' : '0';
  if (mode !== 'rest') {
    window.setTimeout(() => {
      if (rest) rest.style.opacity = '1';
      if (chest) chest.style.opacity = '0';
      if (abdomen) abdomen.style.opacity = '0';
    }, 2600);
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
