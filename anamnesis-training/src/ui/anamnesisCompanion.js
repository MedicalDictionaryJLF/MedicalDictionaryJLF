import { transcriptLink } from './transcriptEvidence.js';
import { getChecklistItemsByCategory } from './categoryModel.js?v=pilot-9';
import { QUESTION_AREAS, getModelQuestions } from '../data/interviewSchema.js?v=pilot-9';

const TEXT = {
  English: {
    covered:'Covered', notCovered:'Not yet covered', noTopics:'No history sections started yet.',
    practiceHint:'Practice shows topics the patient has answered. Progress counts the core topics in each section.',
    teachingHint:'Teaching mode shows the relevant interview curriculum, model questions and live coverage.',
    worksheetIntro:'Optional worksheet notes', notesPlaceholder:'Write your notes for this section…', asked:'asked',
    answered:'Answered', started:'started', modelQuestion:'Example question', complete:'complete'
  },
  Deutsch: {
    covered:'Abgedeckt', notCovered:'Noch nicht abgedeckt', noTopics:'Noch kein Anamnesebereich begonnen.',
    practiceHint:'Im Übungsmodus siehst du die beantworteten Themen. Der Fortschritt zählt die Kernthemen jedes Abschnitts.',
    teachingHint:'Der Lehrmodus zeigt die relevanten Themen, Beispielfragen und den aktuellen Fortschritt.',
    worksheetIntro:'Optionale Arbeitsblatt-Notizen', notesPlaceholder:'Notizen zu diesem Abschnitt…', asked:'erfragt',
    answered:'Beantwortet', started:'begonnen', modelQuestion:'Beispielfrage', complete:'vollständig'
  },
  Slovensky: {
    covered:'Pokryté', notCovered:'Zatiaľ nepokryté', noTopics:'Zatiaľ nebola začatá žiadna časť anamnézy.',
    practiceHint:'Cvičný režim zobrazuje zodpovedané témy. Priebeh sa počíta z hlavných tém jednotlivých častí.',
    teachingHint:'Výučbový režim zobrazuje relevantnú štruktúru anamnézy, vzorové otázky a priebežné pokrytie.',
    worksheetIntro:'Voliteľné poznámky k anamnéze', notesPlaceholder:'Napíšte si poznámky k tejto časti…', asked:'spýtané',
    answered:'Zodpovedané', started:'začaté', modelQuestion:'Vzorová otázka', complete:'hotové'
  }
};

const AREA_LABELS = {
  English: {},
  Deutsch: {
    identification:'Identifikation', chief_complaint:'Hauptbeschwerde', hpi_socrates:'Aktuelle Erkrankung (SOCRATES)', review_of_systems:'Systemanamnese', past_medical_history:'Eigenanamnese', allergies_transfusions:'Allergien & Transfusionen', medication:'Medikamente', family_history:'Familienanamnese', epidemiology:'Epidemiologische Anamnese', social_history:'Sozial- & Funktionsanamnese', gynecological:'Gynäkologische Anamnese', substance_use:'Noxen', closure:'Abschluss'
  },
  Slovensky: {
    identification:'Identifikácia', chief_complaint:'Hlavný dôvod prijatia', hpi_socrates:'Anamnéza terajšieho ochorenia (SOCRATES)', review_of_systems:'Prehľad systémov', past_medical_history:'Osobná anamnéza', allergies_transfusions:'Alergie a transfúzie', medication:'Lieky', family_history:'Rodinná anamnéza', epidemiology:'Epidemiologická anamnéza', social_history:'Sociálna a funkčná anamnéza', gynecological:'Gynekologická anamnéza', substance_use:'Abúzy / návykové látky', closure:'Ukončenie rozhovoru'
  }
};

function canonicalLanguage(value){
  const v=String(value||'').toLowerCase();
  if(v.startsWith('de')) return 'Deutsch';
  if(v.startsWith('sl') || v.includes('slov')) return 'Slovensky';
  return 'English';
}
function language(){ return canonicalLanguage(globalThis.localStorage?.getItem('app_language')||'English'); }
function tr(key){ const l=language(); return TEXT[l]?.[key] || TEXT.English[key] || key; }
function areaTitle(area){ const l=language(); return AREA_LABELS[l]?.[area.id] || area.title; }

export function getAnamnesisCompanionAreas(patientCase){
  const female=/female/i.test(String(patientCase?.identity?.sex||''));
  const notRelevant=new Set(patientCase?.debriefPriorities?.notRelevant || []);
  return QUESTION_AREAS
    .filter(area=>area.id!=='objective' && (area.id!=='gynecological' || female))
    .map(area=>({ ...area, intents: area.intents.filter((id)=>!notRelevant.has(id)) }))
    .filter(area=>area.intents.length || area.id==='closure');
}

export function getCoverageTopicState({ engine, patientCase } = {}) {
  const groups = getChecklistItemsByCategory(engine, patientCase, { includeObjective: false });
  const expected = groups.flatMap(group => group.items.map(item => ({
    id: item.id,
    name: item.label,
    areaId: group.id,
    areaName: areaTitle(group),
    optional: item.optional,
    turn: item.turn,
    covered: item.status === 'complete',
    satisfied: item.satisfied,
    attempted: item.status !== 'notAsked',
    examples: getModelQuestions(item.id)
  })));
  return {
    covered: expected.filter(item => item.covered || (!item.optional && item.satisfied)),
    uncovered: expected.filter(item => !item.optional && !item.satisfied),
    expected,
    groups
  };
}

export function renderAnamnesisCompanion({container,engine,patientCase,mode='practice',notes={},onNotesChange}={}){
  if(!container || !engine) return;
  if(mode==='exam'){
    container.innerHTML='';
    return;
  }
  const topicState=getCoverageTopicState({engine,patientCase});
  container.innerHTML=`
    <p class="companion-intro">${escapeHtml(mode==='teaching'?tr('teachingHint'):tr('practiceHint'))}</p>
    ${renderCoverage(topicState,mode)}
    <details class="companion-worksheet-details">
      <summary>${escapeHtml(tr('worksheetIntro'))}</summary>
      ${renderWorksheet(topicState.groups,notes)}
    </details>`;
  container.querySelectorAll('[data-anamnesis-note]').forEach(textarea=>{
    textarea.addEventListener('input',()=>onNotesChange?.(textarea.dataset.anamnesisNote,textarea.value));
  });
}

export function buildWorksheetText({patientCase,notes={}}={}){
  const lines=[];
  getAnamnesisCompanionAreas(patientCase).forEach((area,index)=>{
    const value=String(notes[area.id]||'').trim();
    if(!value) return;
    lines.push(`${index+1}. ${areaTitle(area)}`,value,'');
  });
  return lines.join('\n').trim();
}

function renderCoverage(topicState,mode){
  if(mode==='practice'){
    const rows=topicState.groups.map((group)=>{
      const { asked, total, percent } = group;
      const answered=group.items.filter(item=>item.status==='complete');
      const state=percent>=100?tr('complete'):answered.length?tr('started'):'—';
      const topics=answered.length
        ? `<div class="companion-touched"><span>${escapeHtml(tr('answered'))}</span><div>${answered.map(item=>`<em>${transcriptLink(item.turn, escapeHtml(item.label))}</em>`).join('')}</div></div>`
        : '';
      return `<article class="coverage-area coverage-area-summary"><div class="coverage-title"><strong>${escapeHtml(areaTitle(group))}</strong><span>${asked}/${total}</span></div><div class="coverage-section-meter"><i style="width:${percent}%"></i></div><small>${escapeHtml(state)}</small>${topics}</article>`;
    }).join('');
    return rows ? `<div class="coverage-overview coverage-practice">${rows}</div>` : `<p class="coverage-empty">${escapeHtml(tr('noTopics'))}</p>`;
  }
  return `<div class="coverage-overview coverage-teaching">${topicState.groups.map(group=>{
    const topics=topicState.expected.filter(topic=>topic.areaId===group.id && (!topic.optional || topic.attempted));
    return `<section class="coverage-area"><h3>${escapeHtml(areaTitle(group))}</h3>${topics.map(topic=>renderTopicRow(topic,topic.covered)).join('')}</section>`;
  }).join('')}</div>`;
}

function renderTopicRow(topic,covered){
  const label=covered?tr('covered'):tr('notCovered');
  const examples=(topic.examples||[]).slice(0,2);
  return `<div class="coverage-topic-row ${covered?'is-covered':'is-missing'}"><span class="coverage-topic-icon" aria-label="${escapeHtml(label)}">${covered?'✓':'○'}</span><div><strong>${transcriptLink(topic.turn, escapeHtml(topic.name))}</strong>${examples.length?`<div class="coverage-model-questions"><small>${escapeHtml(tr('modelQuestion'))}</small>${examples.map(q=>`<em>${escapeHtml(q)}</em>`).join('')}</div>`:''}</div></div>`;
}

function renderWorksheet(groups,notes){
  return `<div class="companion-worksheet-stack">${groups.map((area,index)=>{
    return `<details class="companion-sheet-section" ${index===0?'open':''}>
      <summary><span>${String(index+1).padStart(2,'0')}</span><strong>${escapeHtml(areaTitle(area))}</strong><small>${area.asked}/${area.total} ${escapeHtml(tr('answered'))}</small></summary>
      <div class="companion-sheet-body"><textarea data-anamnesis-note="${escapeHtml(area.id)}" rows="4" placeholder="${escapeHtml(tr('notesPlaceholder'))}">${escapeHtml(notes[area.id]||'')}</textarea></div>
    </details>`;
  }).join('')}</div>`;
}

function escapeHtml(value){
  return String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}
