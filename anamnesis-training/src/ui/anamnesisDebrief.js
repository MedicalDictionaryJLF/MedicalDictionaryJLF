/** Case-aware, read-only summary of a completed anamnesis. No data leaves the browser. */
import { INTENTS, QUESTION_AREAS, getModelQuestions } from '../data/interviewSchema.js?v=134';

const html = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
const unique = (items) => [...new Set(items || [])];

function detailFor(id, tier = '') {
  const area = QUESTION_AREAS.find((section) => [...section.intents, ...(section.optionalIntents || [])].includes(id));
  return { id, label: INTENTS[id]?.title || id, area: area?.title || 'Other history', tier, examples: getModelQuestions(id).slice(0, 2) };
}

export function buildAnamnesisDebriefView(debrief = {}, priorities = {}) {
  const essential = unique(priorities.essential);
  const caseCritical = unique(priorities.caseCritical);
  const recommended = unique(priorities.recommended);
  const graded = unique([...essential, ...caseCritical, ...recommended]);
  const missing = new Set([...debrief.missedEssential || [], ...debrief.missedCaseCritical || [], ...debrief.missedRecommended || []]);
  const safetyIds = unique(debrief.criticalSafetyMisses || []);
  const safetySet = new Set(safetyIds);
  const tierFor = (id) => essential.includes(id) ? 'Essential' : caseCritical.includes(id) ? 'Case-critical' : recommended.includes(id) ? 'Recommended' : 'Safety priority';
  const safety = safetyIds.map((id) => detailFor(id, tierFor(id)));
  const important = unique([...debrief.missedEssential || [], ...debrief.missedCaseCritical || []])
    .filter((id) => !safetySet.has(id)).map((id) => detailFor(id, tierFor(id)));
  const optional = unique(debrief.missedRecommended || []).filter((id) => !safetySet.has(id)).map((id) => detailFor(id, 'Recommended'));
  const achieved = graded.filter((id) => !missing.has(id)).map((id) => ({
    ...detailFor(id, tierFor(id)),
    evidence: debrief.evidenceByIntent?.[id]
  }));
  const coverage = (debrief.studentCoverage || []).map((section) => {
    const schema = QUESTION_AREAS.find((area) => area.id === section.id);
    if (!schema) return null;
    const ids = unique([...schema.intents, ...(schema.optionalIntents || [])]).filter((id) => graded.includes(id));
    if (!ids.length) return null;
    const coveredIds = ids.filter((id) => !missing.has(id));
    const missingIds = ids.filter((id) => missing.has(id));
    return { id: section.id, title: section.title, total: ids.length, asked: coveredIds.length, percent: pct(100 * coveredIds.length / ids.length), covered: coveredIds.map((id) => detailFor(id)), missing: missingIds.map((id) => detailFor(id)) };
  }).filter(Boolean);
  const totals = {
    essential: { total: essential.length, asked: essential.filter((id) => !missing.has(id)).length },
    caseCritical: { total: caseCritical.length, asked: caseCritical.filter((id) => !missing.has(id)).length },
    recommended: { total: recommended.length, asked: recommended.filter((id) => !missing.has(id)).length }
  };
  return { safety, important, recommended: optional, achieved, coverage, totals, gradedTotal: graded.length, gradedAsked: graded.filter((id) => !missing.has(id)).length };
}

function topicEvidence(evidence) {
  if (!evidence) return '';
  const status = evidence.resolved ? 'Asked and answered' :
    evidence.reason === 'not_authored' ? 'Asked · information unavailable in this case' : 'Attempted · not fully resolved';
  return `<small>${html(status)} · turn ${html(evidence.turnNumber)}</small>
    <blockquote>${html(evidence.question)}${evidence.reply ? `<br>${html(evidence.reply)}` : ''}</blockquote>`;
}

function questionCards(items, { first = 4 } = {}) {
  if (!items.length) return '';
  const card = (item) => `<article class="pt-debrief-question">
    <div class="pt-debrief-question-head"><strong>${html(item.label)}</strong><span>${html(item.tier)}</span></div>
    <p class="pt-debrief-area">${html(item.area)}</p>
    ${item.examples.length ? `<div class="pt-debrief-prompt"><span>Example question</span>${item.examples.map((q) => `<p>${html(q)}</p>`).join('')}</div>` : ''}
  </article>`;
  const displayed = items.slice(0, first).map(card).join('');
  const remaining = items.slice(first);
  return `<div class="pt-debrief-question-grid">${displayed}</div>${remaining.length ? `<details class="pt-debrief-expand"><summary>See ${remaining.length} more question${remaining.length === 1 ? '' : 's'}</summary><div class="pt-debrief-question-grid">${remaining.map(card).join('')}</div></details>` : ''}`;
}

function metric(label, score, weight, count = null, hint = '') {
  const hasItems = !count || count.total > 0;
  const scoreText = hasItems ? `${pct(score)}%` : 'N/A';
  const description = count ? `${count.asked} of ${count.total} assessed` : hint;
  return `<article class="pt-debrief-metric"><div class="pt-debrief-metric-label"><span>${html(label)}</span><small>${weight}% weight</small></div><strong>${scoreText}</strong><p>${html(description)}</p><div class="pt-debrief-track" role="progressbar" aria-label="${html(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${hasItems ? pct(score) : 0}"><span style="width:${hasItems ? pct(score) : 0}%"></span></div></article>`;
}

function historySections(summary) {
  const blocks = String(summary || '').split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean).filter((block) => block !== 'Anamnesis Summary');
  if (!blocks.length) return '<p class="pt-debrief-empty">No clinical history was collected.</p>';
  return `<div class="pt-debrief-history-grid">${blocks.map((block) => {
    const [heading, ...rest] = block.split('\n');
    const titled = heading.endsWith(':');
    return `<article class="pt-debrief-history-card"><h4>${html(titled ? heading.slice(0, -1) : 'History')}</h4><p>${html(titled ? rest.join('\n') : block).replace(/\n/g, '<br>')}</p></article>`;
  }).join('')}</div>`;
}

export function renderAnamnesisDebrief({ debrief = {}, priorities = {}, caseName = '', mode = '', questionCount = 0, summary = '', worksheet = '', messages = [], uploadHtml = '' } = {}) {
  const view = buildAnamnesisDebriefView(debrief, priorities);
  const breakdown = debrief.scoreBreakdown || {};
  const communication = debrief.communication || {};
  const communicationIssues = communication.issues || [];
  const communicationPositives = unique((communication.positives || []).map((item) => item.message).filter(Boolean));
  const structureFeedback = debrief.structure?.feedback || [];
  const recognition = debrief.resolutionIssues || [];
  const strengths = unique(debrief.strengths || []);
  const turnCount = Math.max(0, Math.round(Number(questionCount) || 0));
  const communicationHint = turnCount < 3 ? `Provisional: ${turnCount} student turn${turnCount === 1 ? '' : 's'}` : `${turnCount} student turns reviewed`;
  const heading = view.safety.length ? `${view.safety.length} safety-priority gap${view.safety.length === 1 ? '' : 's'} to review` : 'All configured safety priorities addressed';
  const explanatory = view.safety.length ? 'These are case-specific prompts not yet identified as attempted. Review them before your next practice attempt.' : 'No omissions among this case’s configured safety priorities. This does not certify a real patient assessment.';
  return `<div class="pt-debrief">
    <nav class="pt-debrief-nav" aria-label="Debrief sections"><a href="#pt-debrief-overview">Overview</a><a href="#pt-debrief-priorities">Priorities</a><a href="#pt-debrief-coverage">Coverage</a><a href="#pt-debrief-feedback">Feedback</a><a href="#pt-debrief-history">History &amp; notes</a><a href="#pt-debrief-submit">Session log</a></nav>
    <section class="pt-debrief-hero" id="pt-debrief-overview" aria-labelledby="pt-debrief-overview-title"><div class="pt-debrief-hero-score"><span id="pt-debrief-overview-title">History score</span><strong>${pct(debrief.score)}%</strong><small>Formative practice result</small></div><div class="pt-debrief-hero-text"><span class="pt-debrief-kicker">${html(caseName)}${mode ? ` · ${html(mode)}` : ''}</span><h3>${html(heading)}</h3><p>${html(explanatory)}</p><div class="pt-debrief-facts"><span>${view.gradedAsked}/${view.gradedTotal} graded history topics attempted</span><span>${turnCount} student turn${turnCount === 1 ? '' : 's'}</span></div></div></section>
    <section class="pt-debrief-section" aria-labelledby="pt-debrief-breakdown-title"><div class="pt-debrief-section-head"><h3 id="pt-debrief-breakdown-title">Score breakdown</h3><p>Weighted by clinical importance, not simply by number of questions.</p></div><div class="pt-debrief-metrics">${metric('Essential history',breakdown.essential,40,view.totals.essential)}${metric('Case-critical history',breakdown.caseCritical,25,view.totals.caseCritical)}${metric('Recommended breadth',breakdown.recommended ?? breakdown.comprehensive,15,view.totals.recommended)}${metric('Communication',breakdown.communication,10,null,communicationHint)}${metric('Interview structure',breakdown.structure,10,null,turnCount < 3 ? 'Early impression' : 'Sequence and closure')}</div><details class="pt-debrief-expand pt-debrief-method"><summary>How is this score calculated?</summary><p>Essential history contributes 40%, case-critical history 25%, recommended breadth 15%, communication 10%, and interview structure 10%. History coverage rewards clinically identifiable attempts, even when the simulator did not return a matching answer. Communication and structure are preliminary for very short interviews. This score is a training aid, not a measure of patient safety.</p></details></section>
    <section class="pt-debrief-section" id="pt-debrief-priorities" aria-labelledby="pt-debrief-priorities-title"><div class="pt-debrief-section-head"><h3 id="pt-debrief-priorities-title">Clinical priorities</h3><p>Case-specific gaps, without repeated entries between categories.</p></div><div class="pt-debrief-critical"><div class="pt-debrief-priority-title"><h4>Safety-priority omissions <span>${view.safety.length}</span></h4><p>Review these first.</p></div>${view.safety.length ? questionCards(view.safety) : '<p class="pt-debrief-positive">All configured safety-priority questions were attempted.</p>'}</div><div class="pt-debrief-subsection"><h4>Other essential or case-critical gaps <span>${view.important.length}</span></h4>${view.important.length ? questionCards(view.important) : '<p class="pt-debrief-positive">No additional essential or case-critical gaps.</p>'}</div><div class="pt-debrief-subsection"><h4>Recommended questions <span>${view.recommended.length}</span></h4>${view.recommended.length ? `<details class="pt-debrief-expand"><summary>Review all ${view.recommended.length} recommended question${view.recommended.length === 1 ? '' : 's'}</summary>${questionCards(view.recommended,{first:6})}</details>` : '<p class="pt-debrief-positive">All recommended case-specific history questions were attempted.</p>'}</div></section>
    <section class="pt-debrief-section" id="pt-debrief-coverage" aria-labelledby="pt-debrief-coverage-title"><div class="pt-debrief-section-head"><h3 id="pt-debrief-coverage-title">Case-specific section coverage</h3><p>Only topics assessed for this patient are counted. Irrelevant generic checklist items are excluded.</p></div><div class="pt-debrief-coverage">${view.coverage.length ? view.coverage.map((row) => `<details class="pt-debrief-coverage-row"><summary><span>${html(row.title)}</span><strong>${row.asked}/${row.total}</strong><div class="pt-debrief-track" role="progressbar" aria-label="${html(row.title)} coverage" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${row.percent}"><span style="width:${row.percent}%"></span></div></summary><div class="pt-debrief-coverage-detail">${row.covered.length ? `<h5>Attempted</h5><ul>${row.covered.map((item) => `<li class="is-covered">${html(item.label)}</li>`).join('')}</ul>` : ''}${row.missing.length ? `<h5>Not yet attempted</h5><ul>${row.missing.map((item) => `<li>${html(item.label)}${item.examples[0] ? `<small>${html(item.examples[0])}</small>` : ''}</li>`).join('')}</ul>` : '<p>All assessed topics in this section were attempted.</p>'}</div></details>`).join('') : '<p class="pt-debrief-empty">No case-specific topics are available.</p>'}</div></section>
    <section class="pt-debrief-section" id="pt-debrief-feedback" aria-labelledby="pt-debrief-feedback-title"><div class="pt-debrief-section-head"><h3 id="pt-debrief-feedback-title">Interview feedback</h3><p>Clinical content, communication and simulator recognition are reviewed separately.</p></div><div class="pt-debrief-feedback-grid"><article class="pt-debrief-feedback-card"><h4>What you did well</h4>${strengths.length ? `<ul>${strengths.map((item) => `<li>${html(item)}</li>`).join('')}</ul>` : '<p>No particular strengths were recorded yet. Begin with the presenting complaint and progress through the history.'}${view.achieved.length ? `<details class="pt-debrief-expand"><summary>See ${view.achieved.length} assessed topic${view.achieved.length === 1 ? '' : 's'} you covered</summary><ul>${view.achieved.map((item) => `<li>${html(item.label)} <small>(${html(item.tier)})</small>${topicEvidence(item.evidence)}</li>`).join('')}</ul></details>` : ''}</article><article class="pt-debrief-feedback-card"><h4>Interview structure</h4>${structureFeedback.length ? `<ul>${structureFeedback.map((item) => `<li>${html(item)}</li>`).join('')}</ul>` : '<p>No structure concerns were flagged by this rubric.'}</article><article class="pt-debrief-feedback-card"><h4>Communication</h4>${communicationPositives.length ? `<p class="pt-debrief-mini-title">Recognized positives</p><ul>${communicationPositives.map((item) => `<li>${html(item)}</li>`).join('')}</ul>` : ''}${communicationIssues.length ? `<p class="pt-debrief-mini-title">Suggestions for improvement (${communicationIssues.length})</p><ul>${communicationIssues.map((issue) => `<li>${html(issue.message || 'Revise phrasing.')} ${issue.question ? `<small>Question: “${html(issue.question)}”</small>` : ''}</li>`).join('')}</ul>` : '<p>No phrasing problems flagged.'}${turnCount < 3 ? '<p class="pt-debrief-caution">Communication cannot be reliably judged from fewer than three student turns.</p>' : ''}</article><article class="pt-debrief-feedback-card"><h4>Simulator recognition</h4><p>${recognition.length ? `${recognition.length} attempted question${recognition.length === 1 ? ' was' : 's were'} not cleanly resolved. These are not treated as ordinary omissions.` : 'No unresolved attempted questions were identified.'}</p>${recognition.length ? `<details class="pt-debrief-expand"><summary>Inspect ${recognition.length} recognition event${recognition.length === 1 ? '' : 's'}</summary><ol>${recognition.map((item) => `<li><strong>${html(item.label || item.intentId || 'Question')}</strong>${item.question ? `<p>“${html(item.question)}”</p>` : ''}<small>${item.laterResolved ? 'Resolved later' : item.reason === 'not_authored' ? 'Asked · information unavailable in this case' : 'Not resolved by simulator'} · turn ${html(item.turnNumber || '?')}</small></li>`).join('')}</ol></details>` : ''}</article></div></section>
    <section class="pt-debrief-section" id="pt-debrief-history" aria-labelledby="pt-debrief-history-title"><div class="pt-debrief-section-head"><h3 id="pt-debrief-history-title">Collected history &amp; notes</h3><p>Only answers the simulator returned are listed in the clinical summary; attempted prompts are counted separately above.</p></div><details class="pt-debrief-expand" open><summary>Structured history collected</summary>${historySections(summary)}</details>${worksheet.trim() ? `<details class="pt-debrief-expand"><summary>Your worksheet notes</summary><pre class="pt-debrief-worksheet">${html(worksheet)}</pre></details>` : ''}${messages.length ? `<details class="pt-debrief-expand"><summary>Interview transcript (${messages.length} messages)</summary><div class="pt-debrief-transcript">${messages.filter((msg) => msg && (msg.speaker === 'student' || msg.speaker === 'patient')).map((msg) => `<article class="pt-debrief-message ${msg.speaker === 'student' ? 'is-student' : 'is-patient'}"><strong>${msg.speaker === 'student' ? 'Student' : 'Patient'}</strong><p>${html(msg.text)}</p></article>`).join('')}</div></details>` : ''}</section>
    <section class="pt-debrief-section" id="pt-debrief-submit" aria-labelledby="pt-debrief-submit-title"><div class="pt-debrief-section-head"><h3 id="pt-debrief-submit-title">Session log</h3><p>Your result is saved locally. Sending a log for improvement is optional.</p></div>${uploadHtml}</section>
  </div>`;
}
