import { getBedsideFinding, ECG_LEADS } from './scene/bedsideInteractions.js';

const EXAM_STEPS = {
  general: [['inspect', 'general']],
  perfusion: [['palpate', 'perfusion-right'], ['palpate', 'perfusion-left']],
  cardiovascular: ['aortic', 'pulmonic', 'tricuspid', 'mitral'].map(site => ['auscultate', `heart-${site}`]),
  pulses: [['palpate', 'radial-right'], ['palpate', 'radial-left']],
  respiratory: [['inspect', 'chest'], ...['front-right', 'front-left', 'back-right', 'back-left'].map(site => ['auscultate', `lung-${site}`])],
  chestWall: [['palpate', 'chest-wall']],
  legs: ['inspect', 'palpate'].flatMap(technique => ['right', 'left'].map(side => [technique, `leg-${side}`])),
  abdomen: ['ruq', 'luq', 'rlq', 'llq'].map(site => ['palpate', `abdomen-${site}`]),
  bowelSounds: ['ruq', 'luq', 'rlq', 'llq'].map(site => ['auscultate', `abdomen-${site}`])
};

const HISTORY_REASONING = {
  progressive_dyspnea_edema: ['decompensated heart failure', 'congestive heart failure', 'heart failure'],
  fever_flank_dysuria: ['acute pyelonephritis', 'pyelonephritis'],
  melena_dizziness_nsaid: ['upper gastrointestinal bleed', 'upper gi bleed', 'gastrointestinal bleeding', 'bleeding peptic ulcer'],
  exertional_syncope: ['high risk exertional syncope', 'cardiac syncope', 'aortic stenosis', 'structural heart disease'],
  weight_loss_bowel_change: ['suspected colorectal cancer', 'colorectal malignancy', 'colorectal cancer', 'colon cancer'],
  recurrent_headache_migraine: ['migraine with aura', 'migraine']
};

const PROFILES = {
  chest_pain_acs_risk: {
    examinations: [
      { id: 'general', group: 'Immediate assessment', label: 'General appearance & mental status', findingPath: 'exam.general', required: true },
      { id: 'perfusion', group: 'Immediate assessment', label: 'Peripheral perfusion', findingPath: 'exam.perfusion', required: true },
      { id: 'cardiovascular', group: 'Cardiovascular', label: 'Cardiac auscultation', findingPath: 'exam.heart', required: true },
      { id: 'pulses', group: 'Cardiovascular', label: 'Peripheral pulses', findingPath: 'exam.pulses', required: true },
      { id: 'jvp', group: 'Cardiovascular', label: 'JVP assessment', findingPath: 'exam.jvp', required: false },
      { id: 'respiratory', group: 'Respiratory', label: 'Respiratory examination', findingPath: 'exam.lungs', required: true },
      { id: 'chestWall', group: 'Chest pain discrimination', label: 'Chest wall palpation', findingPath: 'exam.chestWall', required: false },
      { id: 'legs', group: 'Chest pain discrimination', label: 'Lower-limb examination for DVT / oedema', findingPath: 'exam.legs', required: false },
      { id: 'abdomen', group: 'Additional', label: 'Abdominal examination', findingPath: 'exam.abdomen', required: false }
    ],
    primary: ['acute coronary syndrome', 'acs', 'myocardial infarction', 'heart attack', 'stemi', 'inferior stemi'],
    differentials: [
      ['pulmonary embolism', 'pe'],
      ['aortic dissection', 'dissection'],
      ['gastroesophageal reflux disease', 'gastro-oesophageal reflux disease', 'gerd', 'reflux'],
      ['pericarditis'],
      ['musculoskeletal chest pain', 'costochondritis'],
      ['panic attack', 'panic disorder']
    ],
    summarySignals: [['58', '58-year-old', '58 year old'], ['chest', 'retrosternal', 'sternum'], ['pressure', 'tightness', 'heavy'], ['left arm', 'jaw', 'radiat']],
    investigationSignals: [['ecg', 'electrocardiogram'], ['troponin', 'cardiac enzyme'], ['monitor', 'telemetry', 'vital'], ['fbc', 'blood count', 'haemoglobin', 'hemoglobin'], ['renal', 'creatinine', 'electrolyte']],
    managementSignals: [['aspirin', 'antiplatelet'], ['cardiology', 'senior', 'stemi', 'cath', 'pci', 'reperfusion'], ['monitor', 'telemetry', 'iv access'], ['anticoag', 'heparin'], ['nitrate', 'nitroglycerin', 'analgesia']]
  },
  abdominal_pain_cholecystitis: {
    examinations: [
      { id: 'general', group: 'General', label: 'General appearance', findingPath: 'exam.general', required: true },
      { id: 'abdomen', group: 'Abdomen', label: 'Abdominal examination', findingPath: 'exam.abdomen', required: true },
      { id: 'bowelSounds', group: 'Abdomen', label: 'Bowel sounds', findingPath: 'exam.bowelSounds', required: true },
      { id: 'cardiovascular', group: 'Cardiovascular', label: 'Cardiac examination', findingPath: 'exam.heart', required: false },
      { id: 'respiratory', group: 'Respiratory', label: 'Respiratory examination', findingPath: 'exam.lungs', required: false }
    ],
    primary: ['acute cholecystitis', 'cholecystitis'],
    differentials: [
      ['biliary colic'],
      ['ascending cholangitis', 'cholangitis'],
      ['acute pancreatitis', 'pancreatitis'],
      ['peptic ulcer disease', 'pud', 'peptic ulcer'],
      ['hepatitis'],
      ['appendicitis']
    ],
    summarySignals: [['43', '43-year-old', '43 year old'], ['right upper', 'ruq', 'right rib'], ['fatty', 'meal', 'food'], ['nausea', 'vomit'], ['fever', 'chill']],
    investigationSignals: [['ultrasound', 'usg', 'sonography'], ['liver', 'bilirubin', 'alp', 'ggt', 'alt', 'ast'], ['wbc', 'crp', 'inflammatory']],
    managementSignals: [['surgery', 'surgical', 'surgeon', 'senior'], ['analgesia', 'pain relief'], ['antibiotic', 'iv fluid', 'fluids']]
  }
};

export function createEncounterState() {
  return {
    examined: [],
    examFindings: {},
    examActions: [],
    ecg: { placedLeads: [], attempts: [], completed: false, completedAt: null, resetCount: 0 },
    notes: { history: '', examination: '', investigations: '', impression: '' },
    differentials: [],
    closing: { presentation: '', primaryDiagnosis: '', investigations: '', management: '' },
    completed: false,
    report: null
  };
}

export function getEncounterProfile(patientCase) {
  return PROFILES[patientCase?.id] ?? {
    examinations: [
      { id: 'general', group: 'General', label: 'General appearance', findingPath: 'exam.general', required: true },
      { id: 'cardiovascular', group: 'Cardiovascular', label: 'Cardiac examination', findingPath: 'exam.heart', required: false },
      { id: 'respiratory', group: 'Respiratory', label: 'Respiratory examination', findingPath: 'exam.lungs', required: false },
      { id: 'abdomen', group: 'Abdomen', label: 'Abdominal examination', findingPath: 'exam.abdomen', required: false }
    ],
    primary: HISTORY_REASONING[patientCase?.id] || [], differentials: [], summarySignals: [], investigationSignals: [], managementSignals: []
  };
}

export function getExaminationActions(patientCase, encounterState) {
  const profile = getEncounterProfile(patientCase);
  return profile.examinations
    .filter(exam => EXAM_STEPS[exam.id])
    .map(exam => {
      const steps = [...EXAM_STEPS[exam.id]];
      if (exam.id === 'abdomen' && patientCase.id === 'abdominal_pain_cholecystitis') steps.push(['palpate', 'murphy-ruq']);
      const observed = encounterState.examActions || [];
      const completedSteps = steps.filter(([technique, siteId]) => observed.some(record => record.caseId === patientCase.id && record.technique === technique && record.siteId === siteId));
      const assessed = steps.some(([technique, siteId]) => getBedsideFinding(patientCase, siteId, technique)?.documented);
      return { ...exam, assessed, steps, completedSteps, performed: completedSteps.length === steps.length, finding: encounterState.examFindings[exam.id] || '' };
    });
}

export function performExamination(patientCase, encounterState, examinationId, interaction = {}) {
  if (!interaction.environmentReady || encounterState.completed) return { ok: false, reason: 'A live 3D environment and an active attempt are required.' };
  const result = getBedsideFinding(patientCase, interaction.siteId, interaction.technique);
  if (!result || interaction.caseId !== patientCase.id || (examinationId && result.examinationId !== examinationId)) return { ok: false, reason: 'Select a valid technique and anatomical site for this patient.' };
  const record = { ...result, at: new Date().toISOString(), position: interaction.position || 'unknown', input: interaction.input === 'accessible' ? 'accessible' : '3d', status: result.documented ? 'finding-obtained' : 'performed-unavailable' };
  encounterState.examActions ||= [];
  record.repeated = encounterState.examActions.some(item => item.caseId === record.caseId && item.siteId === record.siteId && item.technique === record.technique);
  encounterState.examActions.push(record);
  if (result.documented) encounterState.examFindings[`${result.technique}:${result.siteId}`] = result.finding;
  const actions = getExaminationActions(patientCase, encounterState);
  for (const action of actions) {
    if (!action.performed) continue;
    if (!encounterState.examined.includes(action.id)) encounterState.examined.push(action.id);
    encounterState.examFindings[action.id] = [...new Set(encounterState.examActions.filter(item => item.examinationId === action.id && item.documented).map(item => item.finding))].join(' ');
  }
  return { ok: true, action: actions.find(action => action.id === result.examinationId) || { id: result.examinationId, label: result.siteLabel }, finding: result.finding, record };
}

export function recordEcgProgress(patientCase, encounterState, detail, environmentReady) {
  if (!environmentReady || encounterState.completed || detail?.caseId !== patientCase.id) return { ok: false };
  const ids = [...new Set(Array.isArray(detail.placedLeads) ? detail.placedLeads : [])];
  if (ids.some(id => !ECG_LEADS.some(lead => lead.id === id))) return { ok: false };
  const ecg = encounterState.ecg;
  const previous = ecg.placedLeads;
  if (detail.reset) { ecg.placedLeads = []; ecg.resetCount += 1; return { ok: true, newlyCompleted: false }; }
  if (detail.selectedId) {
    const correct = detail.selectedId === detail.targetId;
    ecg.attempts.push({ selectedId: detail.selectedId, targetId: detail.targetId, correct, at: new Date().toISOString() });
    if (!correct) return { ok: true, newlyCompleted: false };
    if (!ECG_LEADS.some(lead => lead.id === detail.selectedId) || previous.includes(detail.selectedId) || ids.length !== previous.length + 1 || !previous.every(id => ids.includes(id)) || !ids.includes(detail.selectedId)) return { ok: false };
  } else return { ok: false };
  ecg.placedLeads = ids;
  const newlyCompleted = ids.length === 10 && !ecg.completed;
  if (newlyCompleted) { ecg.completed = true; ecg.completedAt = new Date().toISOString(); }
  return { ok: true, newlyCompleted };
}

export function updateClinicalNotes(encounterState, patch = {}) {
  encounterState.notes = { ...encounterState.notes, ...patch };
  return encounterState.notes;
}

export function addDifferential(encounterState, diagnosis) {
  const clean = String(diagnosis ?? '').trim().replace(/\s+/g, ' ');
  if (!clean) return { ok: false, reason: 'Enter a diagnosis first.' };
  if (encounterState.differentials.some((item) => normalize(item) === normalize(clean))) return { ok: false, reason: 'That diagnosis is already on the board.' };
  if (encounterState.differentials.length >= 5) return { ok: false, reason: 'The board is limited to five working diagnoses.' };
  encounterState.differentials.push(clean);
  return { ok: true, differentials: [...encounterState.differentials] };
}

export function removeDifferential(encounterState, index) {
  if (index < 0 || index >= encounterState.differentials.length) return;
  encounterState.differentials.splice(index, 1);
}

export function moveDifferential(encounterState, index, direction) {
  const next = index + direction;
  if (index < 0 || next < 0 || index >= encounterState.differentials.length || next >= encounterState.differentials.length) return;
  [encounterState.differentials[index], encounterState.differentials[next]] = [encounterState.differentials[next], encounterState.differentials[index]];
}

export function evaluateExamination(patientCase, encounterState) {
  const actions = getExaminationActions(patientCase, encounterState);
  const required = actions.filter(item => item.required && item.assessed);
  const completed = required.filter(item => item.performed);
  return {
    percent: required.length ? Math.round((completed.length / required.length) * 100) : null,
    assessed: required.length > 0,
    required: required.map((item) => item.label),
    completed: completed.map((item) => item.label),
    missed: required.filter(item => !item.performed).map(item => item.label),
    partial: actions.filter(item => item.completedSteps.length && !item.performed).map(item => ({ label: item.label, completed: item.completedSteps.length, total: item.steps.length })),
    record: (encounterState.examActions || []).map(item => ({ ...item })),
    unavailable: (encounterState.examActions || []).filter(item => !item.documented).length,
    ecg: JSON.parse(JSON.stringify(encounterState.ecg)),
    limitation: required.length ? '' : 'Current physical findings are not authored for this case. Procedural attempts are recorded; this domain is excluded from the score.'
  };
}

export function evaluateDifferential(patientCase, encounterState, primaryDiagnosis = '') {
  const profile = getEncounterProfile(patientCase);
  const primaryMatch = matchesAny(primaryDiagnosis, profile.primary);
  const board = encounterState.differentials;
  const boardPrimaryIndex = board.findIndex((item) => matchesAny(item, profile.primary));
  const acceptedAlternatives = profile.differentials.map(aliases => board.find(item => matchesAny(item, aliases))).filter(Boolean);
  const alternativesScore = Math.min(30, acceptedAlternatives.length * 15);
  const rankingBonus = boardPrimaryIndex === 0 ? 10 : boardPrimaryIndex > 0 && boardPrimaryIndex < 3 ? 5 : 0;
  const percent = !profile.primary.length ? null : !profile.differentials.length ? (primaryMatch ? 100 : 0) : Math.min(100, (primaryMatch ? 60 : 0) + alternativesScore + rankingBonus);
  return {
    percent,
    primaryMatched: primaryMatch,
    primaryOnBoard: boardPrimaryIndex >= 0,
    primaryRank: boardPrimaryIndex >= 0 ? boardPrimaryIndex + 1 : null,
    acceptedAlternatives,
    board: [...board]
  };
}

export function evaluateClosing(patientCase, encounterState, closingInput = {}) {
  const profile = getEncounterProfile(patientCase);
  const presentation = String(closingInput.presentation ?? '');
  const investigations = String(closingInput.investigations ?? '');
  const management = String(closingInput.management ?? '');
  const diagnosis = evaluateDifferential(patientCase, encounterState, closingInput.primaryDiagnosis ?? '');

  const summaryHits = countSignalGroups(presentation, profile.summarySignals);
  const investigationHits = countSignalGroups(investigations, profile.investigationSignals);
  const managementHits = countSignalGroups(management, profile.managementSignals);
  const summaryPercent = profile.summarySignals.length ? Math.round((summaryHits / profile.summarySignals.length) * 100) : null;
  const investigationPercent = profile.investigationSignals.length ? Math.min(100, Math.round((investigationHits / profile.investigationSignals.length) * 100)) : null;
  const managementPercent = profile.managementSignals.length ? Math.min(100, Math.round((managementHits / profile.managementSignals.length) * 100)) : null;
  const percent = weightedScore([[summaryPercent, .5], [investigationPercent, .25], [managementPercent, .25]]);

  return { percent, summaryPercent, investigationPercent, managementPercent, diagnosis };
}

function assessInvestigations(patientCase, encounterState, results, actions, closing, environmentReady) {
  const criteria = [];
  const add = (label, available, obtained, safety = false) => { if (available) criteria.push({ label, obtained, safety }); };
  if (patientCase.id === 'chest_pain_acs_risk') {
    add('12-lead ECG acquisition', patientCase.ecg?.available && (environmentReady || encounterState.ecg.completed), encounterState.ecg.completed, true);
    add('High-sensitivity troponin', patientCase.labs?.hsTroponinT, Boolean(results.hsTroponinT));
    add('Bedside vital signs', /\d/.test(patientCase.vitals?.bp || ''), actions.some(item => item.type === 'objective-vitals'));
  } else if (patientCase.id === 'abdominal_pain_cholecystitis') {
    add('Full blood count', patientCase.labs?.wbc, Boolean(results.wbc));
    add('Inflammatory markers', patientCase.labs?.crp, Boolean(results.crp));
  }
  const selected = criteria.filter(item => item.obtained);
  const selectionPercent = criteria.length ? Math.round(selected.length / criteria.length * 100) : null;
  const ecgAcquired = Boolean(patientCase.ecg?.available && encounterState.ecg.completed);
  const interpretation = ecgAcquired ? matchesAny(`${closing.primaryDiagnosis} ${closing.investigations}`, ['inferior stemi', 'inferior st elevation', 'inferior st segment elevation']) : null;
  return { criteria, selectionPercent, interpretation };
}

export function buildEncounterReport({ patientCase, encounterState, interviewScore, interviewBreakdown = null, interviewDebrief = null, interviewPriorities = {}, closingInput, investigations = {}, management = [], actions = [], transcript = [], environmentReady = true }) {
  encounterState.closing = { ...encounterState.closing, ...closingInput };
  const examination = evaluateExamination(patientCase, encounterState);
  if (!environmentReady && examination.assessed && examination.missed.length) {
    examination.percent = null;
    examination.limitation = 'The 3D environment was unavailable at submission. Acquired findings are preserved; incomplete examinations are unassessed.';
  }
  const closing = evaluateClosing(patientCase, encounterState, { ...encounterState.closing, management: [encounterState.closing.management, ...management].join(' ') });
  const investigationAssessment = assessInvestigations(patientCase, encounterState, investigations, actions, encounterState.closing, environmentReady);
  closing.investigationProposalPercent = closing.investigationPercent;
  closing.investigationPercent = weightedScore([[closing.investigationProposalPercent, .4], [investigationAssessment.selectionPercent, .5], [investigationAssessment.interpretation === null ? null : investigationAssessment.interpretation ? 100 : 0, .1]]);
  closing.percent = weightedScore([[closing.summaryPercent, .5], [closing.investigationPercent, .25], [closing.managementPercent, .25]]);
  const reasoning = closing.diagnosis;
  const encounterScore = weightedScore([[Number(interviewScore || 0), .60], [examination.percent, .15], [reasoning.percent, .15], [closing.percent, .10]]) ?? 0;
  const report = {
    encounterScore,
    interviewScore: Number(interviewScore || 0),
    interviewBreakdown,
    interviewDebrief,
    interviewPriorities,
    examination,
    clinicalReasoning: reasoning,
    closing,
    investigations: { results: { ...investigations }, ...investigationAssessment, availableEcg: Boolean(patientCase.ecg?.available), acquiredEcg: Boolean(encounterState.ecg.completed && patientCase.ecg?.available) },
    management: [...management],
    safetyOmissions: investigationAssessment.criteria.filter(item => item.safety && !item.obtained).map(item => `${item.label} was not completed. This case includes an ECG relevant to time-sensitive escalation.`),
    completeRecord: { notes: { ...encounterState.notes }, closing: { ...encounterState.closing }, transcript: transcript.map(item => ({ ...item })) },
    strengths: [...examination.completed.map(label => `Completed ${label}`), ...(reasoning.primaryMatched ? ['Leading diagnosis matches the case interpretation.'] : [])],
    recommendations: [...(examination.percent === null ? [] : examination.missed.map(label => `Practise ${label.toLowerCase()} at all required anatomical sites.`)), ...(!reasoning.primaryMatched ? ['Revisit the leading diagnosis using the history and acquired findings.'] : [])],
    studentDifferentials: [...encounterState.differentials],
    notesCompleted: Object.entries(encounterState.notes).filter(([, value]) => String(value).trim()).map(([key]) => key),
    expectedDiagnosis: patientCase.expectedDiagnosisIdea || 'No case-specific expected diagnosis text is defined.'
  };
  encounterState.completed = true;
  encounterState.report = report;
  return report;
}

export function countCompletedNoteSections(encounterState) {
  return Object.values(encounterState.notes).filter((value) => String(value ?? '').trim().length > 0).length;
}

function countSignalGroups(text, groups = []) {
  const normalized = normalize(text);
  return groups.filter((aliases) => aliases.some((alias) => normalized.includes(normalize(alias)))).length;
}

function matchesAny(value, aliases = []) {
  const normalized = normalize(value);
  if (!normalized) return false;
  return aliases.some((alias) => {
    const target = normalize(alias);
    return Boolean(target) && (normalized === target || ` ${normalized} `.includes(` ${target} `));
  });
}

function weightedScore(domains) {
  const applicable = domains.filter(([value]) => Number.isFinite(value));
  const weight = applicable.reduce((sum, [, itemWeight]) => sum + itemWeight, 0);
  return weight ? Math.round(applicable.reduce((sum, [value, itemWeight]) => sum + value * itemWeight, 0) / weight) : null;
}

function normalize(value) {
  return String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}
