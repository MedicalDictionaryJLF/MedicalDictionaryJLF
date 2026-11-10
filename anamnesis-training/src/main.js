import { PATIENT_CASES } from './cases/index.js?v=pilot-1';
import { INTENTS } from './data/interviewSchema.js?v=134';
import { getPositionRequest } from './dialogue/positionRequests.js?v=positioning-all-modes';
import { POSITIONING_COMMANDS, POSITIONING_REPLIES } from './data/positioningCommands.js?v=2';
import { PatientEngine } from './patientEngine.js?v=pilot-1';
import { renderAnamnesisDebrief } from './ui/anamnesisDebrief.js?v=pilot-1';
import { speak, chooseVoiceForPatient, initVoices } from './speech.js';
import { runSimulationTests } from './simulationRunner.js?v=134';
import { openVitalsMonitor, closeVitalsMonitor, openEcgViewer, closeEcgViewer, resizeVisibleMonitor, setMonitorPatientStateSource } from './vitalsMonitor.js';
import { initAvatarAnimator, bindAvatarToPatientState, reactAvatarToPatientReply, setAvatarEmotion, setAvatarSpeaking, pulseAvatarSpeechBoundary, setAvatarViewMode, setAvatarExamTool, applyAvatarPositionRequest, isAvatarEnvironmentReady, disposeAvatarAnimator, lockAvatarExaminations } from './avatarAnimator.js?v=bed-contact';
import { isAIAvailable, prepareAnonymousContribution, prepareQuestionWithAI } from './aiSupport.js?v=pilot-1';
import { showResponseLoading, removeResponseLoading } from './ui/loadingIndicator.js';
import { renderModeLayout } from './ui/modeLayout.js?v=134';
import { renderDetailsPanel } from './ui/detailsPanel.js';
import { initVoiceInput } from './ui/voiceInput.js';
import { closeModal, labsForGroup, openModal, renderLabsPanel, renderMedicationPanel } from './ui/actionPanels.js';
import { buildEncounterReport, countCompletedNoteSections, createEncounterState, performExamination, recordEcgProgress, evaluateExamination } from './clinicalEncounter.js?v=positioning-all-modes';
import { renderClosingForm, renderClinicalNotesPanel, renderDifferentialPanel, renderEncounterReport, renderExaminationPanel } from './ui/clinicalEncounterPanels.js?v=chat-positioning-1';
import { PatientStateEngine } from './patientState.js';
import { renderPatientStatePanel } from './ui/patientStatePanel.js';
import { renderAnamnesisCompanion, buildWorksheetText, getCoverageTopicState } from './ui/anamnesisCompanion.js?v=134';
import { ptT } from './ui/trainerShell.js?v=134';
import {
  buildAnonymizedPatientTrainerUpload,
  createPatientTrainerSessionRecord,
  deletePatientTrainerSession,
  getPatientTrainerSession,
  readPatientTrainerSessions,
  updatePatientTrainerSession,
  upsertPatientTrainerSession
} from '../../assets/js/services/patient-trainer-session-store.js?v=20261109-history-nav';
import {
  PATIENT_TRAINER_AUTO_RETRY_LIMIT,
  PATIENT_TRAINER_CLIENT_VERSION,
  PATIENT_TRAINER_LOG_ENDPOINT
} from './config.js?v=pilot-1';

const TRAINER_CASES = PATIENT_CASES.filter((item) => item && item.id);

const els = {
  caseSelect: document.getElementById('caseSelect'),
  setupScreen: document.getElementById('setupScreen'),
  ptBackLink: document.getElementById('ptBackLink'),
  trainingScreen: document.getElementById('trainingScreen'),
  modeSelect: document.getElementById('modeSelect'),
  difficultySelect: document.getElementById('difficultySelect'),
  interviewLanguageSelect: document.getElementById('interviewLanguageSelect'),
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
  anamnesisDiagnostics: document.getElementById('anamnesisDiagnostics'),
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
let patientPosition = 'seated';
let currentDifficulty = 'intermediate';
let currentInterviewLanguage = 'en';
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
let stationGeneration = 0;
const uploadInFlight = new Set();
const aiDiagnostics = {
  enabled: isAIAvailable(),
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
  els.ptBackLink?.addEventListener('click', (event) => {
    // Within an attempt, return to Patient Trainer without navigating to /main/.
    // The normal link remains available from the case-selection screen.
    if (!stationStarted || els.trainingScreen.hidden) return;
    event.preventDefault();
    showSetupScreen();
  });
  els.coachToggleBtn?.addEventListener('click', () => setCoachDrawerOpen(!els.coachRail?.classList.contains('open')));
  els.coachCloseBtn?.addEventListener('click', () => setCoachDrawerOpen(false));
  els.coachBackdrop?.addEventListener('click', () => setCoachDrawerOpen(false));
  els.questionForm.addEventListener('submit', handleQuestion);
  els.finishBtn.addEventListener('click', finishCase);
  els.openVitalsBtn?.addEventListener('click', openCaseVitals);
  els.closeVitalsBtn?.addEventListener('click', closeVitalsMonitor);
  els.openEcgBtn?.addEventListener('click', openEcgPlacement);
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
    if (button.dataset.objectiveAction === 'vitals') openCaseVitals();
    if (button.dataset.objectiveAction === 'ecg') openEcgPlacement();
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
  const stationToken = ++stationGeneration;
  disposeAvatarAnimator();
  closeVitalsMonitor();
  closeEcgViewer();
  currentMode = els.modeSelect?.value || currentMode;
  patientPosition = 'seated';
  currentDifficulty = els.difficultySelect?.value || currentDifficulty;
  currentInterviewLanguage = els.interviewLanguageSelect?.value || currentInterviewLanguage;
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
  updatePatientTrainerBackLink();
  engine = new PatientEngine(activeCase, { mode: currentMode, difficulty: currentDifficulty, interviewLanguage: currentInterviewLanguage });
  currentSession = createPatientTrainerSessionRecord({
    caseId: activeCase?.id,
    caseName: getCaseDisplayName(activeCase),
    trainerType: trainerExperience === 'full' ? 'anamnesis_examination' : 'anamnesis',
    mode: currentMode,
    difficulty: currentDifficulty,
    clientVersion: PATIENT_TRAINER_CLIENT_VERSION
  });
  currentSession.interviewLanguage = currentInterviewLanguage;
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
  if (!stationStarted || stationToken !== stationGeneration) return;
  await initAvatarAnimator(activeCase, { allowInspection: trainerExperience === 'full', trainingMode: currentMode, patientPosition, placedLeads: encounterState.ecg.placedLeads, ecgCompleted: encounterState.ecg.completed, completed: encounterState.completed });
  if (!stationStarted || stationToken !== stationGeneration) return;
  bindAvatarToPatientState(patientStateEngine);
  setAvatarEmotion('neutral');
  setAvatarViewMode('encounter');
  renderPatientVisualState();
  persistCurrentSession();
  renderSessionHistory();
  els.questionInput.focus();
}

function updatePatientTrainerBackLink() {
  if (!els.ptBackLink) return;
  const description = stationStarted && !els.trainingScreen.hidden
    ? 'Back to Patient Trainer menu'
    : 'Back to Medical Dictionary';
  els.ptBackLink.setAttribute('aria-label', description);
  els.ptBackLink.setAttribute('title', description);
}

function showSetupScreen() {
  persistCurrentSession();
  stationGeneration += 1;
  disposeAvatarAnimator();
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
  updatePatientTrainerBackLink();
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
    ? 'Exam mode hides coaching, semantic labels and coverage until the history is finished.'
    : currentMode === 'teaching'
      ? 'Teaching mode shows the relevant curriculum, model questions and live coverage.'
      : 'Practice mode shows section-level progress only and does not reveal the missing questions.';
  const difficultyHelp = currentDifficulty === 'beginner'
    ? 'Beginner patients volunteer a little more information and are more forgiving of broad questions.'
    : currentDifficulty === 'advanced'
      ? 'Advanced patients answer more narrowly and may need rapport or respectful framing before sensitive disclosures.'
      : 'Intermediate difficulty uses realistic, moderately focused answers.';
  const experienceHelp = trainerExperience === 'full'
    ? '<strong>Anamnesis + examination:</strong> interview the patient, examine the 3D body, collect supported findings and submit your clinical assessment.'
    : '<strong>Anamnesis only:</strong> the station contains the patient interview, broad topic overview and an optional structured worksheet.';
  els.setupPreview.innerHTML = `
    <div class="setup-preview-top"><strong>${randomChosen ? 'Random station selected' : escapeHtml(activeCase.title)}</strong><span>${escapeHtml(selectedDifficulty)} · ${escapeHtml(selectedMode)}</span></div>
    <p>${experienceHelp}</p>
    <p>${escapeHtml(modeHelp)}</p>
    <p>Ask the patient to change position in chat.${els.modeSelect?.value === 'teaching' ? ' You can also use the positioning buttons in the 3D view.' : ''}</p>
    <p>${escapeHtml(difficultyHelp)}</p>
    <small>Patient identity and case facts stay hidden until they are obtained during the interview.</small>
    <small>${escapeHtml(ptT('interview_language_note'))}</small>
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
    els.openEcgBtn.disabled = !isAvatarEnvironmentReady() || encounterState.completed;
    els.openEcgBtn.title = available ? 'Place 10 electrodes on the patient before viewing the case ECG' : 'Practice placing 10 electrodes; no case-specific tracing is supplied';
    els.openEcgBtn.setAttribute('aria-label', 'Practice 12-lead ECG placement on the patient');
  }
  if (els.ecgAvailabilityText) els.ecgAvailabilityText.textContent = `${encounterState.ecg.placedLeads.length}/10 electrodes · ${activeCase.ecg?.available ? 'case tracing supplied' : 'no case tracing'}`;
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
  const tag = currentMode === 'teaching' && (feedbackLabel || intent) ? `<span>${escapeHtml(feedbackLabel || labelForIntent(intent))}</span>` : '';
  bubble.innerHTML = `<div class="message-label">${label}${tag}</div><p>${escapeHtml(text)}</p>`;
  if (els.chatLog.classList.contains('empty-chat')) { els.chatLog.innerHTML = ''; els.chatLog.classList.remove('empty-chat'); }
  els.chatLog.appendChild(bubble);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

async function handleQuestion(event) {
  event.preventDefault();
  if (responsePending || !stationStarted || !engine || currentSession?.completed) return;
  const stationToken = stationGeneration;
  const question = els.questionInput.value.trim();
  if (!question) return;
  setQuestionPending(true);
  addMessage('student', question);
  appendSessionStudentMessage(question);
  persistCurrentSession();
  showResponseLoading(els.chatLog);
  try {
    const positionRequest = getPositionRequest(question, patientPosition);
    let result;
    let aiEvent = null;
    if (positionRequest) {
      result = { reply: answerPositionRequest(positionRequest), detectedIntent: 'position_request', feedbackLabel: 'Positioning' };
    } else {
      const prepared = await prepareQuestionWithAI(engine, question, persistCurrentSession);
      if (!stationStarted || stationToken !== stationGeneration) return;
      result = engine.ask(question, prepared.detection);
      aiEvent = prepared.event;
      engine.debugTurns.at(-1).rescue = aiEvent;
      updateAiDiagnosticsFromEvent(aiEvent);
      lastDetection = result.detection;
    }
    const reply = result.reply;
    removeResponseLoading(els.chatLog);
    addMessage('patient', reply, result.detectedIntent, result.feedbackLabel);
    finalizeSessionQuestion(question, reply, result, aiEvent);
    reactAvatarToPatientReply(reply, { ...result, studentInput: question });
    if (els.voiceToggle.checked) {
      speak(reply, activeCase, {
        onStart: () => setAvatarSpeaking(true, reply),
        onBoundary: (event) => pulseAvatarSpeechBoundary(event),
        onEnd: () => setAvatarSpeaking(false),
        onError: () => setAvatarSpeaking(false)
      });
    } else {
      setAvatarSpeaking(false);
    }
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

function answerPositionRequest(position) {
  if (position === 'needs-reclining') return POSITIONING_REPLIES.needsReclining;
  if (!changePatientPosition(position)) return POSITIONING_REPLIES.viewUnavailable;
  return POSITIONING_COMMANDS[position].reply;
}

function changePatientPosition(position) {
  if (!applyAvatarPositionRequest(position)) return false;
  patientPosition = position;
  return true;
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
  const anamnesis = trainerExperience === 'anamnesis';
  const showAnamnesisDiagnostics = anamnesis && currentMode !== 'exam' &&
    new URLSearchParams(window.location.search).get('conversationDiagnostics') === '1';
  els.anamnesisDiagnostics.hidden = !showAnamnesisDiagnostics;
  if (!anamnesis || showAnamnesisDiagnostics) {
    renderDetailsPanel({
      container: anamnesis ? els.anamnesisDiagnostics : els.detailsPanel,
      currentMode,
      lastDetection,
      aiDiagnostics,
      engine,
      onExportDebug: exportDebugSession,
      onRunSimulation: runSimulationAndShow
    });
  }
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

function updateAiDiagnosticsFromEvent(event) {
  if (!event) return;
  aiDiagnostics.lastAttempted = Boolean(event.aiAttempted || event.aiEndpoint || event.aiSelectedIntent);
  aiDiagnostics.lastSucceeded = Boolean(event.aiSucceeded || event.aiSelectedIntent);
  aiDiagnostics.lastSelectedIntent = event.aiSelectedIntent || '';
  aiDiagnostics.lastConfidence = event.aiConfidence ?? '';
  aiDiagnostics.lastAIError = event.aiError || '';
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
  if (!stationStarted || responsePending || currentSession?.completed) return;
  if (trainerExperience === 'anamnesis') { finishAnamnesisOnly(); return; }
  renderClosingForm({
    container: els.closingPanel,
    encounterState,
    mode: currentMode,
    onChange: () => persistCurrentSession(),
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
    interviewPriorities: activeCase.debriefPriorities,
    closingInput,
    investigations: orderedLabs,
    management: administeredMedications,
    actions: actionHistory,
    environmentReady: isAvatarEnvironmentReady(),
    transcript: currentSession?.messages || []
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
  lockAvatarExaminations();
  sync3dControls();
  [els.clinicalNotesPanel, els.differentialPanel, els.labsPanel, els.medicationPanel].forEach(panel => { if (panel) panel.inert = true; });
  [els.openExamBtn, els.orderLabsBtn, els.administerMedicationBtn, els.openDifferentialBtn].forEach((button) => {
    if (button) button.disabled = true;
  });
}

function resetEncounterControls() {
  [els.clinicalNotesPanel, els.differentialPanel, els.labsPanel, els.medicationPanel].forEach(panel => { if (panel) panel.inert = false; });
  [els.openExamBtn, els.orderLabsBtn, els.administerMedicationBtn, els.openDifferentialBtn, els.finishBtn].forEach((button) => {
    if (button) button.disabled = false;
  });
  if (els.finishAnamnesisBtn) els.finishAnamnesisBtn.disabled = false;
  if (els.sendQuestionBtn) { els.sendQuestionBtn.disabled = false; els.sendQuestionBtn.textContent = 'Ask'; }
  if (els.questionInput) { els.questionInput.readOnly = false; els.questionInput.placeholder = 'Ask a question or request a position in chat…'; }
  if (els.closeClosingBtn) els.closeClosingBtn.textContent = 'Return to station';
}

function renderPhysicalExamPanel() {
  renderExaminationPanel({
    container: els.examinationPanel, patientCase: activeCase, encounterState,
    mode: currentMode, environmentReady: isAvatarEnvironmentReady(), environmentStatus: els.avatarMount?.dataset.visualMode,
    onSelectTool: tool => {
      if (!encounterState.completed && setAvatarExamTool(tool)) els.avatarMount?.scrollIntoView({ block: 'center' });
    }
  });
}

function sync3dControls() {
  const enabled = stationStarted && trainerExperience === 'full' && isAvatarEnvironmentReady() && !encounterState.completed;
  if (els.openEcgBtn) els.openEcgBtn.disabled = !enabled;
  document.querySelectorAll('[data-objective-action="ecg"]').forEach(button => { button.disabled = !enabled; });
  if (stationStarted && trainerExperience === 'full') renderPhysicalExamPanel();
}

function openCaseVitals() {
  if (!stationStarted || trainerExperience !== 'full' || encounterState.completed) return;
  if (Object.values(activeCase.vitals || {}).some(value => /\d/.test(String(value)))) {
    patientStateEngine?.connectEquipment('monitor', true, 'Bedside monitor opened');
    recordObjectiveAction('vitals', 'Documented vital signs reviewed');
    renderPatientVisualState();
  }
  openVitalsMonitor(activeCase);
}

function openEcgPlacement() {
  if (!stationStarted || trainerExperience !== 'full' || encounterState.completed || !isAvatarEnvironmentReady()) return;
  if (encounterState.ecg.placedLeads.length === 10 && activeCase.ecg?.available) { openEcgViewer(activeCase); return; }
  activateWorkspace('examination');renderPhysicalExamPanel();setAvatarExamTool('ecg');
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
  if (els.examNavCount) els.examNavCount.textContent = String(encounterState.examActions.length);
  if (els.testsNavCount) els.testsNavCount.textContent = String(testCount);
  if (els.reasoningNavCount) els.reasoningNavCount.textContent = String(encounterState.differentials.length);
  renderEncounterOverview();
}
function recordObjectiveAction(kind, label) {
  if (!stationStarted || !engine || encounterState.completed) return;
  if (actionHistory.some(item => item.type === `objective-${kind}`)) return;
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
  const previousWorkspace = document.body.dataset.patientWorkspace;
  const requested = String(name || 'interview');
  const target = trainerExperience === 'anamnesis' ? 'interview' : requested;
  if (target === 'examination' || target === 'investigations') setCoachDrawerOpen(false);
  document.querySelectorAll('[data-workspace-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.workspacePanel === target));
  document.querySelectorAll('[data-workspace-target]').forEach((button) => button.classList.toggle('active', button.dataset.workspaceTarget === target));
  document.body.dataset.patientWorkspace = target;
  if (previousWorkspace !== target) setAvatarViewMode(target === 'examination' ? 'examination' : 'encounter');
}


function configureDeveloperAccess() {
  const fullCard = els.experienceCards.find(card => card.dataset.trainerExperience === 'full');
  fullCard?.classList.remove('is-development');
  fullCard?.removeAttribute('aria-disabled');
  if (els.developerAccessNote) els.developerAccessNote.hidden = true;
}

function selectTrainerExperience(next) {
  trainerExperience = next === 'full' ? 'full' : 'anamnesis';
  els.experienceCards.forEach(card => card.classList.toggle('is-selected', card.dataset.trainerExperience === trainerExperience));
  if (els.startTrainingBtn) els.startTrainingBtn.textContent = trainerExperience === 'anamnesis' ? ptT('start_anamnesis') : 'Start clinical encounter';
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
  if (!engine || trainerExperience !== 'anamnesis' || currentSession?.completed) return;
  const debrief = engine.getDebrief();
  const summary = engine.generateSummary();
  const worksheet = buildWorksheetText({ patientCase: activeCase, notes: anamnesisWorksheetNotes });
  completeCurrentSession({ debrief, summary, worksheet });
  els.anamnesisDebriefContent.innerHTML = renderAnamnesisDebrief({
    debrief,
    priorities: engine.getDebriefPriorities(),
    caseName: getCaseDisplayName(activeCase),
    mode: currentMode,
    questionCount: engine.turn,
    summary,
    worksheet,
    messages: currentSession?.messages || [],
    uploadHtml: renderUploadConsentPanel(currentSession)
  });
  bindUploadPanel(els.anamnesisDebriefContent, currentSession?.sessionId);
  lockCompletedInterviewControls();
  openModal(els.anamnesisDebriefModal);
  els.anamnesisDebriefContent.scrollTop = 0;
  els.closeAnamnesisDebriefBtn?.focus();
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
  const matchedIntentIds = result?.answeredIds ?? [];
  const detectedIntent = String(result?.detectedIntent || detection.primaryIntent?.id || 'unknown');
  const topCandidate = detection.candidates?.[0] || null;
  const confidence = Number.isFinite(Number(result?.confidence)) ? Number(result.confidence) : Number(detection.confidence || 0);
  const fallbackUsed = Boolean(aiEvent?.fallbackUsed) || detection.responseScope === 'clarification' || detection.responseScope === 'terminology_not_understood' || detectedIntent === 'unknown' || detection.parts?.some(part => part.responseScope === 'clarification');
  const diagnostics = {
    normalizedQuestion: String(detection.normalized || ''),
    detectedIntent,
    matchedIntent: String(detection.primaryIntent?.id || ''),
    matchedIntentIds,
    recognizedIntentIds: result?.recognizedIntents ?? [],
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
    id: String(item.siteId || item.examinationId || item.groupId || item.action || ''),
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
    ecgPlacedLeads: [...encounterState.ecg.placedLeads],
    patientPosition,
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
    interviewLanguage: currentInterviewLanguage,
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
  lockAvatarExaminations();
  responsePending = true;
  if (els.sendQuestionBtn) { els.sendQuestionBtn.disabled = true; els.sendQuestionBtn.textContent = 'Completed'; }
  if (els.questionInput) { els.questionInput.readOnly = true; els.questionInput.placeholder = 'This session has been completed.'; }
  if (els.finishAnamnesisBtn) els.finishAnamnesisBtn.disabled = true;
  if (els.finishBtn) els.finishBtn.disabled = true;
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
      <div class="pt-history-actions">
        <button type="button" class="secondary pt-history-action" data-session-action="${session.completed ? 'view' : 'continue'}" data-session-id="${escapeHtml(session.sessionId)}">${action}</button>
        <button type="button" class="secondary pt-history-delete" data-session-action="delete" data-session-id="${escapeHtml(session.sessionId)}" aria-label="Delete ${escapeHtml(session.caseName || session.caseId || 'patient')} session" title="Delete this session">Delete</button>
      </div>
    </article>`;
  }).join('');
  els.sessionHistoryList.querySelectorAll('[data-session-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const sessionId = button.dataset.sessionId || '';
      if (button.dataset.sessionAction === 'delete') {
        const session = getPatientTrainerSession(sessionId);
        if (!session) {
          renderSessionHistory();
          return;
        }
        const label = session.caseName || session.caseId || 'Patient Trainer';
        const confirmation = [
          `Delete the saved session for "${label}"?`,
          'This permanently removes its local history and cannot be undone.',
          'Any copy already uploaded to Google Drive will remain there.'
        ].join('\n\n');
        if (!window.confirm(confirmation)) return;
        if (!deletePatientTrainerSession(sessionId)) {
          showHistoryMessage('Could not delete this session from local storage.');
          return;
        }
        renderSessionHistory();
      } else if (button.dataset.sessionAction === 'continue') restorePatientTrainerSession(sessionId);
      else viewPatientTrainerRecord(sessionId);
    });
  });
}

async function restorePatientTrainerSession(sessionId) {
  const stationToken = ++stationGeneration;
  disposeAvatarAnimator();
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
  patientPosition = Object.hasOwn(POSITIONING_COMMANDS, saved.runtimeState.patientPosition)
    ? saved.runtimeState.patientPosition : 'seated';
  currentDifficulty = saved.difficulty || 'intermediate';
  currentInterviewLanguage = saved.interviewLanguage || 'en';
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
  encounterState.ecg.placedLeads = [...new Set(saved.runtimeState.ecgPlacedLeads || encounterState.ecg.placedLeads)].filter(id => /^(RA|LA|RL|LL|V[1-6])$/.test(id));
  encounterState.ecg.completed ||= actionHistory.some(item => item.type === 'objective-ecg') && encounterState.ecg.placedLeads.length === 10;
  patientStateEngine = new PatientStateEngine(activeCase);
  patientStateEngine.restoreSnapshot?.(saved.runtimeState.patientState);
  setMonitorPatientStateSource(patientStateEngine);
  engine = new PatientEngine(activeCase, { mode: currentMode, difficulty: currentDifficulty, interviewLanguage: currentInterviewLanguage });
  engine.restoreState?.(saved.runtimeState.engineState || {});

  if (els.caseSelect) els.caseSelect.value = activeCase.id;
  if (els.modeSelect) els.modeSelect.value = currentMode;
  if (els.difficultySelect) els.difficultySelect.value = currentDifficulty;
  if (els.interviewLanguageSelect) els.interviewLanguageSelect.value = currentInterviewLanguage;
  els.experienceCards.forEach((card) => card.classList.toggle('is-selected', card.dataset.trainerExperience === trainerExperience));
  if (els.startTrainingBtn) els.startTrainingBtn.textContent = trainerExperience === 'anamnesis' ? ptT('start_anamnesis') : 'Start clinical encounter';
  voiceInputController?.stop?.();
  els.setupScreen.hidden = true;
  els.trainingScreen.hidden = false;
  updatePatientTrainerBackLink();
  renderStoredChat(saved.messages || []);
  setQuestionPending(false);
  resetEncounterControls();
  applyTrainerExperienceUI();
  activateWorkspace(saved.runtimeState.activeWorkspace || 'interview');
  if (saved.runtimeState.activeWorkspace === 'handover') finishCase();
  renderStationHeader();
  renderPatientMeta();
  renderTerminologyHint('');
  renderInterfacePanels();
  if (!stationStarted || stationToken !== stationGeneration) return;
  await initAvatarAnimator(activeCase, { allowInspection: trainerExperience === 'full', trainingMode: currentMode, patientPosition, placedLeads: encounterState.ecg.placedLeads, ecgCompleted: encounterState.ecg.completed, completed: encounterState.completed });
  if (!stationStarted || stationToken !== stationGeneration) return;
  bindAvatarToPatientState(patientStateEngine);
  setAvatarEmotion('neutral');
  setAvatarViewMode((saved.runtimeState.activeWorkspace || 'interview') === 'examination' ? 'examination' : 'encounter');
  renderPatientVisualState();
  renderStationHeader();
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
  if (session.finalRecord?.encounterReport) {
    const reportContainer = document.createElement('div');
    renderEncounterReport({ container: reportContainer, report: session.finalRecord.encounterReport });
    reportContainer.querySelector('.report-actions')?.remove();
    els.sessionRecordContent.prepend(reportContainer);
  }
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
    ? `<p class="pt-upload-status is-error" role="alert">Session saved locally. Upload could not be completed. ${escapeHtml(session.lastUploadError || 'Please try again later.')}</p>`
    : '<p class="pt-upload-status">No session is uploaded until you choose to submit it.</p>';
  return `<section class="pt-upload-panel" data-pt-upload-panel="${escapeHtml(session.sessionId)}">
    <h3>Help improve Patient Trainer</h3>
    <p>You may send a session log to help improve question recognition. It uses a random anonymous app ID and excludes account credentials, but the interview text you typed is included and could contain personal details. Do not include real patients’ identifying information. Nothing is sent until you choose Submit.</p>
    ${status}
    <button type="button" class="start-training-btn pt-submit-session" data-submit-session="${escapeHtml(session.sessionId)}" ${uploadInFlight.has(session.sessionId) ? 'disabled' : ''}>${uploadInFlight.has(session.sessionId) ? 'Submitting…' : (retry ? 'Retry upload' : 'Submit session')}</button>
    <button type="button" class="secondary pt-download-session" data-download-session="${escapeHtml(session.sessionId)}">Download log backup</button>
  </section>`;
}

function bindUploadPanel(container, sessionId) {
  if (!container || !sessionId) return;
  container.querySelectorAll('[data-submit-session]').forEach((button) => {
    if (button.dataset.submitSession !== sessionId) return;
    button.addEventListener('click', () => submitSessionUpload(sessionId, { automatic: false }));
  });
  container.querySelectorAll('[data-download-session]').forEach((button) => {
    if (button.dataset.downloadSession !== sessionId) return;
    button.addEventListener('click', () => {
      const session = getPatientTrainerSession(sessionId);
      if (!session) return;
      const blob = new Blob([JSON.stringify(buildAnonymizedPatientTrainerUpload(session), null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'patient-trainer-' + session.sessionId + '.json';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    });
  });
}

async function submitSessionUpload(sessionId, { automatic = false } = {}) {
  let session = getPatientTrainerSession(sessionId);
  if (!session || !session.completed || session.uploaded) return;
  if (automatic && (!session.uploadRequested || session.automaticRetryCount >= PATIENT_TRAINER_AUTO_RETRY_LIMIT)) return;
  if (uploadInFlight.has(sessionId)) return;
  uploadInFlight.add(sessionId);
  try {

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
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
      cache: 'no-store'
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
  } finally {
    uploadInFlight.delete(sessionId);
    refreshUploadPanels(sessionId);
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
    examActions: Array.isArray(source.examActions) ? cloneJson(source.examActions) : [],
    ecg: { ...base.ecg, ...(source.ecg || {}), attempts: Array.isArray(source.ecg?.attempts) ? cloneJson(source.ecg.attempts) : [] },
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
  const examination = evaluateExamination(activeCase, encounterState);
  const examTotal = examination.required.length;
  const examDone = examination.completed.length;
  const noteSections = countCompletedNoteSections(encounterState);
  els.encounterOverview.innerHTML = `
    ${overviewRow('Interview', currentMode === 'exam' ? `${(currentSession?.messages || []).filter(item=>item.speaker==='student').length} questions` : `${interviewPercent}%`, currentMode === 'exam' ? 0 : interviewPercent)}
    ${overviewRow('Examination', currentMode === 'exam' ? `${encounterState.examActions.length} actions` : examTotal ? `${examDone}/${examTotal}` : 'Unassessed', currentMode === 'exam' || !examTotal ? 0 : Math.round((examDone / examTotal) * 100))}
    ${overviewRow('Tests / actions', String(Object.keys(orderedLabs).length + administeredMedications.length + actionHistory.filter((item) => item.type === 'objective-vitals' || item.type === 'objective-ecg').length), Math.min(100, (Object.keys(orderedLabs).length + administeredMedications.length + actionHistory.filter((item) => item.type === 'objective-vitals' || item.type === 'objective-ecg').length) * 12))}
    ${overviewRow('Differential', `${encounterState.differentials.length}/5`, encounterState.differentials.length * 20)}
    ${overviewRow('Notes', `${noteSections}/4`, noteSections * 25)}
  `;
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
    aiDiagnostics: { ...aiDiagnostics }
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

els.avatarMount?.addEventListener('patient3d-position-control', event => {
  if (!stationStarted || currentMode !== 'teaching' || currentSession?.completed || responsePending) return;
  if (changePatientPosition(event.detail?.position)) persistCurrentSession();
});

// All examination inputs share this validated encounter path, including keyboard controls.
els.avatarMount?.addEventListener('patient3d-availability', event => {
  if (!stationStarted || event.detail?.caseId !== activeCase?.id) return;
  sync3dControls();
});
els.avatarMount?.addEventListener('patient3d-examination', event => {
  if (!stationStarted || !engine || trainerExperience !== 'full' || encounterState.completed || !isAvatarEnvironmentReady()) return;
  const detail = event.detail || {};
  const result = performExamination(activeCase, encounterState, detail.examinationId, { ...detail, environmentReady: true });
  if (!result.ok) return;
  const record = result.record;
  const label = `${record.technique} · ${record.siteLabel}`;
  actionHistory.push({ ...record, type: 'physical-examination', examinationId: record.examinationId, label });
  encounterState.notes.examination = mergeNote(encounterState.notes.examination, `${label}: ${record.finding}`);
  if (record.documented) patientStateEngine?.recordExamination(record.siteId, record.finding, record.response?.kind || 'cooperative');
  activateWorkspace('examination');renderPhysicalExamPanel();renderPatientVisualState();
  renderActionHistoryPanel();updateEncounterToolLabels();persistCurrentSession();
});
els.avatarMount?.addEventListener('patient3d-ecg-progress', event => {
  if (!stationStarted || trainerExperience !== 'full' || encounterState.completed || !isAvatarEnvironmentReady()) return;
  const result = recordEcgProgress(activeCase, encounterState, event.detail, true);
  if (!result.ok) return;
  if (event.detail.reset && patientStateEngine?.getSnapshot().equipment.ecg12) patientStateEngine.connectEquipment('ecg12', false, 'Electrodes removed');
  if (!result.newlyCompleted && encounterState.ecg.placedLeads.length === 10 && !patientStateEngine?.getSnapshot().equipment.ecg12) patientStateEngine?.connectEquipment('ecg12', true, 'Electrodes reapplied');
  if (result.newlyCompleted) {
    if (activeCase.ecg?.available) patientStateEngine?.recordEcgAcquired();
    else patientStateEngine?.connectEquipment('ecg12', true, '10 electrodes placed; no case-specific tracing authored');
    if (!actionHistory.some(item => item.type === 'objective-ecg')) recordObjectiveAction('ecg', activeCase.ecg?.available ? '12-lead ECG acquired after all ten electrodes were correctly placed' : 'Ten electrodes correctly placed; no case-specific tracing authored');
  }
  renderPhysicalExamPanel();renderPatientVisualState();renderStationHeader();persistCurrentSession();
});
els.avatarMount?.addEventListener('patient3d-ecg-complete', event => {
  if (!stationStarted || !isAvatarEnvironmentReady() || encounterState.completed || event.detail?.caseId !== activeCase.id || !encounterState.ecg.completed || encounterState.ecg.placedLeads.length !== 10) return;
  if (activeCase.ecg?.available) openEcgViewer(activeCase);
});
