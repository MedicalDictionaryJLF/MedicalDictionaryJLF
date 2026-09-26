import { PATIENT_CASES } from './cases/index.js';
import { INTENTS } from './data/interviewSchema.js';
import { PatientEngine } from './patientEngine.js';
import { speak, chooseVoiceForPatient, initVoices } from './speech.js';
import { runSimulationTests } from './simulationRunner.js';
import { openVitalsMonitor, closeVitalsMonitor, openEcgViewer, closeEcgViewer, resizeVisibleMonitor, setMonitorPatientStateSource } from './vitalsMonitor.js';
import { initAvatarAnimator, bindAvatarToPatientState, reactAvatarToPatientReply, reactAvatarToExamination, setAvatarEmotion, setAvatarSpeaking, pulseAvatarSpeechBoundary, setAvatarViewMode } from './avatarAnimator.js';
import { phrasePatientReply, prepareAnonymousContribution, prepareQuestionWithAI, recordLearningEvent } from './aiSupport.js';
import { buildApiUrl, getAiHealth, getApiBaseUrl } from '../../src/ai/client.js';
import { showResponseLoading, removeResponseLoading } from './ui/loadingIndicator.js';
import { renderModeLayout } from './ui/modeLayout.js';
import { renderDetailsPanel } from './ui/detailsPanel.js';
import { initVoiceInput } from './ui/voiceInput.js';
import { closeModal, labsForGroup, openModal, renderLabsPanel, renderMedicationPanel } from './ui/actionPanels.js';
import { buildEncounterReport, countCompletedNoteSections, createEncounterState } from './clinicalEncounter.js';
import { renderClosingForm, renderClinicalNotesPanel, renderDifferentialPanel, renderEncounterReport, renderExaminationPanel } from './ui/clinicalEncounterPanels.js';
import { PatientStateEngine } from './patientState.js';
import { renderPatientStatePanel } from './ui/patientStatePanel.js';
import { renderAnamnesisCompanion, buildWorksheetText, getCoverageTopicState } from './ui/anamnesisCompanion.js';
import { ptT } from './ui/trainerShell.js';
import {
  buildAnonymizedPatientTrainerUpload,
  createPatientTrainerSessionRecord,
  getPatientTrainerSession,
  readPatientTrainerSessions,
  updatePatientTrainerSession,
  upsertPatientTrainerSession
} from '../../assets/js/services/patient-trainer-session-store.js';
import {
  PATIENT_TRAINER_AUTO_RETRY_LIMIT,
  PATIENT_TRAINER_CLIENT_VERSION,
  PATIENT_TRAINER_LOG_ENDPOINT
} from './config.js';

const TRAINER_CASES = PATIENT_CASES.filter((item) => item && item.id);

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
  patientSceneStatus: document.getElementById('patientSceneStatus'),
  patientEquipmentStatus: document.getElementById('patientEquipmentStatus'),
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
  coachToggleBtn: document.getElementById('coachToggleBtn'),
  coachCloseBtn: document.getElementById('coachCloseBtn'),
  coachRail: document.getElementById('coachRail'),
  coachBackdrop: document.getElementById('coachBackdrop'),
  ecgAvailabilityText: document.getElementById('ecgAvailabilityText'),
  experienceCards: [...document.querySelectorAll('[data-trainer-experience]')],
  developerAccessNote: document.getElementById('developerAccessNote'),
  finishAnamnesisBtn: document.getElementById('finishAnamnesisBtn'),
  anamnesisCompanion: document.getElementById('anamnesisCompanion'),
  anamnesisCompanionContent: document.getElementById('anamnesisCompanionContent'),
  companionToggle: document.getElementById('anamnesisCompanionToggle'),
  companionClose: document.getElementById('anamnesisCompanionClose'),
  companionBackdrop: document.getElementById('anamnesisCompanionBackdrop'),
  anamnesisDebriefModal: document.getElementById('anamnesisDebriefModal'),
  anamnesisDebriefContent: document.getElementById('anamnesisDebriefContent'),
  closeAnamnesisDebriefBtn: document.getElementById('closeAnamnesisDebriefBtn'),
  sessionHistoryList: document.getElementById('patientTrainerHistoryList'),
  sessionHistoryCount: document.getElementById('patientTrainerHistoryCount'),
  sessionRecordModal: document.getElementById('patientTrainerRecordModal'),
  sessionRecordContent: document.getElementById('patientTrainerRecordContent'),
  closeSessionRecordBtn: document.getElementById('closePatientTrainerRecordBtn')
};

let engine;
let activeCase = TRAINER_CASES[0] || null;
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
let patientStateEngine = null;
let trainerExperience = 'anamnesis';
let anamnesisWorksheetNotes = {};
let currentSession = null;
let automaticRetryRunning = false;
const developerAccess = (() => {
  const query = new URLSearchParams(window.location.search);
  if (query.get('dev') === '1') sessionStorage.setItem('pt_dev_access', '1');
  return query.get('dev') === '1' || sessionStorage.getItem('pt_dev_access') === '1';
})();
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
  TRAINER_CASES.forEach((patientCase) => {
    const option = document.createElement('option');
    option.value = patientCase.id;
    option.textContent = patientCase.title;
    els.caseSelect.appendChild(option);
  });

  if (!TRAINER_CASES.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No patient cases available';
    els.caseSelect.appendChild(option);
    els.caseSelect.disabled = true;
    if (els.startTrainingBtn) els.startTrainingBtn.disabled = true;
  } else {
    els.caseSelect.disabled = false;
    if (els.startTrainingBtn) els.startTrainingBtn.disabled = false;
    els.caseSelect.value = activeCase?.id || TRAINER_CASES[0].id;
  }


  els.experienceCards.forEach((card) => card.addEventListener('click', () => selectTrainerExperience(card.dataset.trainerExperience)));
  configureDeveloperAccess();
  els.companionToggle?.addEventListener('click', () => setCompanionOpen(true));
  els.companionClose?.addEventListener('click', () => setCompanionOpen(false));
  els.companionBackdrop?.addEventListener('click', () => setCompanionOpen(false));
  els.finishAnamnesisBtn?.addEventListener('click', finishAnamnesisOnly);
  els.closeAnamnesisDebriefBtn?.addEventListener('click', () => closeModal(els.anamnesisDebriefModal));
  els.anamnesisDebriefModal?.querySelector('[data-close="anamnesis-debrief"]')?.addEventListener('click', () => closeModal(els.anamnesisDebriefModal));
  els.closeSessionRecordBtn?.addEventListener('click', () => closeModal(els.sessionRecordModal));
  els.sessionRecordModal?.querySelector('[data-close="patient-trainer-record"]')?.addEventListener('click', () => closeModal(els.sessionRecordModal));
  window.addEventListener('pt-language-change', () => {
    renderSetupPreview();
    if (stationStarted && trainerExperience === 'anamnesis') renderAnamnesisCompanionPanel();
  });

  els.caseSelect.addEventListener('change', () => {
    activeCase = TRAINER_CASES.find((item) => item.id === els.caseSelect.value) || TRAINER_CASES[0] || null;
    renderSetupPreview();
  });
  els.randomCaseBtn?.addEventListener('click', chooseRandomCase);
  els.modeSelect?.addEventListener('change', () => { currentMode = els.modeSelect.value; renderSetupPreview(); if (stationStarted) { applyTrainerExperienceUI(); renderInterfacePanels(); renderTerminologyHint(''); renderStationHeader(); renderPatientVisualState(); persistCurrentSession(); } });
  els.difficultySelect?.addEventListener('change', () => { currentDifficulty = els.difficultySelect.value; renderSetupPreview(); if (stationStarted) { renderStationHeader(); persistCurrentSession(); } });
  els.startTrainingBtn?.addEventListener('click', startCase);
  els.restartBtn.addEventListener('click', showSetupScreen);
  els.coachToggleBtn?.addEventListener('click', () => setCoachDrawerOpen(!els.coachRail?.classList.contains('open')));
  els.coachCloseBtn?.addEventListener('click', () => setCoachDrawerOpen(false));
  els.coachBackdrop?.addEventListener('click', () => setCoachDrawerOpen(false));
  els.questionForm.addEventListener('submit', handleQuestion);
  els.finishBtn.addEventListener('click', finishCase);
  els.openVitalsBtn?.addEventListener('click', () => { patientStateEngine?.connectEquipment('monitor', true, 'Bedside monitor opened'); recordObjectiveAction('vitals', 'Live vitals monitor connected and reviewed'); openVitalsMonitor(activeCase); renderPatientVisualState(); });
  els.closeVitalsBtn?.addEventListener('click', closeVitalsMonitor);
  els.openEcgBtn?.addEventListener('click', () => { if (activeCase.ecg?.available) { patientStateEngine?.recordEcgAcquired(); recordObjectiveAction('ecg', '12-lead ECG acquired and reviewed'); openEcgViewer(activeCase); renderPatientVisualState(); } });
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
    if (button.dataset.objectiveAction === 'vitals') { patientStateEngine?.connectEquipment('monitor', true, 'Bedside monitor opened'); recordObjectiveAction('vitals', 'Live vitals monitor connected and reviewed'); openVitalsMonitor(activeCase); renderPatientVisualState(); }
    if (button.dataset.objectiveAction === 'ecg' && activeCase.ecg?.available) { patientStateEngine?.recordEcgAcquired(); recordObjectiveAction('ecg', '12-lead ECG acquired and reviewed'); openEcgViewer(activeCase); renderPatientVisualState(); }
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
  window.addEventListener('keydown', (event) => { if (event.key === 'Escape') { setCoachDrawerOpen(false); setCompanionOpen(false); closeVitalsMonitor(); closeEcgViewer(); closeModal(els.labsModal); closeModal(els.medicationModal); closeModal(els.examinationModal); closeModal(els.clinicalNotesModal); closeModal(els.differentialModal); closeModal(els.closingModal); closeModal(els.anamnesisDebriefModal); closeModal(els.sessionRecordModal); } });
  window.addEventListener('beforeunload', () => persistCurrentSession());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persistCurrentSession(); });
  window.addEventListener('online', () => retryPendingSessionUploads());

  voiceInputController = initVoiceInput({ button: els.voiceInputBtn, input: els.questionInput, status: els.voiceInputStatus });
  initVoices(() => { if (stationStarted) renderPatientMeta(); });
  selectTrainerExperience('anamnesis');
  renderSetupPreview();
  renderSessionHistory();
  showSetupScreen();
  retryPendingSessionUploads();
}

async function startCase() {
  closeVitalsMonitor();
  closeEcgViewer();
  currentMode = els.modeSelect?.value || currentMode;
  currentDifficulty = els.difficultySelect?.value || currentDifficulty;
  stationStarted = true;
  responsePending = false;
  lastDetection = null;
  anamnesisWorksheetNotes = {};
  setCompanionOpen(false);
  document.body.dataset.trainerExperience = trainerExperience;
  orderedLabs = {};
  administeredMedications = [];
  actionHistory = [];
  encounterState = createEncounterState();
  patientStateEngine = new PatientStateEngine(activeCase);
  setMonitorPatientStateSource(patientStateEngine);
  voiceInputController?.stop?.();
  els.setupScreen.hidden = true;
  els.trainingScreen.hidden = false;
  engine = new PatientEngine(activeCase, { mode: currentMode, difficulty: currentDifficulty });
  currentSession = createPatientTrainerSessionRecord({
    caseId: activeCase?.id,
    caseName: getCaseDisplayName(activeCase),
    trainerType: trainerExperience === 'full' ? 'anamnesis_examination' : 'anamnesis',
    mode: currentMode,
    difficulty: currentDifficulty,
    clientVersion: PATIENT_TRAINER_CLIENT_VERSION
  });
  els.chatLog.innerHTML = '<div class="empty-chat-note">Start the interview by introducing yourself or asking the patient an opening question.</div>';
  els.chatLog.classList.add('empty-chat');
  setQuestionPending(false);
  resetEncounterControls();
  applyTrainerExperienceUI();
  activateWorkspace('interview');
  renderStationHeader();
  renderPatientMeta();
  renderTerminologyHint('');
  renderInterfacePanels();
  await refreshAiHealthDiagnostics();
  renderInterfacePanels();
  await initAvatarAnimator(activeCase);
  bindAvatarToPatientState(patientStateEngine);
  setAvatarEmotion('neutral');
  setAvatarViewMode('encounter');
  renderPatientVisualState();
  persistCurrentSession();
  renderSessionHistory();
  els.questionInput.focus();
}

function showSetupScreen() {
  persistCurrentSession();
  setCoachDrawerOpen(false);
  setCompanionOpen(false);
  closeModal(els.anamnesisDebriefModal);
  document.body.removeAttribute('data-trainer-experience');
  stationStarted = false;
  setMonitorPatientStateSource(null);
  patientStateEngine = null;
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
  currentSession = null;
  renderSetupPreview();
  renderSessionHistory();
}

function chooseRandomCase() {
  const random = TRAINER_CASES[Math.floor(Math.random() * TRAINER_CASES.length)] || TRAINER_CASES[0];
  if (!random) return;
  activeCase = random;
  els.caseSelect.value = random.id;
  renderSetupPreview(true);
}

function renderSetupPreview(randomChosen = false) {
  if (!els.setupPreview || !activeCase) return;
  const selectedMode = els.modeSelect?.selectedOptions?.[0]?.textContent || 'Practice';
  const selectedDifficulty = els.difficultySelect?.selectedOptions?.[0]?.textContent || 'Intermediate';
  const modeHelp = currentMode === 'exam'
    ? 'Exam mode hides coaching and interpretation support until the history is finished.'
    : currentMode === 'teaching'
      ? 'Teaching mode provides the fullest interview guidance.'
      : 'Practice mode keeps broad history progress available without revealing the missing answers.';
  const experienceHelp = trainerExperience === 'full'
    ? (developerAccess ? '<strong>Developer preview:</strong> examination and the wider clinical encounter are enabled.' : '<strong>Under development:</strong> this mode is not available in the public trainer yet.')
    : '<strong>Anamnesis only:</strong> the station contains the patient interview, broad topic overview and an optional structured worksheet.';
  els.setupPreview.innerHTML = `
    <div class="setup-preview-top"><strong>${randomChosen ? 'Random station selected' : escapeHtml(activeCase.title)}</strong><span>${escapeHtml(selectedDifficulty)} · ${escapeHtml(selectedMode)}</span></div>
    <p>${experienceHelp}</p>
    <p>${escapeHtml(modeHelp)}</p>
    <small>Patient identity and case facts stay hidden until they are obtained during the interview.</small>
  `;
}
function renderStationHeader() {
  const brief = activeCase.stationBrief || { location: 'Clinical assessment room', time: 'Current simulated hospital shift', task: 'Take a focused but complete anamnesis.' };
  const task = trainerExperience === 'anamnesis'
    ? 'Take a structured patient history. Establish the presenting complaint and HPI, then cover relevant past history, medication, allergies, family/social history, substance use and red flags.'
    : brief.task;
  els.stationBrief.textContent = `${brief.location}. Time: ${brief.time}. Task: ${task}`;
  const title = document.querySelector('.station-heading h1');
  if (title) title.textContent = trainerExperience === 'anamnesis' ? 'Patient Anamnesis' : 'Patient Assessment';
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
function renderPatientVisualState() {
  if (!patientStateEngine) {
    if (els.patientSceneStatus) els.patientSceneStatus.innerHTML = '';
    if (els.patientEquipmentStatus) els.patientEquipmentStatus.innerHTML = '';
    return;
  }
  renderPatientStatePanel({
    statusContainer: els.patientSceneStatus,
    equipmentContainer: els.patientEquipmentStatus,
    snapshot: patientStateEngine.getSnapshot(),
    mode: currentMode
  });
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
  appendSessionStudentMessage(question);
  persistCurrentSession();
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
    finalizeSessionQuestion(question, reply, result, prepared.event);
    reactAvatarToPatientReply(reply, { ...result, studentInput: question });
    if (els.voiceToggle.checked) {
      speak(reply, activeCase, {
        onStart: () => setAvatarSpeaking(true, reply),
        onBoundary: () => pulseAvatarSpeechBoundary(),
        onEnd: () => setAvatarSpeaking(false),
        onError: () => setAvatarSpeaking(false)
      });
    } else {
      setAvatarSpeaking(false);
    }
    recordLearningEvent(prepared.event);
    els.questionInput.value = '';
    renderTerminologyHint(result.terminologySuggestion, result.detection?.terminologyEvent?.term);
    renderInterfacePanels();
    renderPatientMeta();
    if (trainerExperience === 'anamnesis') renderAnamnesisCompanionPanel();
    persistCurrentSession();
  } catch (error) {
    removeResponseLoading(els.chatLog);
    recordRuntimeError(error, question);
    const failureReply = 'I am sorry, I could not answer that properly. Please ask me again in another way.';
    addMessage('patient', failureReply, 'error', 'Response error');
    recordSessionRuntimeFallback(question, failureReply, error);
    renderInterfacePanels();
    persistCurrentSession();
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
  if (trainerExperience === 'anamnesis') {
    renderAnamnesisCompanionPanel();
    renderPatientVisualState();
    persistCurrentSession();
    return;
  }
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
  persistCurrentSession();
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
  if (trainerExperience === 'anamnesis') { finishAnamnesisOnly(); return; }
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
    interviewBreakdown: engine.getScoreBreakdown(),
    interviewDebrief: engine.getDebrief(),
    closingInput
  });
  actionHistory.push({ type: 'encounter-submitted', at: new Date().toISOString(), score: report.encounterScore });
  renderEncounterReport({ container: els.closingPanel, report, onContribute: () => console.info('anamnesis-anonymous-contribution-ready', prepareAnonymousContribution(engine)) });
  completeCurrentSession({ encounterReport: report, summary: engine.generateSummary() });
  els.closingPanel?.insertAdjacentHTML('beforeend', renderUploadConsentPanel(currentSession));
  bindUploadPanel(els.closingPanel, currentSession?.sessionId);
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
  if (els.finishAnamnesisBtn) els.finishAnamnesisBtn.disabled = false;
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
      patientStateEngine?.recordExamination(result.action.id, result.finding);
      reactAvatarToExamination(result.action.id, result.finding);
      renderPatientVisualState();
      renderActionHistoryPanel();
      updateEncounterToolLabels();
      persistCurrentSession();
    }
  });
}

function renderNotesPanel() {
  renderClinicalNotesPanel({
    container: els.clinicalNotesPanel,
    encounterState,
    onChange: () => { updateEncounterToolLabels(); persistCurrentSession(); }
  });
}

function renderDifferentialBoard() {
  renderDifferentialPanel({
    container: els.differentialPanel,
    encounterState,
    onChange: () => { updateEncounterToolLabels(); persistCurrentSession(); }
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
  persistCurrentSession();
}

function setCoachDrawerOpen(open) {
  const shouldOpen = Boolean(open && stationStarted);
  els.coachRail?.classList.toggle('open', shouldOpen);
  els.coachRail?.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
  els.coachToggleBtn?.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
  document.body.classList.toggle('coach-drawer-open', shouldOpen);
}

function activateWorkspace(name) {
  const requested = String(name || 'interview');
  const target = trainerExperience === 'anamnesis' ? 'interview' : requested;
  if (target === 'examination' || target === 'investigations') setCoachDrawerOpen(false);
  document.querySelectorAll('[data-workspace-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.workspacePanel === target));
  document.querySelectorAll('[data-workspace-target]').forEach((button) => button.classList.toggle('active', button.dataset.workspaceTarget === target));
  document.body.dataset.patientWorkspace = target;
  setAvatarViewMode(target === 'examination' ? 'examination' : 'encounter');
}


function configureDeveloperAccess() {
  const fullCard = els.experienceCards.find((card) => card.dataset.trainerExperience === 'full');
  if (!fullCard) return;
  if (developerAccess) {
    fullCard.classList.add('is-developer-unlocked');
    fullCard.removeAttribute('aria-disabled');
    if (els.developerAccessNote) {
      els.developerAccessNote.hidden = false;
      els.developerAccessNote.innerHTML = '<strong>Developer access enabled.</strong> The unfinished full encounter can be opened in this browser session.';
    }
  } else {
    fullCard.classList.remove('is-developer-unlocked');
    fullCard.setAttribute('aria-disabled', 'true');
    if (els.developerAccessNote) els.developerAccessNote.hidden = true;
  }
}

function selectTrainerExperience(next) {
  const requested = next === 'full' ? 'full' : 'anamnesis';
  if (requested === 'full' && !developerAccess) {
    if (els.developerAccessNote) {
      els.developerAccessNote.hidden = false;
      els.developerAccessNote.innerHTML = '<strong>Anamnesis + examination is under development.</strong> It is visible so the direction of the trainer is clear, but it is not enabled for normal users yet.';
      window.setTimeout(() => { if (!developerAccess && els.developerAccessNote) els.developerAccessNote.hidden = true; }, 4200);
    }
    return;
  }
  trainerExperience = requested;
  els.experienceCards.forEach((card) => card.classList.toggle('is-selected', card.dataset.trainerExperience === trainerExperience));
  const startLabel = trainerExperience === 'anamnesis' ? ptT('start_anamnesis') : 'Open developer encounter';
  if (els.startTrainingBtn) els.startTrainingBtn.textContent = startLabel;
  renderSetupPreview();
}

function applyTrainerExperienceUI() {
  document.body.dataset.trainerExperience = trainerExperience;
  document.body.dataset.trainerMode = currentMode;
  if (els.finishAnamnesisBtn) els.finishAnamnesisBtn.hidden = trainerExperience !== 'anamnesis';
  if (els.coachToggleBtn) els.coachToggleBtn.hidden = trainerExperience === 'anamnesis' || currentMode === 'exam';
  if (els.companionToggle) els.companionToggle.hidden = trainerExperience !== 'anamnesis' || currentMode === 'exam';
  if (els.anamnesisCompanion) els.anamnesisCompanion.hidden = trainerExperience !== 'anamnesis' || currentMode === 'exam';
  if (currentMode === 'exam') {
    setCompanionOpen(false);
    setCoachDrawerOpen(false);
  }
  if (trainerExperience === 'anamnesis') {
    setCoachDrawerOpen(false);
    setAvatarViewMode('encounter');
    renderAnamnesisCompanionPanel();
  }
}

function setCompanionOpen(open) {
  const shouldOpen = Boolean(open && stationStarted && trainerExperience === 'anamnesis' && currentMode !== 'exam');
  document.body.classList.toggle('pt-companion-open', shouldOpen);
  els.anamnesisCompanion?.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
}

function renderAnamnesisCompanionPanel() {
  if (!engine || trainerExperience !== 'anamnesis') return;
  applyTrainerExperienceUIStateOnly();
  if (currentMode === 'exam') return;
  renderAnamnesisCompanion({
    container: els.anamnesisCompanionContent,
    engine,
    patientCase: activeCase,
    mode: currentMode,
    notes: anamnesisWorksheetNotes,
    onNotesChange: (id, value) => { anamnesisWorksheetNotes[id] = value; persistCurrentSession(); }
  });
}

function applyTrainerExperienceUIStateOnly() {
  document.body.dataset.trainerMode = currentMode;
  if (els.companionToggle) els.companionToggle.hidden = trainerExperience !== 'anamnesis' || currentMode === 'exam';
  if (els.anamnesisCompanion) els.anamnesisCompanion.hidden = trainerExperience !== 'anamnesis' || currentMode === 'exam';
}

function finishAnamnesisOnly() {
  if (!engine || trainerExperience !== 'anamnesis') return;
  const debrief = engine.getDebrief();
  const breakdown = debrief.scoreBreakdown || {};
  const misses = (debrief.missedCaseCritical || []).map(labelForIntent);
  const communicationIssues = debrief.communication?.issues || [];
  const resolutionIssues = debrief.resolutionIssues || [];
  const worksheet = buildWorksheetText({ patientCase: activeCase, notes: anamnesisWorksheetNotes });
  completeCurrentSession({ debrief, summary: engine.generateSummary(), worksheet });
  const sectionRows = (debrief.studentCoverage || [])
    .filter((row) => row.id !== 'objective')
    .map((row) => `<div class="anamnesis-debrief-row"><span>${escapeHtml(row.title)}</span><strong>${row.asked}/${row.total}</strong><i><b style="width:${Math.max(0, Math.min(100, Number(row.percent || 0)))}%"></b></i></div>`)
    .join('');
  els.anamnesisDebriefContent.innerHTML = `
    <section class="anamnesis-score-hero"><div><span>History score</span><strong>${Number(debrief.score || 0)}%</strong></div><p>This score reflects what you attempted to ask, not what the language engine happened to recognise.</p></section>
    <section class="anamnesis-score-grid">
      ${debriefMetric('Essential history', breakdown.essential)}
      ${debriefMetric('Case-critical history', breakdown.caseCritical)}
      ${debriefMetric('Comprehensive breadth', breakdown.comprehensive)}
      ${debriefMetric('Communication', breakdown.communication)}
    </section>
    <section class="anamnesis-debrief-section"><h3>Section coverage</h3><div class="anamnesis-debrief-rows">${sectionRows}</div></section>
    <section class="anamnesis-debrief-section"><h3>Important omissions</h3>${misses.length ? `<div class="anamnesis-chip-list">${misses.map((label) => `<span>${escapeHtml(label)}</span>`).join('')}</div>` : '<p>No case-critical omissions detected.</p>'}</section>
    ${communicationIssues.length ? `<section class="anamnesis-debrief-section"><h3>Communication</h3><ul>${communicationIssues.slice(0,8).map((issue) => `<li>${escapeHtml(issue.question || '')}${issue.type ? ` <small>(${escapeHtml(String(issue.type).replaceAll('_',' '))})</small>` : ''}</li>`).join('')}</ul></section>` : ''}
    ${resolutionIssues.length ? `<section class="anamnesis-debrief-section simulator-note"><h3>Simulator recognition</h3><p>${resolutionIssues.length} question${resolutionIssues.length===1?' was':'s were'} clinically attempted but not cleanly resolved by the simulator. These are kept separate from your omissions.</p></section>` : ''}
    <details class="anamnesis-report-details"><summary>Structured history collected</summary><pre>${escapeHtml(engine.generateSummary())}</pre></details>
    ${worksheet ? `<details class="anamnesis-report-details"><summary>Your worksheet notes</summary><pre>${escapeHtml(worksheet)}</pre></details>` : ''}
    ${renderUploadConsentPanel(currentSession)}
  `;
  bindUploadPanel(els.anamnesisDebriefContent, currentSession?.sessionId);
  lockCompletedInterviewControls();
  openModal(els.anamnesisDebriefModal);
}

function debriefMetric(label, value) {
  const safe = Math.max(0, Math.min(100, Number(value || 0)));
  return `<article><span>${escapeHtml(label)}</span><strong>${safe}%</strong><i><b style="width:${safe}%"></b></i></article>`;
}

function getCaseDisplayName(patientCase) {
  return String(patientCase?.title || patientCase?.id || 'Patient Trainer case').trim();
}

function appendSessionStudentMessage(question) {
  if (!currentSession) return;
  currentSession.messages = Array.isArray(currentSession.messages) ? currentSession.messages : [];
  currentSession.messages.push({
    timestamp: new Date().toISOString(),
    speaker: 'student',
    text: String(question || ''),
    pending: true
  });
}

function finalizeSessionQuestion(question, reply, result, aiEvent = null) {
  if (!currentSession) return;
  const detection = result?.detection || {};
  const matchedIntentIds = (detection.answerIntents || []).map((item) => String(item?.id || '')).filter(Boolean);
  const detectedIntent = String(result?.detectedIntent || detection.primaryIntent?.id || 'unknown');
  const topCandidate = detection.candidates?.[0] || null;
  const confidence = Number.isFinite(Number(result?.confidence)) ? Number(result.confidence) : Number(detection.confidence || 0);
  const fallbackUsed = Boolean(aiEvent?.fallbackUsed) || detection.responseScope === 'clarification' || detection.responseScope === 'terminology_not_understood' || detectedIntent === 'unknown' || confidence < 0.45;
  const diagnostics = {
    normalizedQuestion: String(detection.normalized || ''),
    detectedIntent,
    matchedIntent: String(detection.primaryIntent?.id || ''),
    matchedIntentIds,
    matchedQuestionAnswerId: matchedIntentIds[0] || String(detection.primaryIntent?.id || ''),
    confidence,
    matchScore: Number.isFinite(Number(topCandidate?.score)) ? Number(topCandidate.score) : confidence,
    matchKind: String(detection.kind || ''),
    responseScope: String(detection.responseScope || ''),
    fallbackUsed,
    feedbackLabel: String(result?.feedbackLabel || ''),
    aiSelectedIntent: String(aiEvent?.aiSelectedIntent || ''),
    aiConfidence: Number.isFinite(Number(aiEvent?.aiConfidence)) ? Number(aiEvent.aiConfidence) : null,
    aiAttempted: Boolean(aiEvent?.aiAttempted),
    aiSucceeded: Boolean(aiEvent?.aiSucceeded),
    aiRescueUsed: Boolean(aiEvent?.aiRescueUsed),
    finalResolutionSource: String(aiEvent?.finalResolutionSource || '')
  };

  const student = [...(currentSession.messages || [])].reverse().find((message) => message.speaker === 'student' && message.pending && message.text === question);
  if (student) Object.assign(student, diagnostics, { pending: false });
  currentSession.messages.push({
    timestamp: new Date().toISOString(),
    speaker: 'patient',
    text: String(reply || ''),
    returnedAnswer: String(reply || ''),
    ...diagnostics
  });

  if (fallbackUsed) {
    currentSession.fallbackQuestions = Array.isArray(currentSession.fallbackQuestions) ? currentSession.fallbackQuestions : [];
    currentSession.fallbackQuestions.push({
      timestamp: new Date().toISOString(),
      rawStudentQuestion: String(question || ''),
      normalizedQuestion: diagnostics.normalizedQuestion,
      detectedIntent: diagnostics.detectedIntent,
      matchedIntent: diagnostics.matchedIntent,
      matchedIntentIds,
      confidence: diagnostics.confidence,
      matchScore: diagnostics.matchScore,
      matchKind: diagnostics.matchKind,
      responseScope: diagnostics.responseScope,
      fallbackUsed: true,
      aiSelectedIntent: diagnostics.aiSelectedIntent,
      aiConfidence: diagnostics.aiConfidence,
      aiAttempted: diagnostics.aiAttempted,
      aiSucceeded: diagnostics.aiSucceeded,
      aiRescueUsed: diagnostics.aiRescueUsed,
      finalResolutionSource: diagnostics.finalResolutionSource,
      returnedPatientAnswer: String(reply || '')
    });
  }
}

function recordSessionRuntimeFallback(question, reply, error) {
  if (!currentSession) return;
  const message = String(error?.message || error || 'Unknown response error');
  const student = [...(currentSession.messages || [])].reverse().find((item) => item.speaker === 'student' && item.pending && item.text === question);
  if (student) Object.assign(student, { pending: false, detectedIntent: 'error', fallbackUsed: true });
  currentSession.messages.push({
    timestamp: new Date().toISOString(),
    speaker: 'patient',
    text: String(reply || ''),
    returnedAnswer: String(reply || ''),
    detectedIntent: 'error',
    matchKind: 'runtime_error',
    responseScope: 'clarification',
    fallbackUsed: true
  });
  currentSession.fallbackQuestions = Array.isArray(currentSession.fallbackQuestions) ? currentSession.fallbackQuestions : [];
  currentSession.fallbackQuestions.push({
    timestamp: new Date().toISOString(),
    rawStudentQuestion: String(question || ''),
    normalizedQuestion: '',
    detectedIntent: 'error',
    matchedIntent: '',
    matchedIntentIds: [],
    confidence: 0,
    matchScore: 0,
    matchKind: 'runtime_error',
    responseScope: 'clarification',
    fallbackUsed: true,
    returnedPatientAnswer: String(reply || ''),
    error: message.slice(0, 500)
  });
}

function collectSessionExaminations() {
  return (actionHistory || []).map((item) => ({
    type: String(item.type || ''),
    id: String(item.examinationId || item.groupId || item.action || ''),
    label: String(item.label || item.action || item.groupId || item.type || ''),
    timestamp: String(item.at || ''),
    resultKeys: Array.isArray(item.resultKeys) ? item.resultKeys.map(String) : undefined,
    effectModelled: item.effectModelled === undefined ? undefined : Boolean(item.effectModelled),
    effectMessage: item.effectMessage ? String(item.effectMessage).slice(0, 2000) : undefined
  }));
}

function persistCurrentSession({ touch = true } = {}) {
  if (!currentSession || !engine) return currentSession;
  const now = new Date().toISOString();
  const topicState = getCoverageTopicState({ engine, patientCase: activeCase });
  const endMs = Date.parse(currentSession.completedAt || now) || Date.now();
  const startMs = Date.parse(currentSession.startedAt || now) || endMs;
  const runtimeState = currentSession.completed ? null : {
    engineState: engine.exportState?.() || null,
    orderedLabs: cloneJson(orderedLabs),
    administeredMedications: cloneJson(administeredMedications),
    actionHistory: cloneJson(actionHistory),
    encounterState: cloneJson(encounterState),
    patientState: patientStateEngine?.getSnapshot?.() || null,
    worksheetNotes: cloneJson(anamnesisWorksheetNotes),
    lastDetection: cloneJson(lastDetection),
    activeWorkspace: document.body.dataset.patientWorkspace || 'interview'
  };
  currentSession = upsertPatientTrainerSession({
    ...currentSession,
    caseId: activeCase?.id || currentSession.caseId,
    caseName: getCaseDisplayName(activeCase) || currentSession.caseName,
    trainerType: trainerExperience === 'full' ? 'anamnesis_examination' : 'anamnesis',
    mode: currentMode,
    difficulty: currentDifficulty,
    lastActivityAt: touch && !currentSession.completed ? now : currentSession.lastActivityAt,
    durationSeconds: Math.max(0, Math.round((endMs - startMs) / 1000)),
    examinations: collectSessionExaminations(),
    coveredTopics: topicState.covered.map((topic) => topic.id),
    uncoveredTopics: topicState.uncovered.map((topic) => topic.id),
    runtimeState,
    clientVersion: PATIENT_TRAINER_CLIENT_VERSION
  }) || currentSession;
  return currentSession;
}

function completeCurrentSession(finalRecord = {}) {
  if (!currentSession || !engine) return;
  const completedAt = currentSession.completedAt || new Date().toISOString();
  currentSession = {
    ...currentSession,
    completed: true,
    completedAt,
    lastActivityAt: completedAt,
    finalRecord: cloneJson(finalRecord)
  };
  persistCurrentSession({ touch: false });
  renderSessionHistory();
}

function lockCompletedInterviewControls() {
  responsePending = true;
  if (els.sendQuestionBtn) { els.sendQuestionBtn.disabled = true; els.sendQuestionBtn.textContent = 'Completed'; }
  if (els.questionInput) { els.questionInput.readOnly = true; els.questionInput.placeholder = 'This session has been completed.'; }
  if (els.finishAnamnesisBtn) els.finishAnamnesisBtn.disabled = true;
}

function renderSessionHistory() {
  if (!els.sessionHistoryList) return;
  const sessions = readPatientTrainerSessions();
  if (els.sessionHistoryCount) els.sessionHistoryCount.textContent = `${sessions.length} session${sessions.length === 1 ? '' : 's'}`;
  if (!sessions.length) {
    els.sessionHistoryList.innerHTML = '<div class="pt-history-empty">No Patient Trainer sessions saved yet.</div>';
    return;
  }
  els.sessionHistoryList.innerHTML = sessions.map((session) => {
    const when = formatSessionLocalDateTime(session.startedAt);
    const mode = capitalizeWord(session.mode);
    const type = session.trainerType === 'anamnesis_examination' ? 'Anamnesis + Examination' : 'Anamnesis';
    const status = session.completed ? 'Completed' : 'In progress';
    const action = session.completed ? 'View record' : 'Continue session';
    return `<article class="pt-history-row ${session.completed ? 'is-completed' : 'is-progress'}">
      <div class="pt-history-date"><strong>${escapeHtml(when.date)}</strong><span>${escapeHtml(when.time)}</span></div>
      <div class="pt-history-main"><strong>${escapeHtml(session.caseName || session.caseId || 'Patient case')}</strong><span>${escapeHtml(mode)} · ${escapeHtml(type)}</span></div>
      <span class="pt-history-status">${escapeHtml(status)}</span>
      <button type="button" class="secondary pt-history-action" data-session-action="${session.completed ? 'view' : 'continue'}" data-session-id="${escapeHtml(session.sessionId)}">${action}</button>
    </article>`;
  }).join('');
  els.sessionHistoryList.querySelectorAll('[data-session-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const sessionId = button.dataset.sessionId || '';
      if (button.dataset.sessionAction === 'continue') restorePatientTrainerSession(sessionId);
      else viewPatientTrainerRecord(sessionId);
    });
  });
}

async function restorePatientTrainerSession(sessionId) {
  const saved = getPatientTrainerSession(sessionId);
  if (!saved || saved.completed || !saved.runtimeState) return;
  const patientCase = TRAINER_CASES.find((item) => item.id === saved.caseId);
  if (!patientCase) {
    showHistoryMessage('This saved session cannot be continued because its case is no longer available.');
    return;
  }

  closeVitalsMonitor();
  closeEcgViewer();
  activeCase = patientCase;
  currentMode = ['practice', 'teaching', 'exam'].includes(saved.mode) ? saved.mode : 'practice';
  currentDifficulty = saved.difficulty || 'intermediate';
  trainerExperience = saved.trainerType === 'anamnesis_examination' ? 'full' : 'anamnesis';
  currentSession = saved;
  stationStarted = true;
  responsePending = false;
  lastDetection = cloneJson(saved.runtimeState.lastDetection || null);
  anamnesisWorksheetNotes = cloneJson(saved.runtimeState.worksheetNotes || {});
  orderedLabs = cloneJson(saved.runtimeState.orderedLabs || {});
  administeredMedications = cloneJson(saved.runtimeState.administeredMedications || []);
  actionHistory = cloneJson(saved.runtimeState.actionHistory || []);
  encounterState = mergeEncounterState(saved.runtimeState.encounterState);
  patientStateEngine = new PatientStateEngine(activeCase);
  patientStateEngine.restoreSnapshot?.(saved.runtimeState.patientState);
  setMonitorPatientStateSource(patientStateEngine);
  engine = new PatientEngine(activeCase, { mode: currentMode, difficulty: currentDifficulty });
  engine.restoreState?.(saved.runtimeState.engineState || {});

  if (els.caseSelect) els.caseSelect.value = activeCase.id;
  if (els.modeSelect) els.modeSelect.value = currentMode;
  if (els.difficultySelect) els.difficultySelect.value = currentDifficulty;
  els.experienceCards.forEach((card) => card.classList.toggle('is-selected', card.dataset.trainerExperience === trainerExperience));
  if (els.startTrainingBtn) els.startTrainingBtn.textContent = trainerExperience === 'anamnesis' ? ptT('start_anamnesis') : 'Open developer encounter';
  voiceInputController?.stop?.();
  els.setupScreen.hidden = true;
  els.trainingScreen.hidden = false;
  renderStoredChat(saved.messages || []);
  setQuestionPending(false);
  resetEncounterControls();
  applyTrainerExperienceUI();
  activateWorkspace(saved.runtimeState.activeWorkspace || 'interview');
  renderStationHeader();
  renderPatientMeta();
  renderTerminologyHint('');
  renderInterfacePanels();
  await refreshAiHealthDiagnostics();
  renderInterfacePanels();
  await initAvatarAnimator(activeCase);
  bindAvatarToPatientState(patientStateEngine);
  setAvatarEmotion('neutral');
  setAvatarViewMode((saved.runtimeState.activeWorkspace || 'interview') === 'examination' ? 'examination' : 'encounter');
  renderPatientVisualState();
  persistCurrentSession();
  els.questionInput?.focus();
}

function renderStoredChat(messages) {
  els.chatLog.innerHTML = '';
  els.chatLog.classList.remove('empty-chat');
  const rows = (messages || []).filter((message) => message && (message.speaker === 'student' || message.speaker === 'patient'));
  if (!rows.length) {
    els.chatLog.innerHTML = '<div class="empty-chat-note">Start the interview by introducing yourself or asking the patient an opening question.</div>';
    els.chatLog.classList.add('empty-chat');
    return;
  }
  rows.forEach((message) => addMessage(message.speaker, message.text || '', message.matchedIntent || message.detectedIntent || '', message.feedbackLabel || ''));
}

function viewPatientTrainerRecord(sessionId) {
  const session = getPatientTrainerSession(sessionId);
  if (!session || !session.completed || !els.sessionRecordContent) return;
  const when = formatSessionLocalDateTime(session.startedAt);
  const mode = capitalizeWord(session.mode);
  const type = session.trainerType === 'anamnesis_examination' ? 'Anamnesis + Examination' : 'Anamnesis';
  const score = session.finalRecord?.debrief?.score ?? session.finalRecord?.encounterReport?.encounterScore;
  els.sessionRecordContent.innerHTML = `
    <section class="pt-record-summary">
      <div><span>Date</span><strong>${escapeHtml(`${when.date} ${when.time}`)}</strong></div>
      <div><span>Case</span><strong>${escapeHtml(session.caseName || session.caseId)}</strong></div>
      <div><span>Mode</span><strong>${escapeHtml(mode)}</strong></div>
      <div><span>Type</span><strong>${escapeHtml(type)}</strong></div>
      ${score !== undefined ? `<div><span>Score</span><strong>${escapeHtml(String(score))}%</strong></div>` : ''}
    </section>
    <section class="pt-record-transcript"><h3>Transcript</h3>${(session.messages || []).map((message) => `<article class="pt-record-message ${message.speaker === 'patient' ? 'patient' : 'student'}"><strong>${message.speaker === 'patient' ? 'Patient' : 'Student'}</strong><p>${escapeHtml(message.text || '')}</p></article>`).join('') || '<p>No transcript messages were recorded.</p>'}</section>
    ${renderUploadConsentPanel(session)}
  `;
  bindUploadPanel(els.sessionRecordContent, session.sessionId);
  openModal(els.sessionRecordModal);
}

function renderUploadConsentPanel(session) {
  if (!session?.completed) return '';
  if (session.uploaded) {
    return `<section class="pt-upload-panel is-success" data-pt-upload-panel="${escapeHtml(session.sessionId)}"><h3>Session submitted</h3><p>An anonymised improvement copy was submitted successfully. Your local session record remains available here.</p></section>`;
  }
  const retry = Boolean(session.uploadRequested || session.lastUploadError);
  const status = session.lastUploadError
    ? `<p class="pt-upload-status is-error">Session saved locally. Upload could not be completed.</p>`
    : '<p class="pt-upload-status">No session is uploaded until you choose to submit it.</p>';
  return `<section class="pt-upload-panel" data-pt-upload-panel="${escapeHtml(session.sessionId)}">
    <h3>Help improve Patient Trainer</h3>
    <p>An anonymised session record may be submitted to help identify questions and topics that Patient Trainer does not yet recognise reliably. The improvement copy uses an internal anonymous user ID and does not include your account name, email, passwords, tokens, cookies, or unrelated Medical Dictionary data.</p>
    ${status}
    <button type="button" class="start-training-btn pt-submit-session" data-submit-session="${escapeHtml(session.sessionId)}">${retry ? 'Retry upload' : 'Submit session'}</button>
  </section>`;
}

function bindUploadPanel(container, sessionId) {
  if (!container || !sessionId) return;
  container.querySelectorAll('[data-submit-session]').forEach((button) => {
    if (button.dataset.submitSession !== sessionId) return;
    button.addEventListener('click', () => submitSessionUpload(sessionId, { automatic: false }));
  });
}

async function submitSessionUpload(sessionId, { automatic = false } = {}) {
  let session = getPatientTrainerSession(sessionId);
  if (!session || !session.completed || session.uploaded) return;
  if (automatic && (!session.uploadRequested || session.automaticRetryCount >= PATIENT_TRAINER_AUTO_RETRY_LIMIT)) return;

  session = updatePatientTrainerSession(sessionId, {
    uploadRequested: true,
    uploadAttempts: Number(session.uploadAttempts || 0) + 1,
    automaticRetryCount: Number(session.automaticRetryCount || 0) + (automatic ? 1 : 0),
    lastUploadError: ''
  }) || session;
  if (currentSession?.sessionId === sessionId) currentSession = session;
  refreshUploadPanels(sessionId);

  if (!navigator.onLine) {
    recordUploadFailure(sessionId, 'Device is offline.');
    return;
  }
  if (!String(PATIENT_TRAINER_LOG_ENDPOINT || '').trim()) {
    recordUploadFailure(sessionId, 'Patient Trainer log endpoint is not configured.');
    return;
  }

  try {
    const payload = buildAnonymizedPatientTrainerUpload(session);
    const response = await fetch(PATIENT_TRAINER_LOG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    let body = null;
    try { body = await response.json(); } catch { throw new Error(`Upload returned a malformed response (${response.status}).`); }
    if (!response.ok || !body || body.ok !== true) throw new Error(String(body?.error || `Upload failed (${response.status}).`));
    if (String(body.sessionId || '') !== session.sessionId) throw new Error('Upload confirmation did not match this session.');
    if (!String(body.filename || '').trim()) throw new Error('Upload confirmation did not include a filename.');

    const updated = updatePatientTrainerSession(sessionId, {
      uploaded: true,
      uploadedAt: String(body.receivedAt || new Date().toISOString()),
      uploadId: String(body.uploadId || body.filename || ''),
      uploadFilename: String(body.filename || ''),
      lastUploadError: ''
    });
    if (currentSession?.sessionId === sessionId && updated) currentSession = updated;
    refreshUploadPanels(sessionId);
    renderSessionHistory();
  } catch (error) {
    recordUploadFailure(sessionId, error?.message || String(error));
  }
}

function recordUploadFailure(sessionId, errorMessage) {
  const updated = updatePatientTrainerSession(sessionId, { uploaded: false, lastUploadError: String(errorMessage || 'Upload failed.').slice(0, 500) });
  if (currentSession?.sessionId === sessionId && updated) currentSession = updated;
  refreshUploadPanels(sessionId);
  renderSessionHistory();
}

function refreshUploadPanels(sessionId) {
  const session = getPatientTrainerSession(sessionId);
  if (!session) return;
  document.querySelectorAll('[data-pt-upload-panel]').forEach((panel) => {
    if (panel.dataset.ptUploadPanel !== sessionId) return;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderUploadConsentPanel(session).trim();
    const replacement = wrapper.firstElementChild;
    if (!replacement) return;
    panel.replaceWith(replacement);
    bindUploadPanel(replacement.parentElement || document, sessionId);
  });
}

async function retryPendingSessionUploads() {
  if (automaticRetryRunning || !navigator.onLine) return;
  const pending = readPatientTrainerSessions()
    .filter((session) => session.completed && session.uploadRequested && !session.uploaded && Number(session.automaticRetryCount || 0) < PATIENT_TRAINER_AUTO_RETRY_LIMIT)
    .slice(0, 3);
  if (!pending.length) return;
  automaticRetryRunning = true;
  try {
    for (const session of pending) await submitSessionUpload(session.sessionId, { automatic: true });
  } finally {
    automaticRetryRunning = false;
  }
}

function formatSessionLocalDateTime(value) {
  const date = new Date(value || Date.now());
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const dateText = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bratislava', year: 'numeric', month: '2-digit', day: '2-digit' }).format(safe);
  const timeText = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bratislava', hour: '2-digit', minute: '2-digit', hour12: false }).format(safe);
  return { date: dateText, time: timeText };
}

function mergeEncounterState(saved) {
  const base = createEncounterState();
  const source = saved && typeof saved === 'object' ? saved : {};
  return {
    ...base,
    ...cloneJson(source),
    examined: Array.isArray(source.examined) ? [...source.examined] : [],
    examFindings: { ...base.examFindings, ...(source.examFindings || {}) },
    notes: { ...base.notes, ...(source.notes || {}) },
    differentials: Array.isArray(source.differentials) ? [...source.differentials] : [],
    closing: { ...base.closing, ...(source.closing || {}) }
  };
}

function showHistoryMessage(message) {
  if (!els.sessionHistoryList) return;
  const note = document.createElement('div');
  note.className = 'pt-history-message';
  note.textContent = message;
  els.sessionHistoryList.prepend(note);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  try { return structuredClone(value); } catch {}
  return JSON.parse(JSON.stringify(value));
}

function capitalizeWord(value) {
  const text = String(value || '');
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : '';
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
    return `<div class="history-row"><span>${escapeHtml(label)}${item.effectModelled ? '<em class="effect-modelled"> · state updated</em>' : ''}</span><small>${escapeHtml(new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</small>${item.effectMessage ? `<div class="management-effect-note">${escapeHtml(item.effectMessage)}</div>` : ''}</div>`;
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
    patientState: patientStateEngine?.getSnapshot?.() || null,
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
      const effect = patientStateEngine?.applyClinicalAction(action) || { matched: false, message: '' };
      actionHistory.push({ type: 'medication-action', action, effectModelled: Boolean(effect.matched), effectMessage: effect.message || '', at: new Date().toISOString() });
      if (effect.message) encounterState.notes.investigations = mergeNote(encounterState.notes.investigations, `Management response: ${effect.message}`);
      renderPatientVisualState();
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
