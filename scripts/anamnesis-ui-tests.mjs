import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PATIENT_CASES } from '../anamnesis-training/src/cases/index.js';
import { PatientEngine } from '../anamnesis-training/src/patientEngine.js';
import { getCategoryForIntent, getChecklistItemsByCategory, getKnownFactsByCategory, getQuestionVariantsByCategory } from '../anamnesis-training/src/ui/categoryModel.js';
import { showResponseLoading, removeResponseLoading } from '../anamnesis-training/src/ui/loadingIndicator.js';
import { DETAILS_PASSWORD } from '../anamnesis-training/src/ui/detailsPanel.js';
import { DEFAULT_RECOGNITION_LANGUAGE, initVoiceInput } from '../anamnesis-training/src/ui/voiceInput.js';
import { renderModeLayout } from '../anamnesis-training/src/ui/modeLayout.js';
import { getCoverageTopicState, renderAnamnesisCompanion } from '../anamnesis-training/src/ui/anamnesisCompanion.js';
import { INTENTS } from '../anamnesis-training/src/data/interviewSchema.js';
import { labsForGroup } from '../anamnesis-training/src/ui/actionPanels.js';

import { renderAnamnesisDebrief } from '../anamnesis-training/src/ui/anamnesisDebrief.js';
import { jumpToTranscript, transcriptRows } from '../anamnesis-training/src/ui/transcriptEvidence.js';

const patientCase = PATIENT_CASES[0];
const engine = new PatientEngine(patientCase, { mode: 'teaching' });

const coverage = { innerHTML: '', hidden: false };
renderModeLayout({ container: coverage, mode: 'teaching', engine, patientCase });
assert.match(coverage.innerHTML, /Coverage overview/);
assert.match(coverage.innerHTML, /Not yet covered/);
renderModeLayout({ container: coverage, mode: 'practice', engine, patientCase });
assert.match(coverage.innerHTML, /No topics covered yet/);
renderModeLayout({ container: coverage, mode: 'exam', engine, patientCase });
assert.equal(coverage.innerHTML, '');
assert.equal(coverage.hidden, true);

const checklist = getChecklistItemsByCategory(engine, patientCase);
assert.ok(checklist.some((group) => group.title === 'Identification'));
assert.ok(checklist.flatMap((group) => group.items).some((item) => item.label === 'Name' && item.status === 'notAsked'));

const emptyFacts = getKnownFactsByCategory(engine, patientCase);
assert.equal(emptyFacts.length, 0);

engine.ask('What is your name?');
const knownFacts = getKnownFactsByCategory(engine, patientCase);
assert.ok(knownFacts.some((group) => group.facts.some((fact) => fact.label === 'Name' && /Peter Novak/.test(fact.value))));
assert.ok(!knownFacts.some((group) => group.facts.some((fact) => fact.label === 'Age')));

const questionGroups = getQuestionVariantsByCategory(patientCase, engine);
assert.ok(questionGroups.some((group) => group.intents.some((intent) => intent.variants.length > 1)));
assert.ok(questionGroups.some((group) => group.intents.some((intent) => intent.covered)));

// Both right-side panels use the topics actually answered in the conversation.
assert.ok(Object.keys(INTENTS).every(id => getCategoryForIntent(id)), 'Every intent belongs to a coverage category');
const progress = new PatientEngine(patientCase, { mode: 'practice' });
for (const [question, expected] of [
  ['What is your date of birth?', 'identity_dob'],
  ['How have you been sleeping lately?', 'intake_sleep'],
  ['Has this sort of thing ever happened to you before?', 'hpi_previous_episodes'],
  ['What health conditions have your close relatives had?', 'family_history'],
  ['Do you have any digestive or gastrointestinal problems?', 'ros_gastrointestinal']
]) {
  assert.ok(progress.ask(question).answeredIds.includes(expected), question);
}
progress.ask('Thanks.');
const restored = new PatientEngine(patientCase).restoreState(JSON.parse(JSON.stringify(progress.exportState())));
const companion = { innerHTML: '', querySelectorAll: () => [] };
const args = { container: companion, engine: restored, patientCase };
const state = getCoverageTopicState(args);
assert.ok(state.covered.some(item => item.id === 'ros_gastrointestinal'));
assert.ok(state.uncovered.some(item => item.id === 'ros_nausea'));
assert.ok(state.expected.some(item => item.id === 'identity_age' && !item.covered));
assert.equal(state.groups.find(group => group.id === 'identification').asked, 1);
for (const mode of ['practice', 'teaching']) {
  renderAnamnesisCompanion({ ...args, mode });
  for (const label of ['Date of birth', 'Sleep', 'Previous episodes', 'Family history overview', 'Gastrointestinal overview']) {
    assert.ok(companion.innerHTML.includes(label), `${mode}: ${label}`);
  }
  renderModeLayout({ ...args, container: coverage, mode });
  assert.match(coverage.innerHTML, /Date of birth/);
  assert.match(coverage.innerHTML, /Gastrointestinal overview/);
  if (mode === 'practice') {
    assert.doesNotMatch(companion.innerHTML, /Medication dose|Gastrointestinal overview.*Nausea/);
    assert.doesNotMatch(coverage.innerHTML, /Medication dose/);
  }
}
renderAnamnesisCompanion({ ...args, mode: 'practice' });
assert.match(companion.innerHTML, /href="#pt-live-turn-1"[^>]*>Date of birth/);
renderModeLayout({ ...args, container: coverage, mode: 'teaching' });
assert.match(coverage.innerHTML, /href="#pt-live-turn-2"[^>]*>Sleep/);
const messages = [
  { speaker: 'patient', text: 'Opening line' },
  { speaker: 'student', text: 'What is your date of birth?' },
  { speaker: 'patient', text: 'Recorded birthday', responseScope: 'single_intent', matchKind: 'direct' },
  { speaker: 'patient', text: 'Positioning reply', engineTurn: null },
  { speaker: 'student', text: 'How have you been sleeping lately?' },
  { speaker: 'patient', text: 'Recorded sleep response', engineTurn: 2 }
];
assert.deepEqual(transcriptRows(messages).map(row => row.turn), [null, null, 1, null, null, 2]);
const debrief = renderAnamnesisDebrief({
  debrief: restored.getDebrief(), priorities: restored.getDebriefPriorities(), mode: 'exam', messages
});
assert.match(debrief, /href="#pt-debrief-turn-2"/);
assert.match(debrief, /data-debrief-turn="2"[^>]*>.*Recorded sleep response/);
const transcriptDetails = { open: false };
let clicked = false;
let focused = false;
let scrolled = false;
const target = {
  closest: () => transcriptDetails,
  focus: () => { focused = true; },
  scrollIntoView: () => { scrolled = true; }
};
const debriefLink = {
  dataset: { transcriptLink: 'debrief', turn: '2' },
  closest: () => ({ querySelector: selector => selector === '[data-debrief-turn="2"]' ? target : null })
};
jumpToTranscript({ target: { closest: () => debriefLink }, preventDefault: () => { clicked = true; } });
assert.ok(transcriptDetails.open && clicked && focused && scrolled);

renderAnamnesisCompanion({ ...args, mode: 'exam' });
assert.equal(companion.innerHTML, '');
renderModeLayout({ ...args, container: coverage, mode: 'exam' });
assert.equal(coverage.innerHTML, '');

const ordered = labsForGroup('fbc', patientCase);
assert.deepEqual(Object.keys(ordered), ['hemoglobin', 'wbc', 'platelets']);
assert.match(ordered.wbc, /WBC/i);
assert.match(ordered.hemoglobin, /Haemoglobin/i);
assert.match(ordered.platelets, /Platelets/i);

assert.equal(DETAILS_PASSWORD, '1379');
assert.equal(DEFAULT_RECOGNITION_LANGUAGE, 'en-US');

global.window = {};
const fakeButton = {
  disabled: false,
  title: '',
  attrs: {},
  setAttribute(name, value) { this.attrs[name] = value; },
  addEventListener() {}
};
const voiceResult = initVoiceInput({ button: fakeButton, input: {}, status: { textContent: '' } });
assert.equal(voiceResult.supported, false);
assert.equal(fakeButton.disabled, true);
assert.match(fakeButton.title, /not supported/i);

global.document = {
  createElement() {
    return {
      className: '',
      dataset: {},
      attrs: {},
      innerHTML: '',
      setAttribute(name, value) { this.attrs[name] = value; },
      remove() { this.removed = true; }
    };
  }
};
const fakeChat = {
  children: [],
  scrollTop: 0,
  scrollHeight: 200,
  classList: {
    empty: true,
    contains(name) { return name === 'empty-chat' && this.empty; },
    remove(name) { if (name === 'empty-chat') this.empty = false; }
  },
  innerHTML: 'placeholder',
  appendChild(node) { this.children.push(node); },
  querySelector(selector) { return selector === '[data-loading-bubble="true"]' ? this.children.find((node) => node.dataset.loadingBubble === 'true') : null; }
};
const loadingBubble = showResponseLoading(fakeChat);
assert.equal(loadingBubble.dataset.loadingBubble, 'true');
assert.match(loadingBubble.innerHTML, /Generating response/);
removeResponseLoading(fakeChat);
assert.equal(loadingBubble.removed, true);

const html = readFileSync(new URL('../anamnesis-training/index.html', import.meta.url), 'utf8');
for (const id of ['openVitalsBtn', 'openEcgBtn', 'orderLabsBtn', 'administerMedicationBtn', 'finishBtn', 'voiceInputBtn', 'detailsPanel']) {
  assert.ok(html.includes(`id="${id}"`), `Missing ${id}`);
}
assert.ok(!html.includes('id="suggestions"'));
assert.ok(!html.includes('id="engineDebug"'));

console.log('Anamnesis UI regression tests passed.');
