import assert from 'node:assert/strict';
import { PATIENT_CASES } from '../anamnesis-training/src/cases/index.js';
import { PatientEngine } from '../anamnesis-training/src/patientEngine.js';
import { INTENTS, QUESTION_AREAS, getModelQuestions } from '../anamnesis-training/src/data/interviewSchema.js';
import { janaKovacova } from '../anamnesis-training/src/cases/janaKovacova.js';
import { peterNovak } from '../anamnesis-training/src/cases/peterNovak.js';

const allIntentIds = new Set(Object.keys(INTENTS));

assert.ok(PATIENT_CASES.length >= 8, `Expected at least 8 cases, got ${PATIENT_CASES.length}`);
assert.equal(new Set(PATIENT_CASES.map((c) => c.id)).size, PATIENT_CASES.length, 'Case ids must be unique');
assert.equal(new Set(PATIENT_CASES.map((c) => c.title)).size, PATIENT_CASES.length, 'Case titles must be unique');
assert.ok(new Set(PATIENT_CASES.map((c) => JSON.stringify(c.personality))).size >= 6, 'Case library should contain meaningfully varied patient personalities');

for (const patientCase of PATIENT_CASES) {
  assert.ok(patientCase.id, 'Every case needs an id');
  assert.ok(patientCase.title && !/^case\s*\d+$/i.test(patientCase.title), `Case ${patientCase.id} needs a non-placeholder station title`);
  assert.ok(patientCase.chiefComplaint, `Case ${patientCase.id} needs a chief complaint`);
  const p = patientCase.debriefPriorities;
  assert.ok(p, `Case ${patientCase.id} needs case-specific debriefPriorities`);
  for (const tier of ['essential', 'caseCritical', 'recommended', 'optional', 'notRelevant', 'criticalSafety']) {
    assert.ok(Array.isArray(p[tier]), `${patientCase.id}.${tier} must be an array`);
    for (const id of p[tier]) assert.ok(allIntentIds.has(id), `${patientCase.id}.${tier} contains unknown intent ${id}`);
  }
  assert.ok(p.essential.length > 0, `${patientCase.id} needs essential history items`);
  assert.ok(p.caseCritical.length > 0, `${patientCase.id} needs case-critical history items`);
  assert.ok(p.criticalSafety.length > 0, `${patientCase.id} needs safety-critical history items`);
}

for (const area of QUESTION_AREAS) {
  for (const id of [...(area.intents || []), ...(area.optionalIntents || []), ...(area.overviewIntents || [])]) {
    assert.ok(INTENTS[id], `Area ${area.id} references missing intent ${id}`);
  }
}

for (const id of ['chief_complaint','hpi_onset','ros_nausea','ros_syncope','medication_regular','family_cardiovascular','social_baseline_function','closure_concerns']) {
  assert.ok(getModelQuestions(id).length > 0, `${id} should expose at least one model question`);
}

// Broad system screening must not silently complete all atomic subquestions.
{
  const engine = new PatientEngine(janaKovacova, { difficulty: 'intermediate' });
  const broad = engine.ask('Do you have any digestive or gastrointestinal problems?');
  assert.equal(broad.detectedIntent, 'ros_gastrointestinal', 'Broad GI screen should map to overview intent');
  assert.ok(engine.attemptedIntents.has('ros_gastrointestinal'), 'Broad GI screen should be recorded as attempted');
  assert.equal(engine.attemptedIntents.has('ros_nausea'), false, 'Broad GI screen must not auto-complete nausea');
  assert.equal(engine.attemptedIntents.has('ros_vomiting'), false, 'Broad GI screen must not auto-complete vomiting');

  const specific = engine.ask('Have you felt nauseous or sick to your stomach?');
  assert.equal(specific.detectedIntent, 'ros_nausea', 'Specific nausea question should resolve atomic nausea intent');
  assert.ok(engine.attemptedIntents.has('ros_nausea'));
  assert.ok(engine.askedIntents.has('ros_nausea'));
}

// Case-specific scoring should not make unrelated chest-pain medication questions universal.
{
  const priorities = new PatientEngine(janaKovacova).getDebriefPriorities();
  assert.ok(priorities.notRelevant.includes('medication_nitroglycerin_previous'), 'Nitroglycerin history should be explicitly irrelevant to Jana');
  assert.equal(priorities.essential.includes('medication_nitroglycerin_previous'), false);
  assert.equal(priorities.caseCritical.includes('medication_nitroglycerin_previous'), false);
  assert.equal(priorities.recommended.includes('medication_nitroglycerin_previous'), false);
}

// Difficulty must materially change how much a patient volunteers after a broad opening question.
{
  const beginner = new PatientEngine(peterNovak, { difficulty: 'beginner' });
  const advanced = new PatientEngine(peterNovak, { difficulty: 'advanced' });
  const q = 'What brought you to hospital today?';
  const beginnerReply = beginner.ask(q).reply;
  const advancedReply = advanced.ask(q).reply;
  assert.ok(beginnerReply.length > advancedReply.length, 'Beginner patient should volunteer more than Advanced patient');
  assert.ok(beginnerReply.includes(String(peterNovak.hpi.site).trim()), 'Beginner reply should volunteer HPI detail');
}

// Advanced sensitive-history behavior should require respectful framing before disclosure.
{
  const engine = new PatientEngine(peterNovak, { difficulty: 'advanced' });
  engine.ask('Hello, I am the medical student looking after you today. What brought you in?');
  const first = engine.ask('Do you use recreational drugs?');
  assert.equal(first.detection.responseScope, 'guarded_withholding', 'Advanced guarded patient should initially withhold sensitive history');
  assert.equal(engine.askedIntents.has('substance_drugs'), false, 'Withheld sensitive history must not count as resolved');
  const second = engine.ask('Is it okay if I ask whether you use any recreational drugs?');
  assert.notEqual(second.detection.responseScope, 'guarded_withholding', 'Permission should allow subsequent disclosure');
  assert.ok(engine.askedIntents.has('substance_drugs'), 'Respectfully re-asked sensitive history should resolve');
}

// Communication rewards and interview-structure scoring should respond to a coherent consultation.
{
  const engine = new PatientEngine(peterNovak, { difficulty: 'intermediate' });
  engine.ask('Hello, my name is Daniel, I am a medical student. What brought you to hospital today?');
  engine.ask('When did the pain start?');
  engine.ask('Where exactly is the pain?');
  engine.ask('How would you describe the pain?');
  engine.ask('Do you take any regular medication?');
  engine.ask('Do you have any allergies?');
  engine.ask('Is it okay if I ask whether you smoke?');
  engine.ask('Before we finish, is there anything else you think I should know?');
  const communication = engine.getCommunicationAssessment();
  const structure = engine.getStructureAssessment();
  assert.ok(communication.positives.some((p) => p.type === 'introduction'), 'Introduction should earn positive communication feedback');
  assert.ok(communication.positives.some((p) => p.type === 'permission'), 'Permission should earn positive communication feedback');
  assert.ok(communication.positives.some((p) => p.type === 'closure'), 'Explicit closure should earn positive communication feedback');
  assert.ok(structure.score >= 70, `Coherent sequence should score reasonably for structure, got ${structure.score}`);
}

// The debrief must expose clinically useful tiers and model questions rather than a single generic checklist score.
{
  const engine = new PatientEngine(peterNovak);
  engine.ask('What brought you to hospital today?');
  const debrief = engine.getDebrief();
  assert.ok(Array.isArray(debrief.missedEssential));
  assert.ok(Array.isArray(debrief.missedCaseCritical));
  assert.ok(Array.isArray(debrief.missedRecommended));
  assert.ok(Array.isArray(debrief.criticalSafetyMisses));
  assert.ok(debrief.missedDetails.some((item) => Array.isArray(item.examples) && item.examples.length), 'Missed debrief items should include model questions');
  assert.equal(typeof debrief.scoreBreakdown.structure, 'number');
  assert.equal(typeof debrief.scoreBreakdown.communication, 'number');
}

console.log(`Patient Trainer Anamnesis v84 regression: PASS (${PATIENT_CASES.length} cases, ${Object.keys(INTENTS).length} intents)`);
