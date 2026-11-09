import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PATIENT_CASES } from '../anamnesis-training/src/cases/index.js';
import { createAnamnesisCase } from '../anamnesis-training/src/cases/caseFactory.js';
import { MEDICATION_DETAILS, CONVERSATION_FACTS } from '../anamnesis-training/src/cases/conversationFacts.js';
import { INTENTS } from '../anamnesis-training/src/data/interviewSchema.js';
import { PatientEngine } from '../anamnesis-training/src/patientEngine.js';
import { prepareQuestionWithAI } from '../anamnesis-training/src/aiSupport.js';
import { validateConversationCase } from '../anamnesis-training/src/dialogue/clinicalFacts.js';
import { attributesByIntent } from '../anamnesis-training/src/dialogue/questionAnalysis.js';
import { runSimulationTests } from '../anamnesis-training/src/simulationRunner.js';
import { POSITIONING_COMMANDS } from '../anamnesis-training/src/data/positioningCommands.js';
import { getPositionRequest } from '../anamnesis-training/src/dialogue/positionRequests.js';

test('the positioning catalog pairs command examples with poses and patient replies', () => {
  const poses = Object.entries(POSITIONING_COMMANDS);
  assert.deepEqual(poses.map(([pose]) => pose), ['seated', 'standing', 'reclined', 'abdominal']);
  assert.equal(new Set(poses.map(([, command]) => command.intent)).size, poses.length);
  for (const [pose, command] of poses) {
    assert.ok(command.reply);
    for (const phrase of command.commands) {
      assert.equal(getPositionRequest(phrase, 'reclined'), pose, phrase);
    }
  }
  assert.equal(getPositionRequest('Could you bend your knees a little?', 'seated'), 'needs-reclining');
  assert.equal(getPositionRequest('Does sitting on a chair make it worse?', 'seated'), null);
});

const [peter, jana, milan, lucia, karol, eva, zuzana, nina] = PATIENT_CASES;
const make = (patient = peter, difficulty = 'intermediate') => new PatientEngine(patient, { difficulty });

const onsetQuestions = [
  'When did it start?', 'When exactly did it begin?', 'When did it come on?',
  'When did you first feel it?', 'How long ago did it start?', 'Since when have you had it?',
  'What time did it begin?', 'When did it first appear?', 'How long have you had it?',
  'Can you tell me when it started?'
];

test('the existing 141 intents and all simulations remain active', () => {
  assert.equal(Object.keys(INTENTS).length, 141);
  const result = runSimulationTests();
  assert.equal(result.failed, 0, JSON.stringify(result.results.filter(turn => !turn.passed)));
});

test('ten formulations reach the same onset facet and facts for each patient', () => {
  for (const [patient, expected] of [
    [peter, /2 hours before/], [jana, /yesterday evening/], [milan, /3 weeks/],
    [lucia, /burning started two days ago/], [karol, /black stools started yesterday/i],
    [eva, /this afternoon/], [zuzana, /4 months ago/], [nina, /three years.*half an hour/]
  ]) {
    const engine = make(patient);
    engine.ask('What brought you in?');
    const replies = onsetQuestions.map(question => {
      const result = engine.ask(question);
      assert.equal(result.detection.analysis?.attribute, 'onset.time', `${patient.id}: ${question}`);
      assert.deepEqual(result.answeredIds, ['hpi_onset']);
      assert.match(result.reply, expected);
      return result.reply;
    });
    assert.equal(new Set(replies).size, 1, patient.id);
  }
});

test('timing, activity, severity and progression are independently answerable', () => {
  const engine = make();
  engine.ask('What brought you in?');
  assert.match(engine.ask('When did it start?').reply, /2 hours before/);
  assert.match(engine.ask('Suddenly?').reply, /not sure/);
  assert.match(engine.ask('What were you doing when it started?').reply, /walking from the parking lot/);
  assert.match(engine.ask('How long does each episode last?').reply, /worst spell lasted about 30 minutes/);
  assert.match(engine.ask('Has it become worse?').reply, /improved after resting/);
  assert.match(engine.ask('How bad is it out of 10?').reply, /4 out of 10/);
  assert.match(engine.ask('How bad was it at its worst?').reply, /8 out of 10/);
  const migraine = make(nina);
  migraine.ask('What brought you in?');
  assert.match(migraine.ask('Did it start suddenly?').reply, /gradually/);
  assert.match(migraine.ask('How long does each attack last?').reply, /4 to 12 hours if I do not treat/);
  const collapse = make(eva);
  collapse.ask('What brought you in?');
  assert.match(collapse.ask('Suddenly?').reply, /came on suddenly/);
  assert.match(collapse.ask('How long were you unconscious?').reply, /less than 1 minute, according to my granddaughter/);
});

test('compound requests, anatomical references, resume and topic switching', () => {
  const engine = make();
  const result = engine.ask('Where exactly is the pain, when did it start, and does it spread anywhere?');
  assert.deepEqual(result.answeredIds, ['hpi_site', 'hpi_onset', 'hpi_radiation']);
  assert.match(result.reply, /breastbone.*2 hours.*left arm.*jaw/);
  assert.deepEqual([...engine.askedIntents], result.answeredIds);
  assert.deepEqual([...engine.attemptedIntents], result.answeredIds);
  const resumed = make().restoreState(JSON.parse(JSON.stringify(engine.exportState())));
  assert.match(resumed.ask('And your jaw?').reply, /in my jaw/);
  assert.match(resumed.ask('And your right arm?').reply, /left arm/);
  assert.doesNotMatch(resumed.ask('And your right arm?').reply, /right arm/);
  resumed.ask('Do you take any medication?');
  assert.doesNotMatch(resumed.ask('Where exactly?').reply, /breastbone/);
  const dose = resumed.ask('How much ramipril do you take?');
  assert.match(dose.reply, /5 mg of ramipril/);
  assert.match(resumed.ask('How often?').reply, /ramipril once each morning/);
  assert.match(resumed.ask('Why do you take it?').reply, /ramipril for high blood pressure/);
  assert.match(make(jana).ask('How much paracetamol do you take?').reply, /500 mg/);
  assert.match(make(nina).ask('How much ramipril do you take?').reply, /not sure/);
  const broad = resumed.ask('Do you have any digestive or gastrointestinal problems?');
  assert.equal(broad.detectedIntent, 'ros_gastrointestinal');
  assert.ok(!resumed.askedIntents.has('ros_nausea'));
  resumed.loadCase(jana);
  assert.equal(resumed.activeMedication, null);
  assert.equal(resumed.pendingClarification, null);
  assert.equal(resumed.askedIntents.size, 0);
});

test('authored negatives, negated questions, missing facts and scoring remain distinct', () => {
  for (const question of ['Have you coughed up blood?', 'Haven’t you coughed up blood?', 'Have you not never coughed up blood?']) {
    const engine = make();
    assert.match(engine.ask(question).reply, /I have not coughed up blood/);
    assert.ok(engine.askedIntents.has('ros_hemoptysis'));
  }
  const engine = make(lucia);
  const result = engine.ask('Have you coughed up blood?');
  assert.match(result.reply, /not sure/);
  assert.ok(engine.attemptedIntents.has('ros_hemoptysis'));
  assert.ok(!engine.askedIntents.has('ros_hemoptysis'));
  assert.equal(engine.attemptEvents.at(-1).recognized, true);
  assert.equal(engine.attemptEvents.at(-1).resolved, false);
  assert.equal(engine.debugTurns.at(-1).answers[0].reason, 'not_authored');
  const novice = make(peter, 'beginner').ask('What brought you in?');
  const advanced = make(peter, 'advanced').ask('What brought you in?');
  assert.ok(novice.reply.length > advanced.reply.length);
  assert.deepEqual(novice.answeredIds, advanced.answeredIds);
  const guarded = make(peter, 'advanced').ask('Where does the pain hurt, and do you use recreational drugs?');
  assert.deepEqual(guarded.answeredIds, ['hpi_site']);
  assert.doesNotMatch(guarded.reply, /I do not use recreational drugs/);
  assert.match(make(jana).ask('You are a male').reply, /^No\. I am female/);
  const narrow = make();
  narrow.ask('Does the chest pain spread to your jaw?');
  assert.doesNotMatch(narrow.generateSummary(), /left arm/);
});

test('incomplete structured facts preserve an informative authored overview', () => {
  const data = createAnamnesisCase({
    id: 'compatibility-test', identity: { sex: 'male' },
    medication: { regular: 'I only take my own prescribed medicine.' },
    conversationFacts: { medication_regular: { overview: { clauses: [{ verb: 'take' }] } } }
  });
  assert.equal(make(data).ask('What regular medication do you take?').reply, data.medication.regular);
  assert.match(make(data).ask('Do you have any allergies?').reply, /not sure/);
});

test('pre-publication audit reports gaps and curated facts point to the active curriculum', () => {
  for (const patient of PATIENT_CASES) {
    assert.ok(Object.hasOwn(CONVERSATION_FACTS, patient.id));
    const findings = validateConversationCase(patient, attributesByIntent);
    assert.ok(findings.length > 0 && findings.every(item => item.id.startsWith(`${patient.id}:`)));
    assert.ok(!findings.some(item => item.id.endsWith(':identity_name:overview')));
  }
  for (const intents of Object.values(CONVERSATION_FACTS)) {
    for (const intent of Object.keys(intents)) assert.ok(Object.hasOwn(INTENTS, intent), intent);
  }
  for (const [id, medicines] of Object.entries(MEDICATION_DETAILS)) {
    const patient = PATIENT_CASES.find(item => item.id === id);
    for (const { name, dose, unit } of medicines) {
      assert.ok(patient.medication.details.dose.toLowerCase().includes(`${name} ${dose} ${unit}`) ||
        id === peter.id || id === jana.id, `${id} ${name}`);
    }
  }
});

test('network interception proves zero routine requests and constrains exceptional rescue', async () => {
  const savedFetch = globalThis.fetch;
  const savedWindow = globalThis.window;
  const requests = [];
  let behavior = 'valid';
  globalThis.window = { ANAMNESIS_AI_ENABLED: true, location: { hostname: 'localhost' } };
  globalThis.fetch = async (url, init) => {
    const data = JSON.parse(init.body);
    requests.push({ url, data });
    if (behavior === 'offline') throw new Error('offline');
    if (behavior === 'quota') return Response.json({ error: 'quota' }, { status: 429 });
    return Response.json({
      success: true, intent: behavior === 'invalid' ? 'allergy_reaction' : 'ros_rash',
      confidence: 0.97, ...data.interpretation
    });
  };
  const send = async (engine, question) => {
    const prepared = await prepareQuestionWithAI(engine, question);
    return { ...engine.ask(question, prepared.detection), event: prepared.event };
  };
  try {
    for (const patient of PATIENT_CASES) {
      const engine = make(patient);
      for (const question of ['What is your name?', 'What brought you in?', 'When did it start?', 'Suddenly?', 'What were you doing when it started?', 'Do you have allergies?', 'Blargleflim?']) {
        assert.equal((await send(engine, question)).event.aiAttempted, false);
      }
    }
    assert.equal(requests.length, 0);
    const engine = make();
    assert.match((await send(engine, 'Do you have a rashh?')).reply, /ask that/);
    assert.equal(requests.length, 0);
    const accepted = await send(engine, 'Have you noticed a rashh?');
    assert.equal(accepted.event.finalResolutionSource, 'intent-rescue-ai');
    assert.match(accepted.reply, /No rash/);
    assert.equal((await send(engine, 'Please have you noticed a rashh?')).event.finalResolutionSource, 'intent-rescue-cache');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/intent-rescue');
    assert.deepEqual(requests[0].data.intents.map(item => item.id), ['ros_rash']);
    assert.ok(!('transcript' in requests[0].data || 'patient' in requests[0].data));

    behavior = 'invalid';
    await send(engine, 'Do you have a rassh?');
    const invalid = await send(engine, 'Have you noticed a rassh?');
    assert.equal(invalid.event.aiRescueUsed, false);
    assert.equal(engine.rescueState.count, 2);
    const restored = make().restoreState(JSON.parse(JSON.stringify(engine.exportState())));
    await send(restored, 'Is there a rashhh?');
    await send(restored, 'Have you noticed a rashhh?');
    assert.equal(requests.length, 2);
    for (const unavailable of ['offline', 'quota']) {
      behavior = unavailable;
      const offline = make();
      await send(offline, 'Do you have a rashh?');
      const failure = await send(offline, 'Have you noticed a rashh?');
      assert.ok(failure.event.aiError);
      assert.ok(offline.rescueState.disabled);
      await send(offline, 'Do you have a rassh?');
      await send(offline, 'Have you noticed a rassh?');
      assert.equal(offline.rescueState.count, 1);
      assert.match((await send(offline, 'What is your name?')).reply, /Peter Novak/);
    }
  } finally {
    globalThis.fetch = savedFetch;
    if (savedWindow === undefined) delete globalThis.window;
    else globalThis.window = savedWindow;
  }
});
