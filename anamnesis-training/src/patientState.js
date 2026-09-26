const DEFAULT_EQUIPMENT = Object.freeze({
  monitor: false,
  telemetry: false,
  ecg12: false,
  bpCuff: false,
  spo2Probe: false,
  oxygen: false,
  ivAccess: false,
  infusion: false
});

const DEFAULT_VISUAL = Object.freeze({
  sweating: 0,
  pallor: 0,
  position: 'standing',
  consciousness: 'alert'
});

const DEFAULT_SYMPTOMS = Object.freeze({
  pain: 0,
  distress: 0.15,
  dyspnea: 0,
  nausea: 0
});

export class PatientStateEngine {
  constructor(patientCase) {
    this.patientCase = patientCase || {};
    this.listeners = new Set();
    this.state = buildInitialState(this.patientCase);
  }

  getSnapshot() {
    return cloneState(this.state);
  }

  restoreSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return this.getSnapshot();
    const base = buildInitialState(this.patientCase);
    this.state = {
      ...base,
      ...snapshot,
      caseId: this.patientCase?.id || String(snapshot.caseId || ''),
      physiology: { ...base.physiology, ...(snapshot.physiology || {}) },
      symptoms: { ...base.symptoms, ...(snapshot.symptoms || {}) },
      visual: { ...base.visual, ...(snapshot.visual || {}) },
      equipment: { ...base.equipment, ...(snapshot.equipment || {}) },
      interventions: Array.isArray(snapshot.interventions) ? snapshot.interventions.map((item) => ({ ...item })) : [],
      revision: Math.max(0, Number(snapshot.revision || 0)),
      lastEvent: snapshot.lastEvent ? { ...snapshot.lastEvent } : null
    };
    this.emit({ type: 'restore' });
    return this.getSnapshot();
  }

  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    listener(this.getSnapshot(), { type: 'initial' });
    return () => this.listeners.delete(listener);
  }

  reset(patientCase = this.patientCase) {
    this.patientCase = patientCase || {};
    this.state = buildInitialState(this.patientCase);
    this.emit({ type: 'reset' });
    return this.getSnapshot();
  }

  connectEquipment(kind, enabled = true, reason = '') {
    const patch = equipmentPatchFor(kind, enabled);
    if (!Object.keys(patch).length) return { matched: false, message: '' };
    this.state.equipment = { ...this.state.equipment, ...patch };
    this.state.revision += 1;
    this.state.lastEvent = {
      type: 'equipment',
      kind,
      enabled,
      reason,
      at: new Date().toISOString()
    };
    this.emit(this.state.lastEvent);
    return { matched: true, message: equipmentMessage(kind, enabled), snapshot: this.getSnapshot() };
  }

  recordEcgAcquired() {
    return this.connectEquipment('ecg12', true, '12-lead ECG acquired');
  }

  recordExamination(examinationId, finding = '') {
    const lower = String(finding || '').toLowerCase();
    const reaction = /tender|pain|painful|guarding|distress|uncomfortable/.test(lower)
      ? 'discomfort'
      : /short of breath|dyspno|tachypno/.test(lower)
        ? 'breathlessness'
        : 'cooperative';
    this.state.lastEvent = {
      type: 'examination',
      examinationId,
      reaction,
      at: new Date().toISOString()
    };
    this.emit(this.state.lastEvent);
    return { matched: true, reaction, snapshot: this.getSnapshot() };
  }

  applyClinicalAction(actionLabel) {
    const action = String(actionLabel || '').trim();
    if (!action) return { matched: false, message: '' };
    const lower = action.toLowerCase();
    const effects = this.patientCase?.simulation?.actionEffects || [];
    const effect = effects.find((candidate) => matchesEffect(candidate, lower));

    if (!effect) {
      this.state.lastEvent = { type: 'clinical-action', action, effectId: '', matched: false, at: new Date().toISOString() };
      this.emit(this.state.lastEvent);
      return { matched: false, message: 'Action recorded. No case-specific physiological response is defined.', snapshot: this.getSnapshot() };
    }

    applyEffect(this.state, effect);
    this.state.revision += 1;
    this.state.interventions.push({
      id: effect.id || slugify(action),
      label: action,
      at: new Date().toISOString()
    });
    this.state.lastEvent = {
      type: 'clinical-action',
      action,
      effectId: effect.id || '',
      matched: true,
      message: effect.message || '',
      at: new Date().toISOString()
    };
    this.emit(this.state.lastEvent);
    return { matched: true, effectId: effect.id || '', message: effect.message || '', snapshot: this.getSnapshot() };
  }

  applyPatch(patch = {}, reason = 'manual') {
    if (!patch || typeof patch !== 'object') return this.getSnapshot();
    if (patch.physiology) this.state.physiology = { ...this.state.physiology, ...sanitizePhysiology(patch.physiology) };
    if (patch.symptoms) this.state.symptoms = { ...this.state.symptoms, ...sanitizeUnitRangePatch(patch.symptoms, ['pain'], { pain: [0, 10] }) };
    if (patch.visual) this.state.visual = { ...this.state.visual, ...sanitizeUnitRangePatch(patch.visual) };
    if (patch.equipment) this.state.equipment = { ...this.state.equipment, ...patch.equipment };
    this.state.revision += 1;
    this.state.lastEvent = { type: 'patch', reason, at: new Date().toISOString() };
    this.emit(this.state.lastEvent);
    return this.getSnapshot();
  }

  emit(event) {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => {
      try { listener(snapshot, event); } catch (error) { console.error('patient-state-listener-error', error); }
    });
  }
}

export function buildInitialState(patientCase) {
  const baselineVitals = extractVitals(patientCase);
  const initial = patientCase?.simulation?.initialState || {};
  const symptoms = {
    ...DEFAULT_SYMPTOMS,
    ...(initial.symptoms || {})
  };
  symptoms.pain = clamp(Number(symptoms.pain || 0), 0, 10);
  symptoms.distress = clamp(Number(symptoms.distress || 0), 0, 1);
  symptoms.dyspnea = clamp(Number(symptoms.dyspnea || 0), 0, 1);
  symptoms.nausea = clamp(Number(symptoms.nausea || 0), 0, 1);

  const visual = {
    ...DEFAULT_VISUAL,
    ...(initial.visual || {})
  };
  visual.sweating = clamp(Number(visual.sweating || 0), 0, 1);
  visual.pallor = clamp(Number(visual.pallor || 0), 0, 1);

  return {
    caseId: patientCase?.id || '',
    physiology: { ...baselineVitals, ...(initial.physiology || {}) },
    symptoms,
    visual,
    equipment: { ...DEFAULT_EQUIPMENT, ...(initial.equipment || {}) },
    interventions: [],
    revision: 0,
    lastEvent: null
  };
}

export function derivePatientPresentation(snapshot) {
  const s = snapshot || {};
  const physiology = s.physiology || {};
  const symptoms = s.symptoms || {};
  const visual = s.visual || {};
  const descriptors = [];

  const consciousness = String(visual.consciousness || 'alert');
  descriptors.push(consciousness === 'alert' ? 'Alert' : consciousness === 'drowsy' ? 'Drowsy' : 'Reduced consciousness');

  if (symptoms.distress >= 0.72 || symptoms.pain >= 7) descriptors.push('Marked distress');
  else if (symptoms.distress >= 0.42 || symptoms.pain >= 4) descriptors.push('Moderate distress');
  else descriptors.push('Relatively comfortable');

  if (Number(physiology.rr) >= 24 || symptoms.dyspnea >= 0.6) descriptors.push('Tachypnoeic');
  if (visual.sweating >= 0.55) descriptors.push('Clammy');
  if (visual.pallor >= 0.45) descriptors.push('Pale');

  return descriptors;
}

export function extractVitals(patientCase) {
  const vitals = patientCase?.vitals || {};
  const text = Object.values(vitals).join(' ');
  const bpMatch = String(vitals.bp || text).match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
  return {
    hr: firstNumber(vitals.hr, 82),
    rr: firstNumber(vitals.rr, 16),
    spo2: firstNumber(vitals.spo2, 98),
    temp: firstNumber(vitals.temperature, 36.8),
    sbp: bpMatch ? Number(bpMatch[1]) : 125,
    dbp: bpMatch ? Number(bpMatch[2]) : 80
  };
}

function matchesEffect(effect, lowerAction) {
  const terms = Array.isArray(effect?.match) ? effect.match : [effect?.match].filter(Boolean);
  return terms.some((term) => lowerAction.includes(String(term).toLowerCase()));
}

function applyEffect(state, effect) {
  if (effect.equipment) state.equipment = { ...state.equipment, ...effect.equipment };
  if (effect.physiologySet) state.physiology = { ...state.physiology, ...sanitizePhysiology(effect.physiologySet) };
  if (effect.physiologyDelta) {
    Object.entries(effect.physiologyDelta).forEach(([key, delta]) => {
      const current = Number(state.physiology[key] || 0);
      state.physiology[key] = clampPhysiology(key, current + Number(delta || 0));
    });
  }
  if (effect.symptomSet) state.symptoms = { ...state.symptoms, ...effect.symptomSet };
  if (effect.symptomDelta) {
    Object.entries(effect.symptomDelta).forEach(([key, delta]) => {
      const max = key === 'pain' ? 10 : 1;
      state.symptoms[key] = clamp(Number(state.symptoms[key] || 0) + Number(delta || 0), 0, max);
    });
  }
  if (effect.visualSet) state.visual = { ...state.visual, ...effect.visualSet };
  if (effect.visualDelta) {
    Object.entries(effect.visualDelta).forEach(([key, delta]) => {
      if (typeof state.visual[key] === 'number') state.visual[key] = clamp(Number(state.visual[key]) + Number(delta || 0), 0, 1);
    });
  }
  if (effect.id === 'oxygen' && state.physiology.spo2 < 94) state.physiology.spo2 = clamp(state.physiology.spo2 + 3, 70, 100);
}

function equipmentPatchFor(kind, enabled) {
  const value = Boolean(enabled);
  const key = String(kind || '').toLowerCase();
  if (key === 'monitor') return { monitor: value, telemetry: value, bpCuff: value, spo2Probe: value };
  if (key === 'ecg12' || key === 'ecg') return { ecg12: value };
  if (key === 'oxygen') return { oxygen: value };
  if (key === 'iv' || key === 'ivaccess') return { ivAccess: value };
  if (key === 'infusion') return { ivAccess: value, infusion: value };
  if (Object.prototype.hasOwnProperty.call(DEFAULT_EQUIPMENT, key)) return { [key]: value };
  return {};
}

function equipmentMessage(kind, enabled) {
  const label = String(kind || '').replace(/([A-Z])/g, ' $1').replace(/^./, (m) => m.toUpperCase());
  return `${label} ${enabled ? 'connected' : 'removed'}.`;
}

function sanitizePhysiology(values) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, clampPhysiology(key, Number(value))]));
}

function sanitizeUnitRangePatch(values, keys = [], ranges = {}) {
  const result = { ...values };
  Object.entries(values || {}).forEach(([key, value]) => {
    if (typeof value !== 'number') return;
    const range = ranges[key] || (keys.includes(key) ? [0, 10] : [0, 1]);
    result[key] = clamp(value, range[0], range[1]);
  });
  return result;
}

function clampPhysiology(key, value) {
  const ranges = {
    hr: [25, 220], rr: [0, 60], spo2: [50, 100], temp: [30, 43], sbp: [40, 260], dbp: [20, 160]
  };
  const [min, max] = ranges[key] || [-Infinity, Infinity];
  return clamp(value, min, max);
}

function cloneState(state) {
  return {
    ...state,
    physiology: { ...state.physiology },
    symptoms: { ...state.symptoms },
    visual: { ...state.visual },
    equipment: { ...state.equipment },
    interventions: state.interventions.map((item) => ({ ...item })),
    lastEvent: state.lastEvent ? { ...state.lastEvent } : null
  };
}

function firstNumber(value, fallback) {
  const match = String(value || '').match(/\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(',', '.')) : fallback;
}

function slugify(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
