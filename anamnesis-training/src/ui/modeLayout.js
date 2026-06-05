import { getChecklistItemsByCategory, getKnownFactsByCategory, getQuestionVariantsByCategory } from './categoryModel.js';

export function renderModeLayout({ container, mode, engine, patientCase, orderedLabs, onQuestionSelected }) {
  if (!container || !engine) return;
  const sectionIds = getModeSectionIds(mode);
  const activeSection = sectionIds.includes(container.dataset.activeModeCard)
    ? container.dataset.activeModeCard
    : sectionIds[0];
  container.dataset.activeModeCard = activeSection;
  container.innerHTML = sectionIds.map((sectionId) => renderModeCard({
    id: sectionId,
    title: getModeSectionTitle(sectionId),
    content: renderModeSectionContent(sectionId, engine, patientCase, orderedLabs),
    active: sectionId === activeSection
  })).join('');
  bindModeCards(container);
  bindCollapsibles(container);
  container.querySelectorAll('[data-question-variant]').forEach((button) => {
    button.addEventListener('click', () => onQuestionSelected?.(button.dataset.questionVariant ?? ''));
  });
}

export function getModeSectionIds(mode) {
  if (mode === 'teaching') return ['checklist', 'questions', 'summary'];
  if (mode === 'practice') return ['checklist', 'summary'];
  return ['summary'];
}

export function getModeSectionTitle(sectionId) {
  const titles = {
    checklist: 'Checklist',
    questions: 'Predetermined Questions',
    summary: 'Summary'
  };
  return titles[sectionId] ?? 'Summary';
}

export function renderChecklist(engine, patientCase) {
  return `
    <section class="mode-section" id="checklistSection">
      <h2>Checklist</h2>
      ${renderChecklistContent(engine, patientCase)}
    </section>
  `;
}

export function renderQuestionLibrary(engine, patientCase) {
  return `
    <section class="mode-section" id="questionLibrarySection">
      <h2>Predetermined Questions</h2>
      ${renderQuestionLibraryContent(engine, patientCase)}
    </section>
  `;
}

export function renderKnownSummary(engine, patientCase, orderedLabs = {}) {
  return `
    <section class="mode-section" id="knownSummarySection">
      <h2>Summary</h2>
      ${renderKnownSummaryContent(engine, patientCase, orderedLabs)}
    </section>
  `;
}

function renderModeSectionContent(sectionId, engine, patientCase, orderedLabs) {
  if (sectionId === 'checklist') return renderChecklistContent(engine, patientCase);
  if (sectionId === 'questions') return renderQuestionLibraryContent(engine, patientCase);
  return renderKnownSummaryContent(engine, patientCase, orderedLabs);
}

function renderModeCard({ id, title, content, active }) {
  const panelId = `mode-card-panel-${id}`;
  return `
    <article class="mode-card ${active ? 'active' : ''}" data-mode-card="${escapeHtml(id)}">
      <button type="button" class="mode-card-trigger" aria-expanded="${active ? 'true' : 'false'}" aria-controls="${panelId}" data-mode-card-trigger="${escapeHtml(id)}">
        <span>${escapeHtml(title)}</span>
        <strong>${active ? 'Open' : 'View'}</strong>
      </button>
      <div id="${panelId}" class="mode-card-body" ${active ? '' : 'hidden'}>
        ${content}
      </div>
    </article>
  `;
}

function renderChecklistContent(engine, patientCase) {
  const groups = getChecklistItemsByCategory(engine, patientCase);
  return `<div class="section-stack">${groups.map(renderChecklistGroup).join('')}</div>`;
}

function renderQuestionLibraryContent(engine, patientCase) {
  const groups = getQuestionVariantsByCategory(patientCase, engine);
  return `<div class="section-stack">${groups.map(renderQuestionGroup).join('')}</div>`;
}

function renderKnownSummaryContent(engine, patientCase, orderedLabs = {}) {
  const groups = getKnownFactsByCategory(engine, patientCase, orderedLabs);
  return groups.length
    ? `<div class="known-summary">${groups.map(renderSummaryGroup).join('')}</div>`
    : '<p class="empty-panel-note">No patient facts discovered yet.</p>';
}

function renderChecklistGroup(group) {
  const complete = group.percent === 100;
  const panelId = `checklist-${group.id}`;
  return `
    <article class="collapsible-card ${complete ? 'complete' : 'incomplete'}">
      <button type="button" class="collapsible-trigger" aria-expanded="false" aria-controls="${panelId}">
        <span>${escapeHtml(group.title)}</span>
        <strong>${group.asked}/${group.total}</strong>
        <span class="status-pill ${complete ? 'ok' : 'missing'}">${complete ? 'Complete' : `${group.percent}%`}</span>
      </button>
      <div class="progress" aria-hidden="true"><div style="width:${group.percent}%"></div></div>
      <div id="${panelId}" class="collapsible-body" hidden>
        <ul class="checklist-items">
          ${group.items.map(renderChecklistItem).join('')}
        </ul>
      </div>
    </article>
  `;
}

function renderChecklistItem(item) {
  const meta = {
    complete: ['✓', 'Complete'],
    notAsked: ['✕', 'Not asked'],
    attempted: ['!', 'Attempted incomplete'],
    notApplicable: ['-', 'Not applicable']
  }[item.status] ?? ['-', 'Not applicable'];
  return `<li class="checklist-row ${item.status}"><span class="status-icon" aria-label="${meta[1]}">${meta[0]}</span><span>${escapeHtml(item.label)}</span><small>${meta[1]}</small></li>`;
}

function renderQuestionGroup(group) {
  const panelId = `questions-${group.id}`;
  return `
    <article class="collapsible-card">
      <button type="button" class="collapsible-trigger" aria-expanded="false" aria-controls="${panelId}">
        <span>${escapeHtml(group.title)}</span>
        <strong>${group.intents.filter((intent) => intent.covered).length}/${group.intents.length}</strong>
      </button>
      <div id="${panelId}" class="collapsible-body" hidden>
        <div class="question-library-list">
          ${group.intents.map(renderIntentQuestions).join('')}
        </div>
      </div>
    </article>
  `;
}

function renderIntentQuestions(intent) {
  return `
    <div class="question-intent ${intent.covered ? 'covered' : ''}">
      <div class="question-intent-title">
        <strong>${escapeHtml(intent.label)}</strong>
        ${intent.covered ? '<span>covered</span>' : ''}
      </div>
      <div class="question-variants">
        ${intent.variants.map((variant) => `<button type="button" class="question-variant" data-question-variant="${escapeHtml(variant)}">${escapeHtml(variant)}</button>`).join('')}
      </div>
    </div>
  `;
}

function renderSummaryGroup(group) {
  return `
    <article class="summary-group">
      <h3>${escapeHtml(group.title)}</h3>
      <ul>
        ${group.facts.map((fact) => `<li><strong>${escapeHtml(fact.label)}:</strong> ${escapeHtml(fact.value)}</li>`).join('')}
      </ul>
    </article>
  `;
}

function bindCollapsibles(container) {
  container.querySelectorAll('.collapsible-trigger').forEach((button) => {
    button.addEventListener('click', () => {
      const panel = document.getElementById(button.getAttribute('aria-controls'));
      const expanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!expanded));
      if (panel) panel.hidden = expanded;
    });
  });
}

function bindModeCards(container) {
  container.querySelectorAll('[data-mode-card-trigger]').forEach((button) => {
    button.addEventListener('click', () => {
      const next = button.dataset.modeCardTrigger;
      container.dataset.activeModeCard = next;
      container.querySelectorAll('[data-mode-card]').forEach((card) => {
        const active = card.dataset.modeCard === next;
        const trigger = card.querySelector('[data-mode-card-trigger]');
        const body = card.querySelector('.mode-card-body');
        const state = trigger?.querySelector('strong');
        card.classList.toggle('active', active);
        trigger?.setAttribute('aria-expanded', String(active));
        if (state) state.textContent = active ? 'Open' : 'View';
        if (body) body.hidden = !active;
      });
    });
  });
}

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
