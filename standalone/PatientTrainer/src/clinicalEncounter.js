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
    primary: ['acute coronary syndrome', 'acs', 'myocardial infarction', 'heart attack', 'unstable angina', 'nstemi', 'stemi'],
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
    examInteractions: [],
    physicalExamUi: { tool: 'inspect', view: 'front', selectedHotspot: null, lastTechnique: null },
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
    primary: [], differentials: [], summarySignals: [], investigationSignals: [], managementSignals: []
  };
}

export function getExaminationActions(patientCase, encounterState) {
  const profile = getEncounterProfile(patientCase);
  return profile.examinations
    .filter((exam) => Boolean(getByPath(patientCase, exam.findingPath)))
    .map((exam) => ({ ...exam, performed: encounterState.examined.includes(exam.id), finding: encounterState.examFindings[exam.id] || '' }));
}

export function performExamination(patientCase, encounterState, examinationId) {
  const action = getEncounterProfile(patientCase).examinations.find((item) => item.id === examinationId);
  if (!action) return { ok: false, reason: 'Unknown examination action.' };
  const finding = String(getByPath(patientCase, action.findingPath) ?? '').trim();
  if (!finding) return { ok: false, reason: 'No deterministic finding is defined for this examination in the selected case.' };
  if (!encounterState.examined.includes(action.id)) encounterState.examined.push(action.id);
  encounterState.examFindings[action.id] = finding;
  return { ok: true, action, finding };
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
  const required = getEncounterProfile(patientCase).examinations
    .filter((item) => item.required && Boolean(getByPath(patientCase, item.findingPath)));
  const completed = required.filter((item) => encounterState.examined.includes(item.id));
  return {
    percent: required.length ? Math.round((completed.length / required.length) * 100) : 100,
    required: required.map((item) => item.label),
    completed: completed.map((item) => item.label),
    missed: required.filter((item) => !encounterState.examined.includes(item.id)).map((item) => item.label)
  };
}

export function evaluateDifferential(patientCase, encounterState, primaryDiagnosis = '') {
  const profile = getEncounterProfile(patientCase);
  const primaryMatch = matchesAny(primaryDiagnosis, profile.primary);
  const board = encounterState.differentials;
  const boardPrimaryIndex = board.findIndex((item) => matchesAny(item, profile.primary));
  const acceptedAlternatives = board.filter((item) => profile.differentials.some((aliases) => matchesAny(item, aliases)));
  const alternativesScore = Math.min(30, acceptedAlternatives.length * 15);
  const rankingBonus = boardPrimaryIndex === 0 ? 10 : boardPrimaryIndex > 0 && boardPrimaryIndex < 3 ? 5 : 0;
  const percent = Math.min(100, (primaryMatch ? 60 : 0) + alternativesScore + rankingBonus);
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
  const summaryPercent = profile.summarySignals.length ? Math.round((summaryHits / profile.summarySignals.length) * 100) : (presentation.trim().length >= 80 ? 100 : 0);
  const investigationPercent = profile.investigationSignals.length ? Math.min(100, Math.round((investigationHits / Math.min(2, profile.investigationSignals.length)) * 100)) : 100;
  const managementPercent = profile.managementSignals.length ? Math.min(100, Math.round((managementHits / Math.min(2, profile.managementSignals.length)) * 100)) : 100;
  const percent = Math.round((summaryPercent * .50) + (investigationPercent * .25) + (managementPercent * .25));

  return { percent, summaryPercent, investigationPercent, managementPercent, diagnosis };
}

export function buildEncounterReport({ patientCase, encounterState, interviewScore, closingInput }) {
  encounterState.closing = { ...encounterState.closing, ...closingInput };
  const examination = evaluateExamination(patientCase, encounterState);
  const closing = evaluateClosing(patientCase, encounterState, encounterState.closing);
  const reasoning = closing.diagnosis;
  const encounterScore = Math.round((Number(interviewScore || 0) * .60) + (examination.percent * .15) + (reasoning.percent * .15) + (closing.percent * .10));
  const report = {
    encounterScore,
    interviewScore: Number(interviewScore || 0),
    examination,
    clinicalReasoning: reasoning,
    closing,
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
    return normalized === target || normalized.includes(target) || target.includes(normalized);
  });
}

function getByPath(object, path) {
  return String(path ?? '').split('.').reduce((current, key) => current?.[key], object);
}

function normalize(value) {
  return String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}
