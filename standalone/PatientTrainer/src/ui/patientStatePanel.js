import { derivePatientPresentation } from '../patientState.js';

const EQUIPMENT_LABELS = {
  monitor: ['MON', 'Monitor'],
  ecg12: ['ECG', '12-lead ECG'],
  oxygen: ['O₂', 'Oxygen'],
  ivAccess: ['IV', 'IV access'],
  infusion: ['↧', 'Infusion']
};

export function renderPatientStatePanel({ statusContainer, equipmentContainer, snapshot, mode = 'practice' }) {
  if (!snapshot) return;
  if (statusContainer) {
    const descriptors = derivePatientPresentation(snapshot);
    statusContainer.innerHTML = mode === 'exam'
      ? '<span class="patient-scene-caption">Observe the patient directly</span>'
      : `<span class="patient-scene-caption">${escapeHtml(descriptors.join(' · '))}</span>`;
  }

  if (equipmentContainer) {
    const chips = Object.entries(EQUIPMENT_LABELS)
      .filter(([key]) => Boolean(snapshot.equipment?.[key]))
      .map(([key, [symbol, label]]) => `<span class="equipment-chip" data-equipment="${key}" title="${escapeHtml(label)}"><b>${symbol}</b>${escapeHtml(label)}</span>`);
    equipmentContainer.innerHTML = chips.length
      ? chips.join('')
      : '<span class="equipment-empty">No bedside equipment attached</span>';
  }
}

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
