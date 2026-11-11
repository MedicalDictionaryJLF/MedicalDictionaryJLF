import { realizePatientReply } from '../anamnesis-training/src/dialogue/responseTemplates.js';
import { createShadowObserver } from '../anamnesis-training/src/dialogue/semanticShadowClient.js';
import { evaluateShadow, LANGUAGE_PROBES, rankByIntent, SHADOW_EXAMPLES } from '../anamnesis-training/src/dialogue/semanticShadow.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PATIENT_CASES } from '../anamnesis-training/src/cases/index.js';
import { createAnamnesisCase } from '../anamnesis-training/src/cases/caseFactory.js';
import { MEDICATION_DETAILS, CONVERSATION_FACTS } from '../anamnesis-training/src/cases/conversationFacts.js';
import { INTENTS } from '../anamnesis-training/src/data/interviewSchema.js';
import { QUESTION_VARIANTS, QUESTION_FOLLOWUPS } from '../anamnesis-training/src/data/questionVariants.js';
import { PatientEngine, normalize } from '../anamnesis-training/src/patientEngine.js';
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

test('the interview curriculum and all simulations remain active', () => {
  assert.equal(Object.keys(INTENTS).length, 155);
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
    assert.match((await send(engine, 'Do you have a rashh?')).reply, /name the symptom or topic/);
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
    while (engine.turn < 20) engine.ask('Okay.');
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

test('pilot wording preserves the subject of the current question and answers both clauses', () => {
  for (const difficulty of ['beginner', 'intermediate', 'advanced']) {
    const engine = make(peter, difficulty);
    assert.equal(engine.ask('What is your current complaint?').detectedIntent, 'chief_complaint');
    assert.match(engine.ask('When did it start?').reply, /2 hours before/);
    assert.match(engine.ask('How often do you take your medications?').reply, /ramipril once each morning/i);
    assert.match(engine.ask('Do you use some blood pressure medication?').reply, /ramipril/i);
    assert.deepEqual(engine.ask('Can zou sleep well at night?').answeredIds, ['intake_sleep']);
    assert.match(engine.ask('Do you have any problems with breathing?').reply, /short of breath/i);
    assert.match(engine.ask('How did you come to the hospital?').reply, /wife drove/i);
    const migraine = make(nina, difficulty);
    assert.match(migraine.ask('Where does the pain radiate?').reply, /one side/i);
    assert.match(migraine.ask('How long does the pain lasts?').reply, /4 to 12 hours/);
    const compound = migraine.ask('What is making your pain worse and what is helping you?');
    assert.deepEqual(compound.answeredIds, ['hpi_exacerbating', 'hpi_relieving']);
    assert.doesNotMatch(migraine.ask('What medication are you taking?+').reply, /ask that more directly/);
  }
});

test('family history credits only elicited topics and records the exchange in the debrief', () => {
  const engine = make();
  engine.ask('Do you have any other diseases?');
  assert.equal(engine.askedIntents.has('family_cardiovascular'), false);
  const specific = make().ask('Is there a family history of diabetes?');
  assert.deepEqual(specific.answeredIds, ['family_diabetes']);
  assert.doesNotMatch(specific.reply, /heart attack/);
  const question = 'Any family history of conditions we should be aware of?';
  const result = engine.ask(question);
  assert.deepEqual(result.answeredIds, ['family_history', 'family_cardiovascular', 'family_diabetes']);
  assert.match(result.reply, /heart attack.*diabetes/);
  const restored = make().restoreState(JSON.parse(JSON.stringify(engine.exportState())));
  assert.equal(restored.getDebrief().evidenceByIntent.family_cardiovascular.question, question);
  assert.equal(restored.getDebrief().evidenceByIntent.family_diabetes.reply, result.reply);
  assert.equal(restored.askedIntents.has('family_cancer'), false);
  assert.equal(restored.debugTurns.at(-1).studentEngineMismatch, false);

  const migraine = make(nina);
  migraine.ask('Do you have any allergies?');
  assert.equal(migraine.getDebrief().evidenceByIntent.allergies.resolved, true);
  assert.equal(migraine.getDebrief().missedEssential.includes('allergies'), false);
  assert.equal(migraine.askedIntents.has('allergies'), true);
});

test('shared authored answers, evidence and grading work for every case in all modes', () => {
  const expectedFamilyTopics = [
    ['family_cardiovascular', 'family_diabetes'],
    ['family_inherited', 'family_cardiovascular'],
    ['family_cardiovascular'],
    ['family_cardiovascular', 'family_diabetes', 'family_cancer', 'family_inherited'],
    ['family_cardiovascular', 'family_diabetes', 'family_cancer', 'family_inherited'],
    ['family_cardiovascular'],
    ['family_cardiovascular', 'family_diabetes', 'family_cancer', 'family_inherited'],
    ['family_inherited']
  ];
  for (const [index, patient] of PATIENT_CASES.entries()) {
    for (const mode of ['teaching', 'practice', 'exam']) {
      const engine = new PatientEngine(patient, { mode });
      const label = `${patient.id} (${mode})`;
      const intake = engine.ask('What is your current complaint?');
      assert.equal(intake.detectedIntent, 'chief_complaint', label);
      assert.ok(intake.answeredIds.includes('chief_complaint'), label);
      const dosing = engine.ask('How often do you take your medications?');
      assert.equal(dosing.detectedIntent, 'medication_frequency', label);
      assert.ok(!engine.attemptedIntents.has('hpi_timing'), label);
      engine.ask('Any family history of conditions we should be aware of?');
      const family = engine.debugTurns.at(-1).answers[0];
      assert.deepEqual(family.creditedIntentIds ?? [], expectedFamilyTopics[index], label);
      assert.deepEqual(family.factsUsed.map(fact => fact.intent), expectedFamilyTopics[index], label);
      assert.ok(family.factsUsed.every(fact => fact.paths.length), label);
      engine.ask('Do you have any allergies?');
      const evidence = engine.getDebrief().evidenceByIntent.allergies;
      assert.equal(evidence.resolved, true, label);
      assert.equal(evidence.reason, null, label);
      assert.ok(!engine.getDebrief().missedEssential.includes('allergies'), label);
    }
  }
});

test('structured text and uncertainty share the same answer path as legacy case fields', () => {
  const patient = createAnamnesisCase({
    id: 'raw-answer-test',
    identity: { sex: 'female' },
    allergies: 'I am allergic to penicillin.',
    conversationFacts: {
      allergies: { overview: { state: 'unknown' } },
      ros_dyspnea: { overview: { state: 'absent', text: 'I have not felt short of breath.' } }
    }
  });
  const engine = make(patient);
  const allergy = engine.ask('Do you have any allergies?');
  assert.doesNotMatch(allergy.reply, /penicillin/);
  assert.equal(engine.getDebrief().evidenceByIntent.allergies.reason, 'unknown');
  assert.equal(engine.ask('Do you have trouble breathing?').reply, 'I have not felt short of breath.');
  assert.equal(engine.debugTurns.at(-1).answers[0].factsUsed[0].state, 'absent');
});

test('pilot intake wording reaches the correct authored answer for every patient', () => {
  const checks = [
    ['What is your date of your birth?', 'identity_dob'],
    ['Where are zou from?', 'identity_residence'],
    ['What is your marrital status?', 'intake_marital_status'],
    ['Do you have kids?', 'intake_children'],
    ['What is zour hight?', 'intake_height'],
    ['How much do you weight?', 'intake_weight'],
    ['When were you admited?', 'administrative_admission_time'],
    ['How did you came to hospital?', 'administrative_arrival_method'],
    ['Who is your next of kim?', 'intake_contact_person'],
    ['What seems to be the problem?', 'chief_complaint'],
    ['Have you ever had any serious illness?', 'pmh_chronic_diseases'],
    ['Are you allergic to anything?', 'allergies'],
    ['Do you take any medications?', 'medication_regular'],
    ['How about unprescribed medicine?', 'medication_otc'],
    ['Tell me something about your family?', 'family_history'],
    ['Who do you live with?', 'social_household'],
    ['Do you use any drugs?', 'substance_drugs']
  ];
  for (const patient of PATIENT_CASES) {
    for (const [question, intent] of checks) {
      const engine = make(patient);
      const result = engine.ask(question);
      assert.equal(result.detectedIntent, intent, `${patient.id}: ${question}`);
      assert.ok(result.answeredIds.includes(intent), `${patient.id}: ${question}`);
    }
    const engine = make(patient);
    assert.deepEqual(engine.ask('What is your height and weight?').answeredIds, ['intake_height', 'intake_weight']);
    assert.equal(engine.ask('What is your phone number?').detection.responseScope, 'chart_details');
    assert.equal(engine.ask('Hi, my name is Sam and I am your nurse today.').detection.responseScope, 'social');
    assert.match(engine.ask('Do you take any drugs?').reply, /medicines.*recreational drugs/);
  }
});

test('second pilot pass answers new everyday questions without substituting unrelated facts', () => {
  const examples = [
    ['Where were you born?', 'intake_birthplace'],
    ['When did you born?', 'identity_dob'],
    ['Do you have sister or brother?', 'intake_siblings'],
    ['What kind of diet do you follow?', 'intake_diet'],
    ['How is your sleep quality?', 'intake_sleep'],
    ['What bring you here?', 'chief_complaint'],
    ['Have you ever experienced anything like this?', 'hpi_previous_episodes'],
    ['Have you been in hospital before?', 'pmh_hospitalizations'],
    ['When were you addmited?', 'administrative_admission_time'],
    ['How is your mobility?', 'social_current_function']
  ];
  for (const patient of PATIENT_CASES) {
    for (const [question, intent] of examples) {
      const response = make(patient).ask(question);
      assert.equal(response.detectedIntent, intent, `${patient.id}: ${question}`);
      assert.ok(response.answeredIds.includes(intent), `${patient.id}: ${question}`);
    }
  }
  const engine = make();
  engine.ask('Do you take any medications?');
  assert.match(engine.ask('What does atorvastatin do?').reply, /cholesterol/i);
  assert.equal(engine.ask('Do you take any drugs?').detectedIntent, 'medication_regular');
  assert.match(make().ask('Do you take any drugs?').reply, /medicines.*recreational drugs/i);
  assert.equal(engine.ask('What did you eat today?').detectedIntent, 'intake_last_meal');
  assert.equal(engine.ask('Who is your referring doctor?').detection.responseScope, 'chart_details');
  assert.equal(engine.ask('Where are you right now?').detection.responseScope, 'station_context');
});

test('question bank resolves every standalone variant against each patient in each mode', () => {
  const seen = new Set();
  for (const [intent, variants] of Object.entries(QUESTION_VARIANTS)) {
    assert.ok(Object.hasOwn(INTENTS, intent), intent);
    for (const phrase of variants) {
      const key = normalize(phrase);
      assert.ok(!seen.has(key), `Duplicate question: ${phrase}`);
      seen.add(key);
      for (const patient of PATIENT_CASES) {
        for (const mode of ['teaching', 'practice', 'exam']) {
          const engine = new PatientEngine(patient, { mode });
          const response = engine.ask(`Please, ${phrase}`);
          const label = `${patient.id} / ${mode} / ${phrase}`;
          assert.equal(response.detectedIntent, intent, label);
          assert.ok(response.answeredIds.includes(intent), label);
          assert.ok(engine.debugTurns.at(-1).answers[0].factsUsed.some(fact => fact.paths.length), label);
        }
      }
    }
  }
});

test('question-bank follow-ups require their preceding topic', () => {
  const setup = {
    identity_dob: 'What is your date of birth?',
    intake_birthplace: 'Where were you born?',
    identity_residence: 'Where do you live?',
    social_housing: 'What type of accommodation do you have?',
    social_household: 'Who shares your home with you?',
    allergies: 'Do you have any allergies?',
    medication_regular: 'What regular medicines do you take?',
    chief_complaint: 'What made you decide to get checked today?',
    hpi_previous_episodes: 'Is this the first episode you can remember?',
    hpi_onset: 'When did the chest pain start?',
    social_baseline_function: 'What was your baseline function?'
  };
  for (const { phrase, after, intent } of QUESTION_FOLLOWUPS) {
    for (const context of after) {
      const engine = make();
      assert.equal(engine.ask(setup[context]).detectedIntent, context);
      const result = engine.ask(phrase);
      assert.equal(result.detectedIntent, intent, phrase);
      assert.ok(result.answeredIds.includes(intent), phrase);
      assert.equal(result.detection.responseScope, 'contextual_followup');
    }
    const wrongContext = make();
    wrongContext.ask('What is your name?');
    const result = wrongContext.ask(phrase);
    assert.equal(result.detection.responseScope, 'clarification', phrase);
    assert.deepEqual(result.answeredIds, []);
  }
});

test('social turns respond naturally and preserve the active clinical topic', () => {
  for (const patient of PATIENT_CASES) {
    for (const mode of ['teaching', 'practice', 'exam']) {
      const engine = new PatientEngine(patient, { mode });
      const examples = [
        ['Hi, i am renata iam going to be your nurse today.', 'introduction', /nice to meet you/i],
        ['Can I ask you a few questions?', 'permission', /go ahead/i],
        ['That sounds frightening.', 'empathy', /appreciate/i],
        ['Take your time.', 'reassurance', /helps/i],
        ['okay, that is amaying', 'acknowledgment', /all right/i],
        ['Thank you for telling me.', 'thanks', /welcome/i],
        ['No.', 'acknowledgment', /all right/i],
        ['I’ll be back soon.', 'closing', /thank you/i]
      ];
      for (const [question, act, reply] of examples) {
        const result = engine.ask(question);
        assert.equal(result.detection.socialAct, act, question);
        assert.match(result.reply, reply, question);
        assert.deepEqual(result.answeredIds, [], question);
      }
      assert.equal(engine.attemptedIntents.size, 0);
      assert.equal(engine.askedIntents.size, 0);
      engine.ask('What made you decide to get checked today?');
      engine.ask('I see.');
      assert.deepEqual(engine.ask('When did it start?').answeredIds, ['hpi_onset']);
    }
  }
});

test('mixed social and clinical clauses receive both replies without duplicate history credit', () => {
  const engine = make();
  const first = engine.ask('Hi, I am Alex and I will be your student nurse today. What is your name?');
  assert.match(first.reply, /nice to meet you.*Peter Novak/i);
  assert.deepEqual(first.answeredIds, ['identity_name']);
  const second = engine.ask('Thanks! What made you decide to get checked today?');
  assert.match(second.reply, /welcome.*pressure/i);
  assert.deepEqual(second.answeredIds, ['chief_complaint']);
  const third = engine.ask('I’m sorry to hear that, and when did the chest pain start?');
  assert.match(third.reply, /appreciate.*2 hours/i);
  assert.deepEqual(third.answeredIds, ['hpi_onset']);
  assert.deepEqual([...engine.attemptedIntents], ['identity_name', 'chief_complaint', 'hpi_onset']);
  const spoken = engine.ask('Okay when did it start');
  assert.match(spoken.reply, /all right.*2 hours/i);
  assert.deepEqual(spoken.answeredIds, ['hpi_onset']);
});

test('subject switches, corrections and unavailable details work in every patient and mode', () => {
  for (const patient of PATIENT_CASES) {
    for (const mode of ['teaching', 'practice', 'exam']) {
      const engine = new PatientEngine(patient, { mode });
      engine.ask('What brought you here?');
      engine.ask('Do you have back pain?');
      engine.ask('I see.');
      const back = engine.ask('When did it start?');
      assert.equal(back.detectedIntent, 'ros_back_pain', patient.id);
      assert.match(back.reply, /back pain.*started/, patient.id);
      assert.deepEqual(back.answeredIds, [], patient.id);
      const meal = engine.ask('What did you eat today?');
      assert.equal(meal.detectedIntent, 'intake_last_meal');
      assert.deepEqual(meal.answeredIds, []);
      assert.match(meal.reply, /last meal/);
      assert.equal(engine.debugTurns.at(-1).answers[0].reason, 'not_authored');
      engine.ask('Do you take any drugs?');
      engine.ask('Okay.');
      assert.equal(engine.ask('I meant recreational drugs.').detectedIntent, 'substance_drugs');
      engine.ask('Which medicines do you take on a normal day?');
      assert.equal(engine.ask('What do they do?').detectedIntent, 'medication_indication');
    }
  }
  const peterEngine = make();
  peterEngine.ask('Do you have back pain?');
  assert.equal(peterEngine.ask('When did it start?').detectedIntent, 'ros_back_pain');
  const resumed = make().restoreState(JSON.parse(JSON.stringify(peterEngine.exportState())));
  assert.match(resumed.ask('No, I meant the chest pain.').reply, /2 hours before/);
});

test('a new synthetic case can supply a separate onset and last-meal fact', () => {
  const patient = createAnamnesisCase({
    id: 'new-context-test',
    identity: { sex: 'female' },
    presentingSymptom: { name: 'cough', region: 'breathing', aliases: /\bcough\b/ },
    chiefComplaint: 'I have a cough.',
    hpi: { onset: 'The cough began yesterday.' },
    rosDetails: { gastrointestinal: { nausea: 'I also feel nauseous.' } },
    subjectAliases: { ros_nausea: { name: 'nausea', aliases: ['feel queasy', 'queasiness'] } },
    subjectHistory: { ros_nausea: { 'onset.time': 'I started feeling nauseous this morning.' } },
    intake: { lastMeal: 'I ate toast at breakfast.' }
  });
  const engine = make(patient);
  engine.ask('What brought you here?');
  assert.equal(engine.ask('Do you feel queasy?').detectedIntent, 'ros_nausea');
  assert.match(engine.ask('When did it start?').reply, /nauseous this morning/);
  assert.match(engine.ask('No, I meant the cough.').reply, /cough began yesterday/);
  assert.match(engine.ask('What did you eat today?').reply, /toast/);
});

test('an ambiguous symptom choice asks for clarification and reuses the original onset question', () => {
  const engine = make();
  const ambiguous = engine.ask('When did the chest pain and back pain start?');
  assert.match(ambiguous.reply, /chest pressure or the back pain/);
  assert.deepEqual(ambiguous.answeredIds, []);
  assert.equal(engine.attemptedIntents.size, 0);
  assert.match(engine.ask('I meant the chest pain.').reply, /2 hours before/);
});

test('a first-pass AI rescue is rate-limited and returns only authored case answers', async () => {
  const savedFetch = globalThis.fetch;
  const savedWindow = globalThis.window;
  const requests = [];
  globalThis.window = { ANAMNESIS_AI_ENABLED: true, location: { protocol: 'https:', hostname: 'example.test' } };
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    requests.push(payload);
    return Response.json({
      success: true, intent: 'social_current_function', confidence: 0.97, ...payload.interpretation
    });
  };
  try {
    const engine = make();
    for (let turn = 0; turn < 12; turn++) engine.ask('Okay.');
    const text = 'Do you have problem with walking for long distance?';
    const prepared = await prepareQuestionWithAI(engine, text);
    assert.equal(prepared.event.finalResolutionSource, 'intent-rescue-ai');
    assert.equal(engine.ask(text, prepared.detection).reply, engine.answerFor('social_current_function'));
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].intents.map(item => item.id), ['social_current_function', 'hpi_exacerbating']);
    assert.equal((await prepareQuestionWithAI(engine, 'Did you have any medical symptoms in past?')).event.aiAttempted, false);
    assert.equal((await prepareQuestionWithAI(engine, 'Do you take any drugs?')).event.aiAttempted, false);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedWindow === undefined) delete globalThis.window;
    else globalThis.window = savedWindow;
  }
});

test('frequent pilot variants use authored answers or a targeted clarification', () => {
  for (const patient of PATIENT_CASES) {
    const engine = make(patient);
    const arrival = engine.ask('Did you came here by car or by bus?');
    assert.equal(arrival.detectedIntent, 'administrative_arrival_method', patient.id);
    assert.equal(arrival.reply, engine.answerFor('administrative_arrival_method'));
    const earlier = engine.ask('Have you experienced something similar before?');
    assert.equal(earlier.detectedIntent, 'hpi_previous_episodes');
    assert.ok(earlier.answeredIds.includes('hpi_previous_episodes'));
    const bowel = engine.ask('How often do you have a bowl movement?');
    assert.equal(bowel.detectedIntent, 'ros_bowel_frequency');
    assert.deepEqual(bowel.answeredIds, []);
    assert.match(bowel.reply, /how often I have a bowel movement/);
    assert.match(engine.ask('Do you have family?').reply, /who I live with.*medical history/);
    assert.equal(engine.ask('Who you live with.').detectedIntent, 'social_household');
    assert.match(engine.ask('Drugs?').reply, /medicines.*recreational drugs/);
    assert.equal(engine.ask('Recreational drugs.').detectedIntent, 'substance_drugs');
  }
  const engine = make(nina);
  for (const question of ['When was your last visit at gynaecology?', 'When was your last visit at gynecolgist?']) {
    const result = engine.ask(question);
    assert.equal(result.detectedIntent, 'gyn_last_visit');
    assert.deepEqual(result.answeredIds, []);
    assert.match(result.reply, /last gynaecology visit/);
  }
  engine.ask('What brought you here?');
  assert.equal(engine.ask('Did this happened before?').detectedIntent, 'hpi_previous_episodes');
  assert.match(engine.ask('How long?').reply, /started.*lasts/);
  assert.equal(engine.ask('When it started.').detectedIntent, 'hpi_onset');
});

test('time confirmations preserve the authored value and the same fact and credit', () => {
  const engine = make();
  engine.ask('What brought you here?');
  const first = engine.ask('When did the chest pain start?');
  const originalFact = engine.debugTurns.at(-1).answers[0].factsUsed[0].id;
  const confirmation = engine.ask('Was it three hours before you arrived?');
  assert.match(confirmation.reply, /about 2 hours before I arrived/i);
  assert.doesNotMatch(confirmation.reply, /yes|three hours/i);
  assert.deepEqual(confirmation.answeredIds, first.answeredIds);
  assert.equal(engine.debugTurns.at(-1).answers[0].factsUsed[0].id, originalFact);
  engine.ask('Do you have back pain?');
  engine.ask('When did it start?');
  const correction = engine.ask('No, I meant the chest pain.');
  assert.match(correction.reply, /Oh, the chest pressure.*2 hours/);
  assert.equal(engine.debugTurns.at(-1).answers[0].factsUsed[0].id, originalFact);
  const slovak = new PatientEngine(peter, { interviewLanguage: 'sk' });
  assert.match(slovak.ask('When did the chest pain start?').reply, /asi 2 hodiny pred príchodom/);
  assert.equal(slovak.debugTurns.at(-1).answers[0].factsUsed[0].id, originalFact);
  const duration = make(nina);
  duration.ask('What brought you here?');
  assert.match(duration.ask('Does each attack last two hours?').reply, /4 to 12 hours/);
  const medicines = make();
  medicines.ask('What medicines do you take regularly?');
  assert.equal(medicines.ask('Do you take them twice a day?').detectedIntent, 'medication_frequency');
});

test('semantic shadow ranks distinct intents and cannot change the interview', async () => {
  assert.equal(createShadowObserver('', () => { throw new Error('must not load'); }), null);
  assert.ok(LANGUAGE_PROBES.every(([, phrase, intent]) => INTENTS[intent] &&
    !SHADOW_EXAMPLES.some(item => item.phrase === phrase)));
  const candidates = rankByIntent([1, 0], [
    { intent: 'hpi_timing', vector: [0.8, 0.6] },
    { intent: 'hpi_timing', vector: [1, 0] },
    { intent: 'hpi_onset', vector: [0.6, 0.8] }
  ]);
  assert.deepEqual(candidates.map(item => item.intent), ['hpi_timing', 'hpi_onset']);
  const engine = make();
  const result = engine.ask('Blargleflim?');
  const fakeWorker = { postMessage({ id }) { queueMicrotask(() => this.onmessage({ data: { id, candidates } })); } };
  const observer = createShadowObserver('1', () => fakeWorker);
  const pending = observer.rank('How long is one spell from beginning to end?');
  assert.equal((await observer.rank('Another question')).status, 'busy');
  assert.deepEqual((await pending).candidates, candidates);
  assert.equal(result.detection.responseScope, 'clarification');
  assert.equal(engine.askedIntents.size, 0);
  const rows = await evaluateShadow(async () => candidates, [['en', 'Unseen duration phrasing', 'hpi_timing']]);
  assert.equal(rows[0].top, 'hpi_timing');
  assert.equal(rows[0].top3, true);
  const blocked = createShadowObserver('1', () => { throw new Error('blocked'); });
  assert.equal((await blocked.rank('A question')).status, 'unavailable');
});

test('temporal contrasts preserve the topic and never credit an unauthored event', async () => {
  for (const patient of PATIENT_CASES) {
    for (const mode of ['teaching', 'practice', 'exam']) {
      for (const [question, intent, attribute] of [
        ['Did it last two hours yesterday?', 'hpi_timing', 'timing.duration'],
        ['Did it get worse since two days ago?', 'hpi_course', 'progression']
      ]) {
        const engine = new PatientEngine(patient, { mode });
        engine.ask('What brought you here?');
        const answer = engine.ask(question);
        assert.equal(answer.detectedIntent, intent, patient.id + question);
        assert.equal(answer.detection.analysis.attribute, attribute);
        assert.ok(!answer.answeredIds.includes('hpi_onset'));
      }
      for (const question of [
        'Did you take any medication two hours before you arrived?',
        'Did you take your medication today?',
        'What medication did you take today?',
        'Did it start two hours after you took your pills?'
      ]) {
        const engine = new PatientEngine(patient, { mode });
        engine.ask('What brought you here?');
        const prepared = await prepareQuestionWithAI(engine, question);
        const answer = engine.ask(question, prepared.detection);
        assert.equal(prepared.event.aiAttempted, false);
        assert.deepEqual(answer.answeredIds, [], patient.id + question);
        assert.equal(engine.debugTurns.at(-1).answers[0].status, 'recognized_unknown');
        assert.deepEqual(engine.debugTurns.at(-1).answers[0].factsUsed, []);
        assert.match(answer.reply, /unsure/);
      }
    }
  }
  const engine = make();
  engine.ask('When did the chest pain start?');
  const previous = engine.debugTurns.at(-1).answers[0].factsUsed[0].id;
  assert.match(engine.ask('Three hours ago?').reply, /2 hours/);
  assert.equal(engine.debugTurns.at(-1).answers[0].factsUsed[0].id, previous);
  engine.ask('What medicines do you take?');
  assert.equal(engine.ask('Do you take ramipril twice a day?').reply, 'I take ramipril once each morning.');
  const multiple = engine.ask('Do you take ramipril and atorvastatin twice a day?');
  assert.equal(multiple.detection.analysis.target, null);
  const collective = engine.ask('Do you take them twice a day?');
  assert.equal(collective.detection.analysis.target, null);
  assert.equal(collective.detection.analysis.attribute, 'overview');
  assert.doesNotMatch(collective.reply, /^I take ramipril once each morning\.$/);
});

test('shadow failures settle pending work without trusting malformed model output', async () => {
  for (const malformed of [null, {}, { id: 1, candidates: [] },
    { id: 1, candidates: [{ intent: 'invented', score: 1 }] },
    { id: 1, candidates: [{ intent: 'hpi_onset', score: NaN }] },
    { id: 1, candidates: [{ intent: 'hpi_onset', score: 2 }] },
    { id: 1, candidates: [{ intent: 'hpi_onset', score: 0.8 }, { intent: 'hpi_onset', score: 0.7 }] }]) {
    let terminated = 0;
    const worker = { terminate() { terminated++; }, postMessage() { queueMicrotask(() => this.onmessage({ data: malformed })); } };
    const observer = createShadowObserver('1', () => worker, 50);
    assert.equal((await observer.rank('A question?')).status, 'unavailable');
    assert.equal(terminated, 1);
    assert.equal((await observer.rank('Another question?')).status, 'unavailable');
  }
  for (const event of ['onerror', 'onmessageerror']) {
    const worker = { terminate() { throw new Error('already closed'); }, postMessage() { queueMicrotask(() => this[event]()); } };
    assert.equal((await createShadowObserver('1', () => worker, 50).rank('Question?')).status, 'unavailable');
  }
  for (const worker of [{ postMessage() {} }, { postMessage() { throw new Error('closed'); } }]) {
    const observer = createShadowObserver('1', () => worker, 5);
    assert.equal((await observer.rank('Question?')).status, 'unavailable');
  }
  let requests = 0;
  const observer = createShadowObserver('1', () => { requests++; throw new Error('must not load'); });
  for (const input of [null, undefined, '', '  ', 123, 'x'.repeat(241)]) {
    assert.equal((await observer.rank(input)).status, 'invalid');
  }
  assert.equal(requests, 0);
  assert.throws(() => rankByIntent([NaN], []));
  assert.throws(() => rankByIntent([], []));
  assert.throws(() => rankByIntent([1], [{ intent: 'hpi_onset', vector: [Infinity] }]));
  for (const [intent, phrases] of Object.entries(QUESTION_VARIANTS)) {
    for (const phrase of phrases) assert.ok(SHADOW_EXAMPLES.some(item => item.intent === intent && item.phrase === phrase));
  }
});


test('reply variations retain narrative qualifiers and ignore unknown structured records', () => {
  const onset = { intent: 'hpi_onset', attribute: 'onset.time', state: 'present',
    value: { value: 2, unit: 'hour', reference: 'admission', text: 'My headache started yesterday after lunch.' } };
  assert.equal(realizePatientReply(onset, { type: 'confirmation' }).text, onset.value.text);
  assert.equal(realizePatientReply({ ...onset, state: 'not_authored' }, { type: 'confirmation' }), null);
  const duration = { intent: 'hpi_timing', attribute: 'timing.duration', state: 'present',
    value: { value: 2, unit: 'hour', episode: 'attacks', about: true, condition: 'if untreated', source: 'my daughter' } };
  assert.match(realizePatientReply(duration, { type: 'confirmation' }).text, /about 2 hours if untreated, according to my daughter/);
});

test('malformed structured values remain unavailable instead of producing fabricated text', () => {
  for (const [attribute, value] of [
    ['onset.time', { phrase: 123 }], ['timing.duration', { phrase: {}, episode: 'attacks' }],
    ['timing.duration', { phrase: 'half an hour' }],
    ['onset.time', { phrase: {}, value: 2, unit: 'hour' }],
    ['severity.current', { value: 0, scale: 0 }],
    ['radiation.sites', { state: 'present', values: [123] }],
    ['character.qualities', { positive: [123] }],
    ['character.qualities', { positive: ['sharp'], negative: 'dull' }]
  ]) {
    assert.equal(realizePatientReply({ intent: 'hpi_onset', attribute, value, state: 'present' }), null);
  }
  const fact = { intent: 'hpi_timing', attribute: 'timing.duration', state: 'present',
    value: { phrase: 'about half an hour', episode: 'attacks', condition: 'if untreated', source: 'my daughter' } };
  assert.match(realizePatientReply(fact, { type: 'confirmation' }).text, /about half an hour if untreated, according to my daughter/);
});

test('new cases can author precise medication timing without changing generic answers', () => {
  const patient = createAnamnesisCase({
    id: 'new-medication-timing-test', identity: { sex: 'male' },
    presentingSymptom: { name: 'cough', region: 'breathing', aliases: /\bcough\b/ },
    chiefComplaint: 'I have a cough.', hpi: { onset: 'The cough began yesterday.' },
    conversationFacts: {
      hpi_onset: { 'onset.medication_relation': { text: 'The cough began before I took the tablet.' } },
      medication_adherence: { 'medication.specific_timing': { text: 'I took my prescribed medicine at breakfast today.' } }
    }
  });
  const engine = make(patient);
  assert.equal(engine.ask('Did the cough start after you took your pills?').reply, 'The cough began before I took the tablet.');
  assert.deepEqual(engine.debugTurns.at(-1).answeredIds, ['hpi_onset']);
  const timing = engine.ask('Did you take your medication today?');
  assert.equal(timing.reply, 'I took my prescribed medicine at breakfast today.');
  assert.deepEqual(timing.answeredIds, ['medication_adherence']);
});
