const LAB_LABELS = {
  hsTroponinT: 'High-sensitivity troponin T',
  wbc: 'WBC',
  hemoglobin: 'Haemoglobin',
  platelets: 'Platelets',
  crp: 'CRP',
  creatinine: 'Creatinine',
  egfr: 'eGFR',
  sodium: 'Sodium',
  potassium: 'Potassium',
  magnesium: 'Magnesium',
  glucose: 'Glucose',
  inr: 'INR',
  aptt: 'aPTT',
  ldl: 'LDL cholesterol',
  tsh: 'TSH'
};

const LAB_GROUPS = [
  { id: 'cardiac_biomarkers', label: 'Cardiac biomarkers', description: 'Myocardial injury', labs: ['hsTroponinT'] },
  { id: 'fbc', label: 'Full blood count', description: 'Anaemia, platelets, leukocytes', labs: ['hemoglobin', 'wbc', 'platelets'] },
  { id: 'renal_electrolytes', label: 'Renal function & electrolytes', description: 'Renal function and arrhythmia-relevant electrolytes', labs: ['creatinine', 'egfr', 'sodium', 'potassium', 'magnesium'] },
  { id: 'coagulation', label: 'Coagulation', description: 'Baseline haemostasis', labs: ['inr', 'aptt'] },
  { id: 'glucose', label: 'Glucose', description: 'Current glucose', labs: ['glucose'] },
  { id: 'inflammatory', label: 'Inflammatory markers', description: 'Inflammatory context', labs: ['crp'] },
  { id: 'lipids', label: 'Lipid profile', description: 'Cardiovascular risk profile', labs: ['ldl'] },
  { id: 'thyroid', label: 'Thyroid tests', description: 'Thyroid function', labs: ['tsh'] }
];

const MEDICATION_ACTIONS = {
  chest_pain_acs_risk: [
    { label: 'Give an aspirin loading dose', category: 'Antiplatelet' },
    { label: 'Place the patient on continuous cardiac monitoring and obtain IV access', category: 'Immediate care' },
    { label: 'Activate urgent cardiology / STEMI pathway for reperfusion assessment', category: 'Escalation' },
    { label: 'Plan anticoagulation according to the local ACS / PCI pathway', category: 'Antithrombotic' },
    { label: 'Consider sublingual nitrate only after checking blood pressure and contraindications', category: 'Symptom control' },
    { label: 'Give supplemental oxygen only if hypoxaemia develops', category: 'Supportive care' }
  ],
  abdominal_pain_cholecystitis: [
    { label: 'Provide appropriate analgesia', category: 'Symptom control' },
    { label: 'Provide an antiemetic', category: 'Symptom control' },
    { label: 'Establish IV access and give fluids if clinically indicated', category: 'Supportive care' },
    { label: 'Request senior / surgical review', category: 'Escalation' }
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
    <div class="order-list laboratory-order-list">
      ${availableGroups.map((group) => renderLabGroup(group, patientCase, orderedLabs)).join('') || '<p>No laboratory results are defined for this case.</p>'}
    </div>
  `;
  container.querySelectorAll('[data-order-lab]').forEach((button) => {
    button.addEventListener('click', () => onOrder?.(button.dataset.orderLab));
  });
}

export function renderMedicationPanel({ container, patientCase, administeredActions, onAdminister, mode = 'practice' }) {
  if (!container) return;
  const actions = MEDICATION_ACTIONS[patientCase.id] ?? [{ label: 'Document proposed management action', category: 'Management' }];
  if (mode === 'exam') {
    container.innerHTML = `
      <p class="subtle-note management-disclaimer">Exam mode does not reveal suggested actions. Record what you would actually do. Physiological effects are not simulated in Phase 1.</p>
      <form id="examManagementForm" class="exam-management-form">
        <input id="examManagementInput" type="text" autocomplete="off" placeholder="e.g. monitoring, medication, escalation, procedure..." />
        <button type="submit">Record action</button>
      </form>
      <div class="recorded-management-list">${administeredActions.length ? administeredActions.map((action) => `<span>${escapeHtml(action)}</span>`).join('') : '<small>No management actions recorded yet.</small>'}</div>
    `;
    container.querySelector('#examManagementForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = container.querySelector('#examManagementInput');
      const value = String(input?.value || '').trim();
      if (!value) return;
      onAdminister?.(value);
    });
    return;
  }
  container.innerHTML = `
    <p class="subtle-note management-disclaimer">Practice/Teaching mode offers structured actions. Physiological treatment effects are intentionally not simulated yet.</p>
    <div class="management-action-list">
      ${actions.map(({ label, category }) => {
        const recorded = administeredActions.includes(label);
        return `
          <article class="management-action ${recorded ? 'recorded' : ''}">
            <div><span class="management-category">${escapeHtml(category)}</span><strong>${escapeHtml(label)}</strong><small>${recorded ? 'Recorded in this attempt.' : 'Select only if it matches your clinical plan.'}</small></div>
            <button type="button" class="secondary compact" data-administer-medication="${escapeHtml(label)}" ${recorded ? 'disabled' : ''}>${recorded ? 'Recorded' : 'Record'}</button>
          </article>
        `;
      }).join('')}
    </div>
  `;
  container.querySelectorAll('[data-administer-medication]').forEach((button) => {
    button.addEventListener('click', () => onAdminister?.(button.dataset.administerMedication));
  });
}

function renderLabGroup(group, patientCase, orderedLabs) {
  const rows = group.labs.map((key) => {
    const value = orderedLabs[key];
    return value ? `<div class="lab-result-row"><span>${escapeHtml(LAB_LABELS[key] || key)}</span><strong>${escapeHtml(value)}</strong></div>` : '';
  }).filter(Boolean).join('');
  const ordered = group.labs.every((key) => orderedLabs[key]);
  return `
    <article class="lab-order-card ${ordered ? 'ordered' : ''}">
      <div class="lab-order-heading">
        <div><strong>${escapeHtml(group.label)}</strong><small>${escapeHtml(group.description || '')}</small></div>
        <button type="button" class="secondary compact" data-order-lab="${escapeHtml(group.id)}" ${ordered ? 'disabled' : ''}>${ordered ? 'Result available' : 'Order'}</button>
      </div>
      <div class="lab-result-block">${rows || '<span class="hidden-result">Result hidden until ordered.</span>'}</div>
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
