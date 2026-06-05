import { labelForIntent } from './categoryModel.js';

const LAB_GROUPS = [
  { id: 'fbc', label: 'Full blood count', labs: ['wbc'] },
  { id: 'inflammatory', label: 'CRP / inflammatory markers', labs: ['crp'] },
  { id: 'renal', label: 'Renal function', labs: ['creatinine'] },
  { id: 'electrolytes', label: 'Electrolytes', labs: ['potassium'] },
  { id: 'glucose', label: 'Glucose', labs: ['glucose'] },
  { id: 'thyroid', label: 'Thyroid tests', labs: ['tsh'] }
];

const MEDICATION_ACTIONS = {
  chest_pain_acs_risk: [
    'Aspirin loading dose',
    'Sublingual nitroglycerin if blood pressure allows',
    'Oxygen only if hypoxic',
    'Analgesia request'
  ],
  abdominal_pain_cholecystitis: [
    'Analgesia request',
    'Antiemetic request',
    'IV fluids request',
    'Antibiotic plan after senior review'
  ]
};

export function openModal(modal) {
  modal?.classList.add('visible');
  modal?.setAttribute('aria-hidden', 'false');
}

export function closeModal(modal) {
  modal?.classList.remove('visible');
  modal?.setAttribute('aria-hidden', 'true');
}

export function renderLabsPanel({ container, patientCase, orderedLabs, onOrder }) {
  if (!container) return;
  const availableGroups = LAB_GROUPS
    .map((group) => ({ ...group, labs: group.labs.filter((key) => patientCase.labs?.[key]) }))
    .filter((group) => group.labs.length > 0);
  container.innerHTML = `
    <p class="subtle-note">Only ordered deterministic results are revealed. These values come from the selected case data.</p>
    <div class="order-list">
      ${availableGroups.map((group) => renderLabGroup(group, patientCase, orderedLabs)).join('') || '<p>No lab results are defined for this case.</p>'}
    </div>
  `;
  container.querySelectorAll('[data-order-lab]').forEach((button) => {
    button.addEventListener('click', () => onOrder?.(button.dataset.orderLab));
  });
}

export function renderMedicationPanel({ container, patientCase, administeredActions, onAdminister }) {
  if (!container) return;
  const actions = MEDICATION_ACTIONS[patientCase.id] ?? ['Document proposed medication action'];
  container.innerHTML = `
    <p class="subtle-note">Selecting an action records it in this simulation. Physiological treatment effects are not modelled yet.</p>
    <div class="order-list">
      ${actions.map((action) => `
        <article class="order-item">
          <div>
            <strong>${escapeHtml(action)}</strong>
            <p>${administeredActions.includes(action) ? 'Recorded in this session.' : 'No automatic change to case facts or vitals.'}</p>
          </div>
          <button type="button" class="secondary" data-administer-medication="${escapeHtml(action)}" ${administeredActions.includes(action) ? 'disabled' : ''}>Record</button>
        </article>
      `).join('')}
    </div>
  `;
  container.querySelectorAll('[data-administer-medication]').forEach((button) => {
    button.addEventListener('click', () => onAdminister?.(button.dataset.administerMedication));
  });
}

function renderLabGroup(group, patientCase, orderedLabs) {
  const result = group.labs.map((key) => orderedLabs[key] ? `${labelForIntent(`lab_${key}`)}: ${orderedLabs[key]}` : '').filter(Boolean).join(' ');
  const ordered = group.labs.every((key) => orderedLabs[key]);
  return `
    <article class="order-item">
      <div>
        <strong>${escapeHtml(group.label)}</strong>
        <p>${result ? escapeHtml(result) : 'Result hidden until ordered.'}</p>
      </div>
      <button type="button" class="secondary" data-order-lab="${escapeHtml(group.id)}" ${ordered ? 'disabled' : ''}>${ordered ? 'Ordered' : 'Order'}</button>
    </article>
  `;
}

export function labsForGroup(groupId, patientCase) {
  const group = LAB_GROUPS.find((item) => item.id === groupId);
  if (!group) return {};
  return Object.fromEntries(group.labs.filter((key) => patientCase.labs?.[key]).map((key) => [key, patientCase.labs[key]]));
}

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
