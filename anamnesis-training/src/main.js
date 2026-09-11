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
import { buildEncounterReport, countCompletedNoteSections, createEncounterState } from './clinicalEncounter.js';
import { renderClosingForm, renderClinicalNotesPanel, renderDifferentialPanel, renderEncounterReport, renderExaminationPanel } from './ui/clinicalEncounterPanels.js';

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
  openExamBtn: document.getElementById('openExamBtn'),
  closeExamBtn: document.getElementById('closeExamBtn'),
  examinationModal: document.getElementById('examinationModal'),
  examinationPanel: document.getElementById('examinationPanel'),
  openNotesBtn: document.getElementById('openNotesBtn'),
  closeNotesBtn: document.getElementById('closeNotesBtn'),
  clinicalNotesModal: document.getElementById('clinicalNotesModal'),
  clinicalNotesPanel: document.getElementById('clinicalNotesPanel'),
  openDifferentialBtn: document.getElementById('openDifferentialBtn'),
  closeDifferentialBtn: document.getElementById('closeDifferentialBtn'),
  differentialModal: document.getElementById('differentialModal'),
  differentialPanel: document.getElementById('differentialPanel'),
  closingModal: document.getElementById('closingModal'),
  closeClosingBtn: document.getElementById('closeClosingBtn'),
  closingPanel: document.getElementById('closingPanel'),
  labsModal: document.getElementById('labsModal'),
  closeLabsBtn: document.getElementById('closeLabsBtn'),
  labsPanel: document.getElementById('labsPanel'),
  medicationModal: document.getElementById('medicationModal'),
  closeMedicationBtn: document.getElementById('closeMedicationBtn'),
  medicationPanel: document.getElementById('medicationPanel'),
  avatarMount: document.getElementById('avatarMount'),
  avatarFallback: document.getElementById('avatarFallback'),
  actionHistoryPanel: document.getElementById('actionHistoryPanel'),
  encounterOverview: document.getElementById('encounterOverview'),
  examNavCount: document.getElementById('examNavCount'),
  testsNavCount: document.getElementById('testsNavCount'),
  reasoningNavCount: document.getElementById('reasoningNavCount'),
  coachWindowTitle: document.getElementById('coachWindowTitle'),
  ecgAvailabilityText: document.getElementById('ecgAvailabilityText')
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
let encounterState = createEncounterState();
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
  els.openVitalsBtn?.addEventListener('click', () => { recordObjectiveAction('vitals', 'Live vitals monitor reviewed'); openVitalsMonitor(activeCase); });
  els.closeVitalsBtn?.addEventListener('click', closeVitalsMonitor);
  els.openEcgBtn?.addEventListener('click', () => { if (activeCase.ecg?.available) { recordObjectiveAction('ecg', '12-lead ECG reviewed'); openEcgViewer(activeCase); } });
  els.closeEcgBtn?.addEventListener('click', closeEcgViewer);
  els.orderLabsBtn?.addEventListener('click', () => { activateWorkspace('investigations'); renderLabsOrderPanel(); focusWorkspaceSubwindow('.laboratory-window'); });
  els.administerMedicationBtn?.addEventListener('click', () => { activateWorkspace('investigations'); renderMedicationActionPanel(); focusWorkspaceSubwindow('.management-window'); });
  els.openExamBtn?.addEventListener('click', () => { activateWorkspace('examination'); renderPhysicalExamPanel(); });
  els.openNotesBtn?.addEventListener('click', () => { activateWorkspace('reasoning'); renderNotesPanel(); focusWorkspaceSubwindow('.reasoning-notes-window'); });
  els.openDifferentialBtn?.addEventListener('click', () => { activateWorkspace('reasoning'); renderDifferentialBoard(); focusWorkspaceSubwindow('.differential-window'); });
  document.querySelectorAll('[data-workspace-target]').forEach((button) => button.addEventListener('click', () => {
    const target = button.dataset.workspaceTarget;
    if (target === 'handover') return;
    activateWorkspace(target);
    if (target === 'examination') renderPhysicalExamPanel();
    if (target === 'investigations') { renderLabsOrderPanel(); renderMedicationActionPanel(); renderActionHistoryPanel(); }
    if (target === 'reasoning') { renderNotesPanel(); renderDifferentialBoard(); }
  }));
  document.querySelectorAll('[data-objective-action]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.objectiveAction === 'vitals') { recordObjectiveAction('vitals', 'Live vitals monitor reviewed'); openVitalsMonitor(activeCase); }
    if (button.dataset.objectiveAction === 'ecg' && activeCase.ecg?.available) { recordObjectiveAction('ecg', '12-lead ECG reviewed'); openEcgViewer(activeCase); }
  }));
  document.querySelector('[data-close="vitals"]')?.addEventListener('click', closeVitalsMonitor);
  document.querySelector('[data-close="ecg"]')?.addEventListener('click', closeEcgViewer);
  document.querySelector('[data-close="labs"]')?.addEventListener('click', () => closeModal(els.labsModal));
  document.querySelector('[data-close="medication"]')?.addEventListener('click', () => closeModal(els.medicationModal));
  document.querySelector('[data-close="examination"]')?.addEventListener('click', () => closeModal(els.examinationModal));
  document.querySelector('[data-close="notes"]')?.addEventListener('click', () => closeModal(els.clinicalNotesModal));
  document.querySelector('[data-close="differential"]')?.addEventListener('click', () => closeModal(els.differentialModal));
  document.querySelector('[data-close="closing"]')?.addEventListener('click', () => closeModal(els.closingModal));
  window.addEventListener('resize', resizeVisibleMonitor);
  window.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closeVitalsMonitor(); closeEcgViewer(); closeModal(els.labsModal); closeModal(els.medicationModal); closeModal(els.examinationModal); closeModal(els.clinicalNotesModal); closeModal(els.differentialModal); closeModal(els.closingModal); } });

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
  encounterState = createEncounterState();
  voiceInputController?.stop?.();
  els.setupScreen.hidden = true;
  els.trainingScreen.hidden = false;
  engine = new PatientEngine(activeCase, { mode: currentMode, difficulty: currentDifficulty });
  els.chatLog.innerHTML = '<div class="empty-chat-note">Start the interview by introducing yourself or asking the patient an opening question.</div>';
  els.chatLog.classList.add('empty-chat');
  setQuestionPending(false);
  resetEncounterControls();
  activateWorkspace('interview');
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
  closeModal(els.examinationModal);
  closeModal(els.clinicalNotesModal);
  closeModal(els.differentialModal);
  closeModal(els.closingModal);
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
  const modeHelp = currentMode === 'exam'
    ? 'Exam mode hides coaching and interpretation support until submission.'
    : currentMode === 'teaching'
      ? 'Teaching mode includes the fullest checklist and question support.'
      : 'Practice mode keeps progress guidance available without exposing the diagnosis.';
  els.setupPreview.innerHTML = `
    <div class="setup-preview-top"><strong>${randomChosen ? 'Random station selected' : escapeHtml(activeCase.title)}</strong><span>${escapeHtml(selectedDifficulty)} · ${escapeHtml(selectedMode)}</span></div>
    <p>${escapeHtml(modeHelp)}</p>
    <small>Patient identity, diagnosis, examination findings and investigation results remain hidden until obtained in the station.</small>
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
  if (els.ecgAvailabilityText) els.ecgAvailabilityText.textContent = activeCase.ecg?.available ? 'Case recording available' : 'No recording available';
  if (els.coachWindowTitle) els.coachWindowTitle.textContent = currentMode === 'exam' ? 'Exam station' : currentMode === 'teaching' ? 'Teaching coach' : 'Practice coach';
}

function renderPatientMeta() {
  const voice = chooseVoiceForPatient(activeCase.identity.sex, 'en');
  const discoveredIdentity = Boolean(engine?.askedIntents?.has?.('identity_name'));
  els.patientMeta.innerHTML = `
    <div class="patient-meta-heading">
      <div><span class="patient-meta-label">Current patient</span><h2>${discoveredIdentity ? escapeHtml(String(activeCase.identity?.name || '').replace(/^My name is\s+/i, '').replace(/\.$/, '')) : 'Identity not confirmed'}</h2></div>
      <span class="badge subtle">${escapeHtml(currentDifficulty)}</span>
    </div>
    <p>${discoveredIdentity ? 'Identity established. Continue the clinical assessment.' : 'Confirm identity and the presenting problem yourself. Demographics stay concealed until they are obtained.'}</p>
    <div class="rapport"><span>Rapport <b>${Math.round(engine.rapport)}%</b></span><div><i style="width:${engine.rapport}%"></i></div></div>
    <div class="patient-meta-footer"><span>${escapeHtml(currentMode)} mode</span><span>${voice ? 'Voice ready' : 'Browser voice'}</span></div>
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
  renderPhysicalExamPanel();
  renderLabsOrderPanel();
  renderMedicationActionPanel();
  renderNotesPanel();
  renderDifferentialBoard();
  renderActionHistoryPanel();
  updateEncounterToolLabels();
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
  renderClosingForm({
    container: els.closingPanel,
    encounterState,
    mode: currentMode,
    onSubmit: submitEncounter
  });
  activateWorkspace('handover');
}

function submitEncounter(closingInput) {
  if (!engine || encounterState.completed) return;
  const report = buildEncounterReport({
    patientCase: activeCase,
    encounterState,
    interviewScore: engine.getScore(),
    closingInput
  });
  actionHistory.push({ type: 'encounter-submitted', at: new Date().toISOString(), score: report.encounterScore });
  renderEncounterReport({ container: els.closingPanel, report, onContribute: () => console.info('anamnesis-anonymous-contribution-ready', prepareAnonymousContribution(engine)) });
  if (els.closeClosingBtn) els.closeClosingBtn.textContent = 'Close report';
  responsePending = true;
  if (els.sendQuestionBtn) { els.sendQuestionBtn.disabled = true; els.sendQuestionBtn.textContent = 'Submitted'; }
  if (els.questionInput) { els.questionInput.readOnly = true; els.questionInput.placeholder = 'This attempt has been submitted.'; }
  if (els.finishBtn) els.finishBtn.disabled = true;
  lockEncounterControls();
  renderInterfacePanels();
}


function lockEncounterControls() {
  [els.openExamBtn, els.orderLabsBtn, els.administerMedicationBtn, els.openDifferentialBtn].forEach((button) => {
    if (button) button.disabled = true;
  });
}

function resetEncounterControls() {
  [els.openExamBtn, els.orderLabsBtn, els.administerMedicationBtn, els.openDifferentialBtn, els.finishBtn].forEach((button) => {
    if (button) button.disabled = false;
  });
  if (els.sendQuestionBtn) { els.sendQuestionBtn.disabled = false; els.sendQuestionBtn.textContent = 'Ask'; }
  if (els.questionInput) { els.questionInput.readOnly = false; els.questionInput.placeholder = 'Ask the patient a free-text anamnesis question...'; }
  if (els.closeClosingBtn) els.closeClosingBtn.textContent = 'Return to station';
}

function renderPhysicalExamPanel() {
  renderExaminationPanel({
    container: els.examinationPanel,
    patientCase: activeCase,
    encounterState,
    mode: currentMode,
    onPerformed: (result) => {
      if (!result?.ok) return;
      actionHistory.push({ type: 'physical-examination', examinationId: result.action.id, label: result.action.label, at: new Date().toISOString() });
      encounterState.notes.examination = mergeNote(encounterState.notes.examination, `${result.action.label}: ${result.finding}`);
      renderActionHistoryPanel();
      updateEncounterToolLabels();
    }
  });
}

function renderNotesPanel() {
  renderClinicalNotesPanel({
    container: els.clinicalNotesPanel,
    encounterState,
    onChange: () => updateEncounterToolLabels()
  });
}

function renderDifferentialBoard() {
  renderDifferentialPanel({
    container: els.differentialPanel,
    encounterState,
    onChange: () => updateEncounterToolLabels()
  });
}

function updateEncounterToolLabels() {
  const objectiveCount = actionHistory.filter((item) => item.type === 'objective-vitals' || item.type === 'objective-ecg').length;
  const testCount = Object.keys(orderedLabs).length + administeredMedications.length + objectiveCount;
  if (els.examNavCount) els.examNavCount.textContent = String(encounterState.examined.length);
  if (els.testsNavCount) els.testsNavCount.textContent = String(testCount);
  if (els.reasoningNavCount) els.reasoningNavCount.textContent = String(encounterState.differentials.length);
  renderEncounterOverview();
}
function recordObjectiveAction(kind, label) {
  if (!stationStarted || !engine) return;
  actionHistory.push({ type: `objective-${kind}`, label, at: new Date().toISOString() });
  renderActionHistoryPanel();
  updateEncounterToolLabels();
}

function activateWorkspace(name) {
  const target = String(name || 'interview');
  document.querySelectorAll('[data-workspace-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.workspacePanel === target));
  document.querySelectorAll('[data-workspace-target]').forEach((button) => button.classList.toggle('active', button.dataset.workspaceTarget === target));
  document.body.dataset.patientWorkspace = target;
}

function focusWorkspaceSubwindow(selector) {
  window.setTimeout(() => {
    const target = document.querySelector(selector);
    if (!target) return;
    target.classList.add('attention-pulse');
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    window.setTimeout(() => target.classList.remove('attention-pulse'), 900);
  }, 30);
}

function renderEncounterOverview() {
  if (!els.encounterOverview || !engine) return;
  const coverage = engine.getCoverage?.() || [];
  const required = coverage.filter((item) => item.required);
  const interviewPercent = required.length ? Math.round(required.reduce((sum, item) => sum + Number(item.percent || 0), 0) / required.length) : 0;
  const examTotal = Math.max(1, getRequiredExamCount());
  const examDone = Math.min(examTotal, encounterState.examined.length);
  const noteSections = countCompletedNoteSections(encounterState);
  els.encounterOverview.innerHTML = `
    ${overviewRow('Interview', `${interviewPercent}%`, interviewPercent)}
    ${overviewRow('Examination', `${examDone}/${examTotal}`, Math.round((examDone / examTotal) * 100))}
    ${overviewRow('Tests / actions', String(Object.keys(orderedLabs).length + administeredMedications.length + actionHistory.filter((item) => item.type === 'objective-vitals' || item.type === 'objective-ecg').length), Math.min(100, (Object.keys(orderedLabs).length + administeredMedications.length + actionHistory.filter((item) => item.type === 'objective-vitals' || item.type === 'objective-ecg').length) * 12))}
    ${overviewRow('Differential', `${encounterState.differentials.length}/5`, encounterState.differentials.length * 20)}
    ${overviewRow('Notes', `${noteSections}/4`, noteSections * 25)}
  `;
}

function getRequiredExamCount() {
  return document.querySelectorAll('#examinationPanel .exam-action[data-required="true"]').length || 3;
}

function overviewRow(label, value, percent) {
  const safePercent = Math.max(0, Math.min(100, Number(percent || 0)));
  return `<div class="overview-row"><div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div><div class="overview-progress"><i style="width:${safePercent}%"></i></div></div>`;
}

function renderActionHistoryPanel() {
  if (!els.actionHistoryPanel) return;
  const items = actionHistory.slice(-8).reverse();
  if (!items.length) {
    els.actionHistoryPanel.innerHTML = '<div class="empty-action-history">No objective actions recorded yet.</div>';
    return;
  }
  els.actionHistoryPanel.innerHTML = items.map((item) => {
    const label = item.type === 'lab-order' ? `Laboratory order · ${String(item.groupId || '').replaceAll('_', ' ')}`
      : item.type === 'medication-action' ? `Management · ${item.action}`
      : item.type === 'physical-examination' ? `Examination · ${item.label}`
      : item.type?.startsWith('objective-') ? `Objective data · ${item.label || item.type}`
      : item.type === 'encounter-submitted' ? 'Station submitted'
      : String(item.type || 'Clinical action').replaceAll('-', ' ');
    return `<div class="history-row"><span>${escapeHtml(label)}</span><small>${escapeHtml(new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</small></div>`;
  }).join('');
}

function mergeNote(existing, line) {
  const clean = String(existing || '').trim();
  if (clean.includes(line)) return clean;
  return clean ? `${clean}
${line}` : line;
}
async function copySummary() { try { await navigator.clipboard.writeText(engine.generateSummary()); addMessage('patient', 'Summary copied to clipboard.', 'export'); } catch { addMessage('patient', 'Clipboard failed. Select the summary manually.', 'export'); } }
function exportDebugSession() { downloadJson('anamnesis_debug_session.json', getDebugExport()); }
function getDebugExport() {
  return {
    ...engine.getDebugExport(),
    orderedLabs,
    administeredMedications,
    actionHistory,
    encounterState,
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
      const resultText = Object.values(newlyOrdered).join(' ');
      if (resultText) encounterState.notes.investigations = mergeNote(encounterState.notes.investigations, `${groupId.replaceAll('_', ' ')}: ${resultText}`);
      renderLabsOrderPanel();
      renderActionHistoryPanel();
      renderInterfacePanels();
    }
  });
}

function renderMedicationActionPanel() {
  renderMedicationPanel({
    container: els.medicationPanel,
    patientCase: activeCase,
    administeredActions: administeredMedications,
    mode: currentMode,
    onAdminister: (action) => {
      administeredMedications = [...new Set([...administeredMedications, action])];
      actionHistory.push({ type: 'medication-action', action, effectModelled: false, at: new Date().toISOString() });
      renderMedicationActionPanel();
      renderActionHistoryPanel();
      renderInterfacePanels();
    }
  });
}

function downloadJson(filename, data) { const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); }
function activateTab(name) { document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active')); document.getElementById(`${name}Panel`)?.classList.add('active'); }
function labelForIntent(intent) { return INTENTS[intent]?.title || String(intent).replaceAll('_', ' '); }
function escapeHtml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
init();
