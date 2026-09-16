import {
  addDifferential,
  countCompletedNoteSections,
  getExaminationActions,
  moveDifferential,
  performExamination,
  removeDifferential,
  updateClinicalNotes
} from '../clinicalEncounter.js';

export function renderExaminationPanel({ container, patientCase, encounterState, mode, onPerformed }) {
  if (!container) return;
  const actions = getExaminationActions(patientCase, encounterState);
  const groups = groupBy(actions, (item) => item.group);
  container.innerHTML = `
    <p class="subtle-note">Choose what you actually want to examine. Findings remain hidden until the action is performed.${mode === 'exam' ? '' : ' Required actions are not highlighted, so the station still makes you think.'}</p>
    <div class="exam-groups">
      ${Object.entries(groups).map(([group, items]) => `
        <section class="exam-group">
          <h3>${escapeHtml(group)}</h3>
          <div class="exam-action-list">
            ${items.map((item) => `
              <article class="exam-action ${item.performed ? 'performed' : ''}" data-required="${item.required ? 'true' : 'false'}">
                <div>
                  <strong>${escapeHtml(item.label)}</strong>
                  <p>${item.performed ? escapeHtml(item.finding) : 'Finding hidden until examined.'}</p>
                </div>
                <button type="button" class="secondary" data-perform-exam="${escapeHtml(item.id)}">${item.performed ? 'Repeat' : 'Examine'}</button>
              </article>
            `).join('')}
          </div>
        </section>
      `).join('')}
    </div>
  `;
  container.querySelectorAll('[data-perform-exam]').forEach((button) => {
    button.addEventListener('click', () => {
      const result = performExamination(patientCase, encounterState, button.dataset.performExam);
      onPerformed?.(result);
      renderExaminationPanel({ container, patientCase, encounterState, mode, onPerformed });
    });
  });
}

export function renderClinicalNotesPanel({ container, encounterState, onChange }) {
  if (!container) return;
  const fields = [
    ['history', 'History', 'Write the important history in your own words...'],
    ['examination', 'Examination', 'Record examination findings you obtained...'],
    ['investigations', 'Investigations', 'Record ordered/reviewed tests and results...'],
    ['impression', 'Impression', 'Your evolving clinical impression...']
  ];
  container.innerHTML = `
    <div class="notes-status"><strong>${countCompletedNoteSections(encounterState)}/4 sections used</strong><span>Notes are private working notes and are not shown to the patient.</span></div>
    <div class="clinical-notes-grid">
      ${fields.map(([key, label, placeholder]) => `
        <label class="clinical-note-field">
          <span>${escapeHtml(label)}</span>
          <textarea data-note-key="${key}" rows="5" placeholder="${escapeHtml(placeholder)}">${escapeHtml(encounterState.notes[key] || '')}</textarea>
        </label>
      `).join('')}
    </div>
  `;
  container.querySelectorAll('[data-note-key]').forEach((textarea) => {
    textarea.addEventListener('input', () => {
      updateClinicalNotes(encounterState, { [textarea.dataset.noteKey]: textarea.value });
      onChange?.(encounterState.notes);
    });
  });
}

export function renderDifferentialPanel({ container, encounterState, onChange }) {
  if (!container) return;
  container.innerHTML = `
    <p class="subtle-note">Maintain up to five working diagnoses. Put the diagnosis you currently consider most likely at the top. The simulator does not reveal whether you are right until the station is submitted.</p>
    <form id="differentialAddForm" class="differential-add-form">
      <input id="differentialInput" type="text" autocomplete="off" placeholder="Add a working diagnosis..." />
      <button type="submit">Add</button>
    </form>
    <p id="differentialError" class="details-error" aria-live="polite"></p>
    <div class="differential-board">
      ${encounterState.differentials.length ? encounterState.differentials.map((diagnosis, index) => `
        <article class="differential-row">
          <span class="differential-rank">${index + 1}</span>
          <strong>${escapeHtml(diagnosis)}</strong>
          <div class="differential-actions">
            <button type="button" class="secondary compact" data-move-diff="${index}" data-direction="-1" ${index === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
            <button type="button" class="secondary compact" data-move-diff="${index}" data-direction="1" ${index === encounterState.differentials.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
            <button type="button" class="secondary compact danger-text" data-remove-diff="${index}" aria-label="Remove">Remove</button>
          </div>
        </article>
      `).join('') : '<div class="empty-board">No working diagnoses yet.</div>'}
    </div>
  `;
  const form = container.querySelector('#differentialAddForm');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = container.querySelector('#differentialInput');
    const result = addDifferential(encounterState, input?.value);
    if (!result.ok) {
      const error = container.querySelector('#differentialError');
      if (error) error.textContent = result.reason;
      return;
    }
    onChange?.(encounterState.differentials);
    renderDifferentialPanel({ container, encounterState, onChange });
  });
  container.querySelectorAll('[data-remove-diff]').forEach((button) => button.addEventListener('click', () => {
    removeDifferential(encounterState, Number(button.dataset.removeDiff));
    onChange?.(encounterState.differentials);
    renderDifferentialPanel({ container, encounterState, onChange });
  }));
  container.querySelectorAll('[data-move-diff]').forEach((button) => button.addEventListener('click', () => {
    moveDifferential(encounterState, Number(button.dataset.moveDiff), Number(button.dataset.direction));
    onChange?.(encounterState.differentials);
    renderDifferentialPanel({ container, encounterState, onChange });
  }));
}

export function renderClosingForm({ container, encounterState, onSubmit, mode }) {
  if (!container) return;
  const closing = encounterState.closing;
  container.innerHTML = `
    <div class="closing-intro">
      <strong>Close the station as if you were handing the patient over.</strong>
      <p>${mode === 'exam' ? 'No marking hints are shown before submission.' : 'Give a concise presentation, commit to a leading diagnosis, and state what you would do next.'}</p>
    </div>
    <form id="closingForm" class="closing-form">
      <label>
        <span>1. Concise case presentation</span>
        <textarea name="presentation" rows="6" required placeholder="Present the patient to a supervising physician...">${escapeHtml(closing.presentation || '')}</textarea>
      </label>
      <label>
        <span>2. Most likely diagnosis</span>
        <input name="primaryDiagnosis" type="text" required value="${escapeHtml(closing.primaryDiagnosis || '')}" placeholder="Your leading diagnosis..." />
      </label>
      <section class="closing-board-preview">
        <span>3. Working differential board</span>
        ${encounterState.differentials.length ? `<ol>${encounterState.differentials.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol>` : '<p>No differentials have been added yet. You can return and add them before submitting.</p>'}
      </section>
      <label>
        <span>4. Investigations / next steps</span>
        <textarea name="investigations" rows="4" required placeholder="What tests or immediate diagnostic steps would you request?">${escapeHtml(closing.investigations || '')}</textarea>
      </label>
      <label>
        <span>5. Immediate management / safety</span>
        <textarea name="management" rows="4" required placeholder="What treatment, monitoring or escalation is needed now?">${escapeHtml(closing.management || '')}</textarea>
      </label>
      <div class="closing-submit-row">
        <span>Submitting ends this attempt and reveals the case-specific feedback.</span>
        <button type="submit">Submit station</button>
      </div>
    </form>
  `;
  container.querySelector('#closingForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSubmit?.({
      presentation: String(data.get('presentation') || '').trim(),
      primaryDiagnosis: String(data.get('primaryDiagnosis') || '').trim(),
      investigations: String(data.get('investigations') || '').trim(),
      management: String(data.get('management') || '').trim()
    });
  });
}

export function renderEncounterReport({ container, report, onContribute }) {
  if (!container || !report) return;
  container.innerHTML = `
    <section class="encounter-report">
      <div class="encounter-score-hero">
        <span>Clinical encounter score</span>
        <strong>${Math.round(report.encounterScore)}%</strong>
      </div>
      <div class="encounter-score-grid">
        ${scoreTile('Interview', report.interviewScore)}
        ${scoreTile('Examination', report.examination.percent)}
        ${scoreTile('Clinical reasoning', report.clinicalReasoning.percent)}
        ${scoreTile('Closing / presentation', report.closing.percent)}
      </div>
      ${renderInterviewDebrief(report.interviewDebrief, report.interviewBreakdown)}
      <section class="report-section">
        <h3>Physical examination</h3>
        <p>${report.examination.missed.length ? `<strong>Missed required actions:</strong> ${escapeHtml(report.examination.missed.join(', '))}` : 'All required examination actions were performed.'}</p>
      </section>
      <section class="report-section">
        <h3>Clinical reasoning</h3>
        <p><strong>Leading diagnosis matched:</strong> ${report.clinicalReasoning.primaryMatched ? 'Yes' : 'No'}</p>
        <p><strong>Reasonable alternatives recognised:</strong> ${report.clinicalReasoning.acceptedAlternatives.length ? escapeHtml(report.clinicalReasoning.acceptedAlternatives.join(', ')) : 'None recognised by the local rubric.'}</p>
      </section>
      <section class="report-section">
        <h3>Expected case interpretation</h3>
        <p>${escapeHtml(report.expectedDiagnosis)}</p>
      </section>
      <section class="report-section compact-report-grid">
        <p><strong>Presentation:</strong> ${report.closing.summaryPercent}%</p>
        <p><strong>Investigations:</strong> ${report.closing.investigationPercent}%</p>
        <p><strong>Management / safety:</strong> ${report.closing.managementPercent}%</p>
      </section>
      <div class="report-actions">
        <button id="contributeEncounterBtn" type="button" class="secondary">Prepare anonymous contribution</button>
      </div>
    </section>
  `;
  container.querySelector('#contributeEncounterBtn')?.addEventListener('click', () => onContribute?.());
}

function renderInterviewDebrief(debrief, breakdown) {
  if (!debrief && !breakdown) return '';
  const score = breakdown || debrief?.scoreBreakdown || {};
  const criticalMisses = debrief?.criticalSafetyMisses ?? [];
  const caseCriticalMisses = debrief?.missedCaseCritical ?? [];
  const resolutionIssues = (debrief?.resolutionIssues ?? []).filter((item) => !item.laterResolved || item.engineIntentIds?.length);
  const communicationIssues = debrief?.communication?.issues ?? [];
  return `
    <section class="report-section interview-debrief-section">
      <h3>Interview debrief</h3>
      <p class="report-muted">The interview score is based on what you clinically attempted. Simulator recognition failures are listed separately and are not treated as missed questions.</p>
      <div class="encounter-score-grid compact-score-grid">
        ${scoreTile('Essential history', score.essential ?? 0)}
        ${scoreTile('Case-critical', score.caseCritical ?? 0)}
        ${scoreTile('Comprehensive breadth', score.comprehensive ?? 0)}
        ${scoreTile('Communication', score.communication ?? 100)}
      </div>
      <div class="debrief-columns">
        <div>
          <h4>Important omissions</h4>
          ${criticalMisses.length
            ? `<ul>${criticalMisses.map((intent) => `<li>${escapeHtml(humanizeIntent(intent))}</li>`).join('')}</ul>`
            : '<p>No critical safety-history omissions detected.</p>'}
          ${caseCriticalMisses.length
            ? `<p><strong>Case-critical areas still missing:</strong> ${escapeHtml(caseCriticalMisses.map(humanizeIntent).join(', '))}</p>`
            : '<p>Case-critical interview areas were covered.</p>'}
        </div>
        <div>
          <h4>Simulator recognition</h4>
          ${resolutionIssues.length
            ? `<ul>${resolutionIssues.slice(0, 8).map((issue) => `<li><strong>${escapeHtml(issue.label || humanizeIntent(issue.intentId))}:</strong> “${escapeHtml(issue.question)}”${issue.laterResolved ? ' <small>(later resolved)</small>' : ''}</li>`).join('')}</ul>`
            : '<p>No unresolved student attempts were detected.</p>'}
        </div>
      </div>
      ${communicationIssues.length
        ? `<div class="communication-feedback"><h4>Communication</h4><ul>${communicationIssues.slice(0, 6).map((issue) => `<li>${escapeHtml(issue.message)} <small>Turn ${issue.turnNumber}</small></li>`).join('')}</ul></div>`
        : '<p><strong>Communication:</strong> No major phrasing issues detected.</p>'}
    </section>
  `;
}

function humanizeIntent(value) {
  return String(value ?? '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function scoreTile(label, value) {
  return `<article class="encounter-score-tile"><strong>${Math.round(Number(value || 0))}%</strong><span>${escapeHtml(label)}</span></article>`;
}

function groupBy(items, fn) {
  return items.reduce((groups, item) => {
    const key = fn(item);
    (groups[key] ||= []).push(item);
    return groups;
  }, {});
}

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
