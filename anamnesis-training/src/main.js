import { PATIENT_CASES, INTENTS } from './patientCase.js';
import { PatientEngine } from './patientEngine.js';
import { speak, chooseVoiceForPatient, initVoices } from './speech.js';
import { runSimulationTests } from './simulationRunner.js';
import { openVitalsMonitor, closeVitalsMonitor, openEcgViewer, closeEcgViewer, resizeVisibleMonitor } from './vitalsMonitor.js';
import { initAvatarAnimator, reactAvatarToPatientReply, setAvatarEmotion } from './avatarAnimator.js';
import { phrasePatientReply, prepareAnonymousContribution, prepareQuestionWithAI, recordLearningEvent } from './aiSupport.js';
import { buildApiUrl, getAiHealth, getApiBaseUrl } from '../../src/ai/client.js';
import { showResponseLoading, removeResponseLoading } from './ui/loadingIndicator.js';
import { renderModeLayout } from './ui/modeLayout.js';
import { renderDetailsPanel } from './ui/detailsPanel.js';
import { initVoiceInput } from './ui/voiceInput.js';
import { closeModal, labsForGroup, openModal, renderLabsPanel, renderMedicationPanel } from './ui/actionPanels.js';

const els = {
  caseSelect: document.getElementById('caseSelect'),
  setupScreen: document.getElementById('setupScreen'),
  trainingScreen: document.getElementById('trainingScreen'),
  modeSelect: document.getElementById('modeSelect'),
  difficultySelect: document.getElementById('difficultySelect'),
  randomCaseBtn: document.getElementById('randomCaseBtn'),
  startTrainingBtn: document.getElementById('startTrainingBtn'),
  setupPreview: document.getElementById('setupPreview'),
  stationBrief: document.getElementById('stationBrief'),
  stationModeBadge: document.getElementById('stationModeBadge'),
  stationDifficultyBadge: document.getElementById('stationDifficultyBadge'),
  restartBtn: document.getElementById('restartBtn'),
  patientMeta: document.getElementById('patientMeta'),
  chatLog: document.getElementById('chatLog'),
  questionForm: document.getElementById('questionForm'),
  questionInput: document.getElementById('questionInput'),
  sendQuestionBtn: document.getElementById('sendQuestionBtn'),
  voiceInputBtn: document.getElementById('voiceInputBtn'),
  voiceInputStatus: document.getElementById('voiceInputStatus'),
  terminologyHint: document.getElementById('terminologyHint'),
  modePanel: document.getElementById('modePanel'),
  detailsPanel: document.getElementById('detailsPanel'),
  finishBtn: document.getElementById('finishBtn'),
  voiceToggle: document.getElementById('voiceToggle'),
  openVitalsBtn: document.getElementById('openVitalsBtn'),
  closeVitalsBtn: document.getElementById('closeVitalsBtn'),
  openEcgBtn: document.getElementById('openEcgBtn'),
  closeEcgBtn: document.getElementById('closeEcgBtn'),
  orderLabsBtn: document.getElementById('orderLabsBtn'),
  administerMedicationBtn: document.getElementById('administerMedicationBtn'),
  labsModal: document.getElementById('labsModal'),
  closeLabsBtn: document.getElementById('closeLabsBtn'),
  labsPanel: document.getElementById('labsPanel'),
  medicationModal: document.getElementById('medicationModal'),
  closeMedicationBtn: document.getElementById('closeMedicationBtn'),
  medicationPanel: document.getElementById('medicationPanel'),
  avatarMount: document.getElementById('avatarMount'),
  avatarFallback: document.getElementById('avatarFallback')
};

let engine;
let activeCase = PATIENT_CASES[0];
let currentMode = 'practice';
let currentDifficulty = 'intermediate';
let stationStarted = false;
let responsePending = false;
let lastDetection = null;
let voiceInputController = null;
let orderedLabs = {};
let administeredMedications = [];
let actionHistory = [];
const aiDiagnostics = {
  enabled: false,
  apiBaseUrl: '',
  healthEndpoint: '',
  backendReachable: null,
  geminiConfigured: null,
  model: '',
  lastIntentRescueStatus: null,
  lastAIError: '',
  lastAttempted: null,
  lastSucceeded: null,
  lastSelectedIntent: '',
  lastConfidence: ''
};

function init() {
  PATIENT_CASES.forEach((patientCase) => {
    const option = document.createElement('option');
    option.value = patientCase.id;
    option.textContent = patientCase.title;
    els.caseSelect.appendChild(option);
  });


  els.caseSelect.addEventListener('change', () => {
    activeCase = PATIENT_CASES.find((item) => item.id === els.caseSelect.value) || PATIENT_CASES[0];
    renderSetupPreview();
  });
  els.randomCaseBtn?.addEventListener('click', chooseRandomCase);
  els.modeSelect?.addEventListener('change', () => { currentMode = els.modeSelect.value; renderSetupPreview(); if (stationStarted) { renderInterfacePanels(); renderTerminologyHint(''); renderStationHeader(); } });
  els.difficultySelect?.addEventListener('change', () => { currentDifficulty = els.difficultySelect.value; renderSetupPreview(); if (stationStarted) renderStationHeader(); });
  els.startTrainingBtn?.addEventListener('click', startCase);
  els.restartBtn.addEventListener('click', showSetupScreen);
  els.questionForm.addEventListener('submit', handleQuestion);
  els.finishBtn.addEventListener('click', finishCase);
  els.openVitalsBtn?.addEventListener('click', () => openVitalsMonitor(activeCase));
  els.closeVitalsBtn?.addEventListener('click', closeVitalsMonitor);
  els.openEcgBtn?.addEventListener('click', () => { if (activeCase.ecg?.available) openEcgViewer(activeCase); });
  els.closeEcgBtn?.addEventListener('click', closeEcgViewer);
  els.orderLabsBtn?.addEventListener('click', () => { renderLabsOrderPanel(); openModal(els.labsModal); });
  els.closeLabsBtn?.addEventListener('click', () => closeModal(els.labsModal));
  els.administerMedicationBtn?.addEventListener('click', () => { renderMedicationActionPanel(); openModal(els.medicationModal); });
  els.closeMedicationBtn?.addEventListener('click', () => closeModal(els.medicationModal));
  document.querySelector('[data-close="vitals"]')?.addEventListener('click', closeVitalsMonitor);
  document.querySelector('[data-close="ecg"]')?.addEventListener('click', closeEcgViewer);
  document.querySelector('[data-close="labs"]')?.addEventListener('click', () => closeModal(els.labsModal));
  document.querySelector('[data-close="medication"]')?.addEventListener('click', () => closeModal(els.medicationModal));
  window.addEventListener('resize', resizeVisibleMonitor);
  window.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closeVitalsMonitor(); closeEcgViewer(); closeModal(els.labsModal); closeModal(els.medicationModal); } });

  voiceInputController = initVoiceInput({ button: els.voiceInputBtn, input: els.questionInput, status: els.voiceInputStatus });
  initVoices(() => { if (stationStarted) renderPatientMeta(); });
  renderSetupPreview();
  showSetupScreen();
}

async function startCase() {
  closeVitalsMonitor();
  closeEcgViewer();
  currentMode = els.modeSelect?.value || currentMode;
  currentDifficulty = els.difficultySelect?.value || currentDifficulty;
  stationStarted = true;
  responsePending = false;
  lastDetection = null;
  orderedLabs = {};
  administeredMedications = [];
  actionHistory = [];
  voiceInputController?.stop?.();
  els.setupScreen.hidden = true;
  els.trainingScreen.hidden = false;
  engine = new PatientEngine(activeCase, { mode: currentMode, difficulty: currentDifficulty });
  els.chatLog.innerHTML = '<div class="empty-chat-note">Start the interview by introducing yourself or asking the patient an opening question.</div>';
  els.chatLog.classList.add('empty-chat');
  setQuestionPending(false);
  renderStationHeader();
  renderPatientMeta();
  renderTerminologyHint('');
  renderInterfacePanels();
  await refreshAiHealthDiagnostics();
  renderInterfacePanels();
  await initAvatarAnimator(activeCase);
  setAvatarEmotion('neutral');
  els.questionInput.focus();
}

function showSetupScreen() {
  stationStarted = false;
  closeVitalsMonitor();
  closeEcgViewer();
  closeModal(els.labsModal);
  closeModal(els.medicationModal);
  voiceInputController?.stop?.();
  els.trainingScreen.hidden = true;
  els.setupScreen.hidden = false;
  renderSetupPreview();
}

function chooseRandomCase() {
  const random = PATIENT_CASES[Math.floor(Math.random() * PATIENT_CASES.length)] || PATIENT_CASES[0];
  activeCase = random;
  els.caseSelect.value = random.id;
  renderSetupPreview(true);
}

function renderSetupPreview(randomChosen = false) {
  if (!els.setupPreview) return;
  const selectedMode = els.modeSelect?.selectedOptions?.[0]?.textContent || 'Practice';
  const selectedDifficulty = els.difficultySelect?.selectedOptions?.[0]?.textContent || 'Intermediate';
  els.setupPreview.innerHTML = `
    <strong>${randomChosen ? 'Random case selected.' : 'Ready when you are.'}</strong>
    <span>Regime: ${escapeHtml(selectedMode)} · Difficulty: ${escapeHtml(selectedDifficulty)}</span>
    <p>The actual patient details are hidden until the student asks. Station context only will be shown after entry.</p>
  `;
}

function renderStationHeader() {
  const brief = activeCase.stationBrief || { location: 'Emergency Department assessment room', time: 'Current simulated hospital shift', task: 'Take a focused but complete anamnesis. Identify red flags, relevant history, medication, allergies, and decide what objective data you need.' };
  els.stationBrief.textContent = `${brief.location}. Time: ${brief.time}. Task: ${brief.task}`;
  els.stationModeBadge.textContent = `${currentMode.charAt(0).toUpperCase() + currentMode.slice(1)} regime`;
  els.stationDifficultyBadge.textContent = `${currentDifficulty.charAt(0).toUpperCase() + currentDifficulty.slice(1)} difficulty`;
  if (els.openEcgBtn) {
    const available = Boolean(activeCase.ecg?.available);
    els.openEcgBtn.disabled = !available;
    els.openEcgBtn.title = available ? 'Show ECG for this case' : 'ECG not available for this case';
    els.openEcgBtn.setAttribute('aria-label', available ? 'Show ECG' : 'Show ECG, ECG not available for this case');
  }
}

function renderPatientMeta() {
  const voice = chooseVoiceForPatient(activeCase.identity.sex, 'en');
  els.patientMeta.innerHTML = `
    <h2>Unidentified patient</h2>
    <p>Patient details are hidden. Assess identity, chief complaint, history, risks, medication, allergies, and objective data yourself.</p>
    <span class="badge">${escapeHtml(currentDifficulty)}</span>
    <span class="badge subtle">Mode: ${escapeHtml(currentMode)}</span>
    <div class="rapport"><span>Rapport</span><div><i style="width:${engine.rapport}%"></i></div></div>
    <p class="voice-meta">Voice: ${voice ? escapeHtml(voice.name) : 'browser default / unavailable'}</p>
  `;
}

function addMessage(role, text, intent = '', feedbackLabel = '') {
  const bubble = document.createElement('article');
  bubble.className = `message ${role}`;
  const showLabel = currentMode !== 'exam';
  const label = role === 'student' ? 'Student' : 'Patient';
  const tag = showLabel && (feedbackLabel || intent) ? `<span>${escapeHtml(feedbackLabel || labelForIntent(intent))}</span>` : '';
  bubble.innerHTML = `<div class="message-label">${label}${tag}</div><p>${escapeHtml(text)}</p>`;
  if (els.chatLog.classList.contains('empty-chat')) { els.chatLog.innerHTML = ''; els.chatLog.classList.remove('empty-chat'); }
  els.chatLog.appendChild(bubble);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

async function handleQuestion(event) {
  event.preventDefault();
  if (responsePending) return;
  const question = els.questionInput.value.trim();
  if (!question) return;
  setQuestionPending(true);
  addMessage('student', question);
  showResponseLoading(els.chatLog);
  try {
    const prepared = await prepareQuestionWithAI(engine, question);
    const result = engine.ask(question, prepared.detection);
    const reply = shouldUsePatientPhrasing(result)
      ? await phrasePatientReply(result.reply, prepared.event)
      : result.reply;
    engine.replaceLastPatientReply(reply);
    updateAiDiagnosticsFromEvent(prepared.event);
    lastDetection = result.detection;
    removeResponseLoading(els.chatLog);
    addMessage('patient', reply, result.detectedIntent, result.feedbackLabel);
    reactAvatarToPatientReply(reply, result);
    if (els.voiceToggle.checked) speak(reply, activeCase);
    recordLearningEvent(prepared.event);
    els.questionInput.value = '';
    renderTerminologyHint(result.terminologySuggestion, result.detection?.terminologyEvent?.term);
    renderInterfacePanels();
    renderPatientMeta();
  } catch (error) {
    removeResponseLoading(els.chatLog);
    recordRuntimeError(error, question);
    addMessage('patient', 'I am sorry, I could not answer that properly. Please ask me again in another way.', 'error', 'Response error');
    renderInterfacePanels();
  } finally {
    removeResponseLoading(els.chatLog);
    setQuestionPending(false);
    els.questionInput.focus();
  }
}

function setQuestionPending(pending) {
  responsePending = pending;
  if (els.sendQuestionBtn) {
    els.sendQuestionBtn.disabled = pending;
    els.sendQuestionBtn.textContent = pending ? 'Asking...' : 'Ask';
    els.sendQuestionBtn.setAttribute('aria-busy', String(pending));
  }
  if (els.questionInput) {
    els.questionInput.readOnly = pending;
    els.questionInput.setAttribute('aria-busy', String(pending));
  }
}

function recordRuntimeError(error, question) {
  const message = error?.message || String(error);
  console.error('anamnesis-response-error', error);
  engine?.debugTurns?.push({
    turnNumber: engine.turn ?? 0,
    studentInput: question,
    error: message,
    fallbackOccurred: true,
    fallbackReason: 'Response generation failed in UI orchestration.',
    at: new Date().toISOString()
  });
  aiDiagnostics.lastAIError = message;
}

function renderTerminologyHint(suggestion, term = '') {
  if (!els.terminologyHint) return;
  if (!suggestion || currentMode === 'exam') { els.terminologyHint.innerHTML = ''; els.terminologyHint.classList.remove('visible'); return; }
  els.terminologyHint.classList.add('visible');
  els.terminologyHint.innerHTML = `<strong>Patient-friendly wording:</strong> ${term ? `Medical wording detected: “${escapeHtml(term)}”. ` : ''}Try asking: “${escapeHtml(suggestion)}”`;
}

function renderInterfacePanels() {
  renderModeLayout({
    container: els.modePanel,
    mode: currentMode,
    engine,
    patientCase: activeCase,
    orderedLabs,
    onQuestionSelected: fillQuestionInput
  });
  renderDetailsPanel({
    container: els.detailsPanel,
    currentMode,
    lastDetection,
    aiDiagnostics,
    engine,
    onExportDebug: exportDebugSession,
    onRunSimulation: runSimulationAndShow
  });
}

function fillQuestionInput(question) {
  els.questionInput.value = question;
  els.questionInput.focus();
}

function renderDebug(detection) {
  if (!detection || currentMode === 'exam') {
    els.engineDebug.innerHTML = currentMode === 'exam'
      ? '<p>Debug hidden in Exam Mode.</p>'
      : `${renderAiDiagnostics()}<p>Ask a free-text anamnesis question. The engine will score possible meanings here.</p>`;
    return;
  }
  els.engineDebug.innerHTML = `${renderAiDiagnostics()}<p><strong>Scope:</strong> ${escapeHtml(detection.responseScope)}</p><p><strong>Best:</strong> ${escapeHtml(detection.primaryIntent ? labelForIntent(detection.primaryIntent.id) : 'uncertain')}</p><p><strong>Confidence:</strong> ${Math.round(detection.confidence * 100)}%</p>${detection.terminologyEvent ? `<p><strong>Terminology:</strong> ${escapeHtml(detection.terminologyEvent.term)} -> ${escapeHtml(detection.terminologyEvent.suggestedPatientFriendlyQuestion)}</p>` : ''}<ol>${detection.candidates.map((candidate) => `<li><span>${escapeHtml(labelForIntent(candidate.id))}</span><small>${candidate.score.toFixed(2)} - ${(candidate.reasons || []).slice(0, 2).join(', ') || 'context'}</small></li>`).join('')}</ol>`;
  return;
  if (!detection || currentMode === 'exam') { els.engineDebug.innerHTML = currentMode === 'exam' ? '<p>Debug hidden in Exam Mode.</p>' : '<p>Ask a free-text anamnesis question. The engine will score possible meanings here.</p>'; return; }
  els.engineDebug.innerHTML = `<p><strong>Scope:</strong> ${escapeHtml(detection.responseScope)}</p><p><strong>Best:</strong> ${escapeHtml(detection.primaryIntent ? labelForIntent(detection.primaryIntent.id) : 'uncertain')}</p><p><strong>Confidence:</strong> ${Math.round(detection.confidence * 100)}%</p>${detection.terminologyEvent ? `<p><strong>Terminology:</strong> ${escapeHtml(detection.terminologyEvent.term)} → ${escapeHtml(detection.terminologyEvent.suggestedPatientFriendlyQuestion)}</p>` : ''}<ol>${detection.candidates.map((candidate) => `<li><span>${escapeHtml(labelForIntent(candidate.id))}</span><small>${candidate.score.toFixed(2)} · ${(candidate.reasons || []).slice(0, 2).join(', ') || 'context'}</small></li>`).join('')}</ol>`;
}

async function refreshAiHealthDiagnostics() {
  aiDiagnostics.enabled = window.ANAMNESIS_AI_ENABLED !== false;
  aiDiagnostics.apiBaseUrl = getApiBaseUrl() || '(relative)';
  aiDiagnostics.healthEndpoint = buildApiUrl('/api/ai-health');
  aiDiagnostics.backendReachable = null;
  aiDiagnostics.geminiConfigured = null;
  aiDiagnostics.model = '';
  aiDiagnostics.lastAIError = '';

  if (currentMode === 'exam') return;

  try {
    const health = await getAiHealth();
    aiDiagnostics.backendReachable = true;
    aiDiagnostics.geminiConfigured = Boolean(health.configured);
    aiDiagnostics.model = health.model || '';
  } catch (error) {
    aiDiagnostics.backendReachable = false;
    aiDiagnostics.lastAIError = error.message;
  }
}

function updateAiDiagnosticsFromEvent(event) {
  if (!event) return;
  aiDiagnostics.lastAttempted = Boolean(event.aiAttempted || event.aiEndpoint || event.aiSelectedIntent);
  aiDiagnostics.lastSucceeded = Boolean(event.aiSucceeded || event.aiSelectedIntent);
  aiDiagnostics.lastSelectedIntent = event.aiSelectedIntent || '';
  aiDiagnostics.lastConfidence = event.aiConfidence ?? '';
  if (event.aiEndpoint?.includes('/api/intent-rescue')) aiDiagnostics.lastIntentRescueStatus = event.aiHttpStatus;
  if (event.aiError) aiDiagnostics.lastAIError = event.aiError;
}

function renderAiDiagnostics() {
  if (currentMode === 'exam') return '';
  const boolText = (value) => value === null ? 'unknown' : value ? 'yes' : 'no';
  return `
    <section class="ai-diagnostics">
      <p><strong>AI enabled:</strong> ${escapeHtml(boolText(aiDiagnostics.enabled))}</p>
      <p><strong>API base URL:</strong> ${escapeHtml(aiDiagnostics.apiBaseUrl || '(relative)')}</p>
      <p><strong>Health endpoint:</strong> ${escapeHtml(aiDiagnostics.healthEndpoint)}</p>
      <p><strong>Backend reachable:</strong> ${escapeHtml(boolText(aiDiagnostics.backendReachable))}</p>
      <p><strong>Gemini configured:</strong> ${escapeHtml(boolText(aiDiagnostics.geminiConfigured))}</p>
      <p><strong>AI model:</strong> ${escapeHtml(aiDiagnostics.model || 'unknown')}</p>
      <p><strong>Last intent-rescue status:</strong> ${escapeHtml(aiDiagnostics.lastIntentRescueStatus ?? 'none')}</p>
      <p><strong>Last AI error:</strong> ${escapeHtml(aiDiagnostics.lastAIError || 'none')}</p>
    </section>
  `;
}

function shouldUsePatientPhrasing(result) {
  const scope = result?.detection?.responseScope;
  return scope !== 'clarification' &&
    scope !== 'terminology_not_understood' &&
    Boolean(result?.reply?.trim()) &&
    Boolean(result?.detection?.answerIntents?.length);
}

function showHint() {
  if (currentMode === 'exam') return;
  const coverage = engine.getCoverage();
  const area = coverage.find((item) => item.required && item.percent < 100) || coverage.find((item) => item.percent < 100);
  if (!area) { addMessage('patient', 'You already asked me a very complete set of questions.', 'hint'); return; }
  const text = currentMode === 'teaching' ? `Training hint: ${area.title} is still incomplete. ${area.modelQuestion}` : `Training hint: ${area.title} is still incomplete.`;
  addMessage('patient', text, 'hint');
}
function finishCase() {
  const score = engine.getScore();
  const missed = engine.getMissedFeedback();
  const critical = engine.getCriticalMisses();
  const feedback = `
Interview finished. Your score is ${score}%.

Critical misses:
${critical.length ? critical.map((item) => `- ${labelForIntent(item)}`).join('\n') : '- None'}

Incomplete domains:
${missed.length ? missed.map((area) => `- ${area.title}: ${area.missing.map(labelForIntent).join(', ')}`).join('\n') : '- None'}
  `.trim();
  addMessage('patient', feedback, 'score');
  if (window.confirm('Would you like to anonymously contribute this conversation to improve the simulator?')) {
    console.info('anamnesis-anonymous-contribution-ready', prepareAnonymousContribution(engine));
  }
  renderInterfacePanels();
}
async function copySummary() { try { await navigator.clipboard.writeText(engine.generateSummary()); addMessage('patient', 'Summary copied to clipboard.', 'export'); } catch { addMessage('patient', 'Clipboard failed. Select the summary manually.', 'export'); } }
function exportDebugSession() { downloadJson('anamnesis_debug_session.json', getDebugExport()); }
function getDebugExport() {
  return {
    ...engine.getDebugExport(),
    orderedLabs,
    administeredMedications,
    actionHistory,
    aiDiagnostics: { ...aiDiagnostics, apiBaseUrl: aiDiagnostics.apiBaseUrl ? '[configured]' : '' }
  };
}
function runSimulationAndShow() {
  const report = runSimulationTests();
  addMessage('patient', `Simulation test report: ${report.passed}/${report.total} passed (${report.passRate}%).`, 'simulation', 'Simulation tests');
  downloadJson('anamnesis_simulation_report.json', report);
}

function renderLabsOrderPanel() {
  renderLabsPanel({
    container: els.labsPanel,
    patientCase: activeCase,
    orderedLabs,
    onOrder: (groupId) => {
      const newlyOrdered = labsForGroup(groupId, activeCase);
      orderedLabs = { ...orderedLabs, ...newlyOrdered };
      actionHistory.push({ type: 'lab-order', groupId, resultKeys: Object.keys(newlyOrdered), at: new Date().toISOString() });
      renderLabsOrderPanel();
      renderInterfacePanels();
    }
  });
}

function renderMedicationActionPanel() {
  renderMedicationPanel({
    container: els.medicationPanel,
    patientCase: activeCase,
    administeredActions: administeredMedications,
    onAdminister: (action) => {
      administeredMedications = [...new Set([...administeredMedications, action])];
      actionHistory.push({ type: 'medication-action', action, effectModelled: false, at: new Date().toISOString() });
      renderMedicationActionPanel();
      renderInterfacePanels();
    }
  });
}

function downloadJson(filename, data) { const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); }
function activateTab(name) { document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active')); document.getElementById(`${name}Panel`)?.classList.add('active'); }
function labelForIntent(intent) { return INTENTS[intent]?.title || String(intent).replaceAll('_', ' '); }
function escapeHtml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
init();
