let patient3DRendererModulePromise = null;
const state = {
  renderer3d: null, mount: null, patientSnapshot: null,
  unsubscribePatientState: null, generation: 0, failedGeneration: null, ready: false,
  activeCase: null, options: {}, placedLeads: [], viewMode: 'encounter'
};

async function loadPatient3DRenderer(timeoutMs = 12000) {
  if (!patient3DRendererModulePromise) {
    patient3DRendererModulePromise = import('./scene/patient3DRenderer.js?v=positioning-all-modes')
      .catch(error => { patient3DRendererModulePromise = null; throw error; });
  }
  let timer;
  try {
    const module = await Promise.race([
      patient3DRendererModulePromise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('3D module load timed out')), timeoutMs); })
    ]);
    if (typeof module?.Patient3DRenderer !== 'function') throw new Error('Invalid 3D renderer module');
    return module.Patient3DRenderer;
  } finally { clearTimeout(timer); }
}

function availability(ready, stage) {
  state.ready = ready;
  state.mount.dataset.loaded = String(ready);
  state.mount.dataset.visualMode = ready ? '3d' : stage;
  state.mount.dispatchEvent(new CustomEvent('patient3d-availability', {
    bubbles: true, detail: { ready, stage, caseId: state.activeCase?.id }
  }));
}

function showFailure(error, renderer, generation) {
  if (generation !== state.generation || generation === state.failedGeneration) return false;
  state.failedGeneration = generation;
  if (renderer?.placedLeads) state.placedLeads = Object.keys(renderer.placedLeads);
  console.warn('Patient Trainer 3D environment unavailable', {
    caseId: state.activeCase?.id,
    asset: renderer?.asset,
    diagnostics: renderer?.getDiagnostics?.(),
    error
  });
  renderer?.dispose();
  state.renderer3d = null;
  document.documentElement.classList.remove('patient-3d-supported');
  state.mount.classList.remove('patient-speaking');
  state.mount.replaceChildren();
  const panel = document.createElement('div');
  panel.className = 'patient3d-error';
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-live', 'polite');
  const message = document.createElement('strong');
  message.textContent = '3D environment cannot be loaded.';
  const help = document.createElement('p');
  help.textContent = 'Your interview and notes remain in this session. Examination interactions are unavailable until the 3D environment loads.';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'secondary';
  retry.textContent = 'Retry loading 3D environment';
  retry.addEventListener('click', () => { void initializeCurrentEnvironment(); }, { once: true });
  panel.append(message, help, retry);
  state.mount.append(panel);
  availability(false, 'unavailable');
  return false;
}

async function initializeCurrentEnvironment() {
  const generation = ++state.generation;
  state.renderer3d?.dispose();
  state.renderer3d = null;
  state.mount.replaceChildren();
  const loading = document.createElement('div');
  loading.className = 'patient-3d-loading';
  loading.setAttribute('role', 'status');
  loading.textContent = 'Loading 3D environment…';
  state.mount.append(loading);
  availability(false, 'loading');
  let renderer;
  try {
    const Patient3DRenderer = await loadPatient3DRenderer();
    if (generation !== state.generation) return false;
    renderer = new Patient3DRenderer(state.mount, {
      ...state.options, activeCase: state.activeCase,
      bedsideControls: document.getElementById('patientBedsideControls'),
      onError: error => showFailure(error, renderer, generation)
    });
    state.renderer3d = renderer;
    const initialized = await renderer.init();
    if (generation !== state.generation) { renderer.dispose(); return false; }
    if (!initialized || renderer.disposed) return false;
    renderer.restorePlacedLeads(state.placedLeads);
    if (state.patientSnapshot) renderer.setSnapshot(state.patientSnapshot);
    renderer.setViewMode(state.viewMode);
    document.documentElement.classList.add('patient-3d-supported');
    availability(true, 'ready');
    return true;
  } catch (error) { return showFailure(error, renderer, generation); }
}

export async function initAvatarAnimator(activeCase, options = {}) {
  state.mount = document.getElementById('avatarMount');
  if (!state.mount) return false;
  state.unsubscribePatientState?.();
  state.unsubscribePatientState = null;
  state.patientSnapshot = null;
  state.activeCase = activeCase;
  state.options = options;
  state.placedLeads = [...(options.placedLeads || [])];
  state.viewMode = options.viewMode || 'encounter';
  return initializeCurrentEnvironment();
}

export function disposeAvatarAnimator() {
  state.generation += 1;
  state.ready = false;
  state.renderer3d?.dispose();
  state.renderer3d = null;
  state.unsubscribePatientState?.();
  state.unsubscribePatientState = null;
}

export function isAvatarEnvironmentReady() { return Boolean(state.ready && state.renderer3d?.loaded && !state.renderer3d.disposed && !state.renderer3d.failed); }
export function bindAvatarToPatientState(engine) {
  state.unsubscribePatientState?.();
  state.unsubscribePatientState = engine?.subscribe?.(snapshot => {
    state.patientSnapshot = snapshot;
    state.renderer3d?.setSnapshot(snapshot);
  }) || null;
}
export function reactAvatarToPatientReply(reply = '', result = {}) { state.renderer3d?.reactToReply(`${reply} ${result.detectedIntent || ''}`, result); }
export function reactAvatarToExamination(id = '', finding = '') { state.renderer3d?.reactToExamination(id, finding); }
export function setAvatarExamTool(tool = 'off') { return isAvatarEnvironmentReady() ? state.renderer3d.setExaminationTool(tool) : false; }
export function applyAvatarPositionRequest(position) {
  if (!isAvatarEnvironmentReady() || !state.renderer3d.applyPositionRequest(position)) return false;
  state.options.patientPosition = position;
  return true;
}
export function lockAvatarExaminations() { state.options.completed = true; if (state.renderer3d) { state.renderer3d.options.completed = true; state.renderer3d.setInteractionEnabled(false); } }
export function getAvatarEcgPlacedLeads() { return state.renderer3d ? Object.keys(state.renderer3d.placedLeads) : [...state.placedLeads]; }
export function getAvatarEcgPlacementCount() { return getAvatarEcgPlacedLeads().length; }
export function restoreAvatarEcgPlacedLeads(ids = []) { state.placedLeads = [...ids]; state.renderer3d?.restorePlacedLeads(ids); }
export function setAvatarSpeaking(active, text = '') { state.renderer3d?.setSpeaking(Boolean(active), text); if (isAvatarEnvironmentReady()) state.mount?.classList.toggle('patient-speaking', Boolean(active)); }
export function pulseAvatarSpeechBoundary(event = {}) { state.renderer3d?.pulseSpeechBoundary(event); }
export function setAvatarViewMode(mode = 'encounter') { state.viewMode = mode; state.renderer3d?.setViewMode(mode); state.mount?.setAttribute('data-patient-view', mode); }
export function setAvatarEmotion(emotion = 'neutral') { state.renderer3d?.setEmotion(emotion); }
