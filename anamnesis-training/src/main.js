import { PATIENT_CASES, QUESTION_AREAS, INTENTS } from './patientCase.js';
import { PatientEngine } from './patientEngine.js';
import { speak, chooseVoiceForPatient, initVoices } from './speech.js';
import { runSimulationTests } from './simulationRunner.js';
import { openVitalsMonitor, closeVitalsMonitor, openEcgViewer, closeEcgViewer, resizeVisibleMonitor } from './vitalsMonitor.js';
import { initAvatarAnimator, reactAvatarToPatientReply, setAvatarEmotion } from './avatarAnimator.js';
import { phrasePatientReply, prepareAnonymousContribution, prepareQuestionWithAI, recordLearningEvent } from './aiSupport.js';

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
  suggestions: document.getElementById('suggestions'),
  terminologyHint: document.getElementById('terminologyHint'),
  coveragePanel: document.getElementById('coveragePanel'),
  summaryPanel: document.getElementById('summaryPanel'),
  missedPanel: document.getElementById('missedPanel'),
  hintBtn: document.getElementById('hintBtn'),
  finishBtn: document.getElementById('finishBtn'),
  copySummaryBtn: document.getElementById('copySummaryBtn'),
  exportDebugBtn: document.getElementById('exportDebugBtn'),
  runSimulationBtn: document.getElementById('runSimulationBtn'),
  voiceToggle: document.getElementById('voiceToggle'),
  openVitalsBtn: document.getElementById('openVitalsBtn'),
  closeVitalsBtn: document.getElementById('closeVitalsBtn'),
  openEcgBtn: document.getElementById('openEcgBtn'),
  closeEcgBtn: document.getElementById('closeEcgBtn'),
  engineDebug: document.getElementById('engineDebug'),
  avatarMount: document.getElementById('avatarMount'),
  avatarFallback: document.getElementById('avatarFallback')
};

let engine;
let activeCase = PATIENT_CASES[0];
let currentMode = 'practice';
let currentDifficulty = 'intermediate';
let stationStarted = false;

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
  els.modeSelect?.addEventListener('change', () => { currentMode = els.modeSelect.value; renderSetupPreview(); if (stationStarted) { renderAllPanels(); renderSuggestions(); renderTerminologyHint(''); renderStationHeader(); } });
  els.difficultySelect?.addEventListener('change', () => { currentDifficulty = els.difficultySelect.value; renderSetupPreview(); if (stationStarted) renderStationHeader(); });
  els.startTrainingBtn?.addEventListener('click', startCase);
  els.restartBtn.addEventListener('click', showSetupScreen);
  els.questionForm.addEventListener('submit', handleQuestion);
  els.hintBtn.addEventListener('click', showHint);
  els.finishBtn.addEventListener('click', finishCase);
  els.copySummaryBtn.addEventListener('click', copySummary);
  els.exportDebugBtn?.addEventListener('click', exportDebugSession);
  els.runSimulationBtn?.addEventListener('click', runSimulationAndShow);
  els.openVitalsBtn?.addEventListener('click', () => openVitalsMonitor(activeCase));
  els.closeVitalsBtn?.addEventListener('click', closeVitalsMonitor);
  els.openEcgBtn?.addEventListener('click', () => openEcgViewer(activeCase));
  els.closeEcgBtn?.addEventListener('click', closeEcgViewer);
  document.querySelector('[data-close="vitals"]')?.addEventListener('click', closeVitalsMonitor);
  document.querySelector('[data-close="ecg"]')?.addEventListener('click', closeEcgViewer);
  window.addEventListener('resize', resizeVisibleMonitor);
  window.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closeVitalsMonitor(); closeEcgViewer(); } });

  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => activateTab(tab.dataset.tab)));
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
  els.setupScreen.hidden = true;
  els.trainingScreen.hidden = false;
  engine = new PatientEngine(activeCase, { mode: currentMode, difficulty: currentDifficulty });
  els.chatLog.innerHTML = '<div class="empty-chat-note">Start the interview by introducing yourself or asking the patient an opening question.</div>';
  els.chatLog.classList.add('empty-chat');
  renderStationHeader();
  renderPatientMeta();
  renderSuggestions();
  renderTerminologyHint('');
  renderAllPanels();
  renderDebug(null);
  await initAvatarAnimator(activeCase);
  setAvatarEmotion('neutral');
  els.questionInput.focus();
}

function showSetupScreen() {
  stationStarted = false;
  closeVitalsMonitor();
  closeEcgViewer();
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
  if (els.openEcgBtn) els.openEcgBtn.hidden = !activeCase.ecg?.available;
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
  const question = els.questionInput.value.trim();
  if (!question) return;
  const submit = els.questionForm.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;
  addMessage('student', question);
  try {
    const prepared = await prepareQuestionWithAI(engine, question);
    const result = engine.ask(question, prepared.detection);
    const reply = result.detection.responseScope === 'terminology_not_understood'
      ? result.reply
      : await phrasePatientReply(result.reply, prepared.event);
    engine.replaceLastPatientReply(reply);
    addMessage('patient', reply, result.detectedIntent, result.feedbackLabel);
    reactAvatarToPatientReply(reply, result);
    if (els.voiceToggle.checked) speak(reply, activeCase);
    recordLearningEvent(prepared.event);
    els.questionInput.value = '';
    renderTerminologyHint(result.terminologySuggestion, result.detection?.terminologyEvent?.term);
    renderAllPanels();
    renderSuggestions();
    renderPatientMeta();
    renderDebug(result.detection);
  } finally {
    if (submit) submit.disabled = false;
    els.questionInput.focus();
  }
}

function renderTerminologyHint(suggestion, term = '') {
  if (!els.terminologyHint) return;
  if (!suggestion || currentMode === 'exam') { els.terminologyHint.innerHTML = ''; els.terminologyHint.classList.remove('visible'); return; }
  els.terminologyHint.classList.add('visible');
  els.terminologyHint.innerHTML = `<strong>Patient-friendly wording:</strong> ${term ? `Medical wording detected: “${escapeHtml(term)}”. ` : ''}Try asking: “${escapeHtml(suggestion)}”`;
}

function renderSuggestions() {
  if (currentMode === 'exam') { els.suggestions.innerHTML = ''; return; }
  const coverage = engine.getCoverage();
  const nextArea = coverage.find((area) => area.required && area.percent < 100) || coverage.find((area) => area.percent < 100);
  if (!nextArea) { els.suggestions.innerHTML = '<span class="suggestion done">All areas covered.</span>'; return; }
  if (currentMode === 'practice') {
    els.suggestions.innerHTML = `<span class="suggestion passive">General hint: ${escapeHtml(nextArea.title)} is still incomplete.</span>`;
    return;
  }
  const examples = getExamplesForMissing(nextArea.missing.slice(0, 4));
  els.suggestions.innerHTML = examples.map((example) => `<button type="button" class="suggestion">${escapeHtml(example)}</button>`).join('');
  els.suggestions.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => { els.questionInput.value = button.textContent; els.questionInput.focus(); }));
}

function getExamplesForMissing(missing) {
  const map = { chief_complaint: 'What brought you to the hospital today?', hpi_site: 'Where exactly do you feel the problem?', hpi_onset: 'When did it start?', hpi_character: 'How would you describe the pain?', hpi_radiation: 'Does the pain spread anywhere?', hpi_relieving: 'What makes it better?', hpi_severity: 'How severe is it from 0 to 10?', pmh_chronic_diseases: 'Do you have any chronic diseases?', allergies: 'Do you have any allergies?', medication_regular: 'What medicines do you take regularly?', family_history: 'Do close relatives have serious diseases?', substance_smoking: 'Do you smoke?', substance_alcohol: 'Do you drink alcohol?' };
  return missing.map((key) => map[key] || QUESTION_AREAS.find((area) => area.intents.includes(key))?.modelQuestion || `Ask about ${key.replaceAll('_', ' ')}`);
}

function renderAllPanels() { renderCoverage(); renderSummary(); renderMissed(); }
function renderCoverage() {
  const coverage = engine.getCoverage();
  const score = engine.getScore();
  els.coveragePanel.innerHTML = `<div class="score-card"><strong>${score}%</strong><span>current training score</span></div><div class="coverage-list">${coverage.map((area) => `<div class="coverage-item ${area.percent === 100 ? 'complete' : ''}"><div class="coverage-title"><span>${escapeHtml(area.title)}</span><strong>${area.asked}/${area.total}</strong></div><div class="progress"><div style="width:${area.percent}%"></div></div></div>`).join('')}</div>`;
}
function renderSummary() { els.summaryPanel.innerHTML = `<pre>${escapeHtml(engine.generateSummary())}</pre>`; }
function renderMissed() {
  const missed = engine.getMissedFeedback();
  const critical = engine.getCriticalMisses();
  els.missedPanel.innerHTML = `<h3>Critical misses</h3>${critical.length ? `<ul>${critical.map((item) => `<li>${escapeHtml(labelForIntent(item))}</li>`).join('')}</ul>` : '<p>No critical misses.</p>'}<h3>Adaptive feedback</h3>${missed.length ? missed.map((area) => `<div class="missed-area"><strong>${escapeHtml(area.title)}</strong><p>Model prompt: ${escapeHtml(area.modelQuestion)}</p><small>Missing: ${area.missing.map((item) => escapeHtml(labelForIntent(item))).join(', ')}</small></div>`).join('') : '<p>All required areas are covered.</p>'}`;
}
function renderDebug(detection) {
  if (!detection || currentMode === 'exam') { els.engineDebug.innerHTML = currentMode === 'exam' ? '<p>Debug hidden in Exam Mode.</p>' : '<p>Ask a free-text anamnesis question. The engine will score possible meanings here.</p>'; return; }
  els.engineDebug.innerHTML = `<p><strong>Scope:</strong> ${escapeHtml(detection.responseScope)}</p><p><strong>Best:</strong> ${escapeHtml(detection.primaryIntent ? labelForIntent(detection.primaryIntent.id) : 'uncertain')}</p><p><strong>Confidence:</strong> ${Math.round(detection.confidence * 100)}%</p>${detection.terminologyEvent ? `<p><strong>Terminology:</strong> ${escapeHtml(detection.terminologyEvent.term)} → ${escapeHtml(detection.terminologyEvent.suggestedPatientFriendlyQuestion)}</p>` : ''}<ol>${detection.candidates.map((candidate) => `<li><span>${escapeHtml(labelForIntent(candidate.id))}</span><small>${candidate.score.toFixed(2)} · ${(candidate.reasons || []).slice(0, 2).join(', ') || 'context'}</small></li>`).join('')}</ol>`;
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
  activateTab('missed');
  addMessage('patient', `Interview finished. Your score is ${engine.getScore()}%. Check the feedback panel for missed domains, terminology issues, and red flags.`, 'score');
  if (window.confirm('Would you like to anonymously contribute this conversation to improve the simulator?')) {
    console.info('anamnesis-anonymous-contribution-ready', prepareAnonymousContribution(engine));
  }
}
async function copySummary() { try { await navigator.clipboard.writeText(engine.generateSummary()); addMessage('patient', 'Summary copied to clipboard.', 'export'); } catch { addMessage('patient', 'Clipboard failed. Select the summary manually.', 'export'); } }
function exportDebugSession() { downloadJson('anamnesis_debug_session.json', engine.getDebugExport()); }
function runSimulationAndShow() { const report = runSimulationTests(); activateTab('missed'); els.missedPanel.innerHTML = `<h3>Simulation Test Report</h3><p><strong>${report.passed}/${report.total}</strong> passed (${report.passRate}%).</p><button id="downloadSimulationJson" type="button" class="secondary">Export simulation JSON</button><div class="simulation-results">${report.results.filter((r) => !r.passed).map((r) => `<div class="missed-area"><strong>${escapeHtml(r.id)}</strong><p>${escapeHtml(r.question)}</p><small>${escapeHtml(r.failures.join('; '))}</small><pre>${escapeHtml(r.patientAnswer)}</pre></div>`).join('') || '<p>All simulation tests passed.</p>'}</div>`; document.getElementById('downloadSimulationJson')?.addEventListener('click', () => downloadJson('anamnesis_simulation_report.json', report)); }
function downloadJson(filename, data) { const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); }
function activateTab(name) { document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active')); document.getElementById(`${name}Panel`)?.classList.add('active'); }
function labelForIntent(intent) { return INTENTS[intent]?.title || String(intent).replaceAll('_', ' '); }
function escapeHtml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
init();
