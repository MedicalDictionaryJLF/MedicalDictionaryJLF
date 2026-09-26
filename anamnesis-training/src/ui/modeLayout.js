import { getChecklistItemsByCategory } from './categoryModel.js';

export function renderModeLayout({ container, mode, engine, patientCase }) {
  if (!container || !engine) return;
  if (mode === 'exam') {
    container.innerHTML = '';
    container.hidden = true;
    return;
  }
  container.hidden = false;
  const groups = getChecklistItemsByCategory(engine, patientCase);
  container.innerHTML = `
    <article class="mode-card active coverage-mode-card">
      <div class="mode-card-trigger coverage-mode-title"><span>Coverage overview</span></div>
      <div class="mode-card-body">${mode === 'teaching' ? renderTeachingCoverage(groups) : renderPracticeCoverage(groups)}</div>
    </article>`;
}

function renderPracticeCoverage(groups) {
  const covered = groups.flatMap((group) => group.items
    .filter((item) => item.status === 'complete')
    .map((item) => ({ ...item, group: group.title })));
  if (!covered.length) return '<p class="empty-panel-note">No topics covered yet.</p>';
  return `<div class="coverage-overview coverage-practice">${covered.map((item) => `
    <div class="coverage-topic-row is-covered"><span class="coverage-topic-icon" aria-label="Covered">✓</span><span>${escapeHtml(item.label)}</span></div>`).join('')}</div>`;
}

function renderTeachingCoverage(groups) {
  return `<div class="coverage-overview coverage-teaching">${groups.map((group) => `
    <section class="coverage-area"><h3>${escapeHtml(group.title)}</h3>${group.items
      .filter((item) => item.status !== 'notApplicable')
      .map((item) => {
        const covered = item.status === 'complete';
        return `<div class="coverage-topic-row ${covered ? 'is-covered' : 'is-missing'}"><span class="coverage-topic-icon" aria-label="${covered ? 'Covered' : 'Not yet covered'}">${covered ? '✓' : '✕'}</span><span>${escapeHtml(item.label)}</span></div>`;
      }).join('')}</section>`).join('')}</div>`;
}

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
