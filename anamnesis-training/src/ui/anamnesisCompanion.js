import { QUESTION_AREAS, INTENTS } from '../data/interviewSchema.js';

const TEXT = {
  English: {
    covered:'Covered', notCovered:'Not yet covered', noTopics:'No topics covered yet.',
    practiceHint:'Only successfully covered topics are shown. Unanswered requirements stay hidden.',
    teachingHint:'Teaching mode shows the complete expected coverage and updates it live.',
    worksheetIntro:'Optional worksheet notes', notesPlaceholder:'Write your notes for this section…', asked:'asked'
  },
  Deutsch: {
    covered:'Abgedeckt', notCovered:'Noch nicht abgedeckt', noTopics:'Noch keine Themen abgedeckt.',
    practiceHint:'Es werden nur erfolgreich abgedeckte Themen angezeigt. Offene Anforderungen bleiben verborgen.',
    teachingHint:'Der Lehrmodus zeigt die vollständige erwartete Abdeckung und aktualisiert sie live.',
    worksheetIntro:'Optionale Arbeitsblatt-Notizen', notesPlaceholder:'Notizen zu diesem Abschnitt…', asked:'erfragt'
  },
  Slovensky: {
    covered:'Pokryté', notCovered:'Zatiaľ nepokryté', noTopics:'Zatiaľ nebola pokrytá žiadna téma.',
    practiceHint:'Zobrazujú sa iba úspešne pokryté témy. Nezodpovedané požiadavky zostávajú skryté.',
    teachingHint:'Výučbový režim zobrazuje kompletné očakávané pokrytie a priebežne ho aktualizuje.',
    worksheetIntro:'Voliteľné poznámky k anamnéze', notesPlaceholder:'Napíšte si poznámky k tejto časti…', asked:'spýtané'
  }
};

const AREA_LABELS = {
  English: {},
  Deutsch: {
    identification:'Identifikation', chief_complaint:'Hauptbeschwerde', hpi_socrates:'Aktuelle Erkrankung (SOCRATES)', review_of_systems:'Systemanamnese', past_medical_history:'Eigenanamnese', allergies_transfusions:'Allergien & Transfusionen', medication:'Medikamente', gynecological:'Gynäkologische Anamnese', family_history:'Familienanamnese', epidemiology:'Epidemiologische Anamnese', social_history:'Sozial- & Funktionsanamnese', substance_use:'Noxen'
  },
  Slovensky: {
    identification:'Identifikácia', chief_complaint:'Hlavný dôvod prijatia', hpi_socrates:'Anamnéza terajšieho ochorenia (SOCRATES)', review_of_systems:'Prehľad systémov', past_medical_history:'Osobná anamnéza', allergies_transfusions:'Alergie a transfúzie', medication:'Lieky', gynecological:'Gynekologická anamnéza', family_history:'Rodinná anamnéza', epidemiology:'Epidemiologická anamnéza', social_history:'Sociálna a funkčná anamnéza', substance_use:'Abúzy / návykové látky'
  }
};

function canonicalLanguage(value){
  const v=String(value||'').toLowerCase();
  if(v.startsWith('de')) return 'Deutsch';
  if(v.startsWith('sl') || v.includes('slov')) return 'Slovensky';
  return 'English';
}
function language(){ return canonicalLanguage(localStorage.getItem('app_language')||'English'); }
function tr(key){ const l=language(); return TEXT[l]?.[key] || TEXT.English[key] || key; }
function areaTitle(area){ const l=language(); return AREA_LABELS[l]?.[area.id] || area.title; }

export function getAnamnesisCompanionAreas(patientCase){
  const female=/female/i.test(String(patientCase?.identity?.sex||''));
  return QUESTION_AREAS.filter(area=>area.id!=='objective' && (area.id!=='gynecological' || female));
}

export function getCoverageTopicState({ engine, patientCase } = {}) {
  const areas = getAnamnesisCompanionAreas(patientCase);
  const expected = areas.flatMap((area) => area.intents
    .filter((id) => INTENTS[id])
    .map((id) => ({ id, name: INTENTS[id]?.title || id, areaId: area.id, areaName: areaTitle(area), covered: engine?.askedIntents?.has?.(id) || false })));
  return {
    covered: expected.filter((item) => item.covered),
    uncovered: expected.filter((item) => !item.covered),
    expected
  };
}

export function renderAnamnesisCompanion({container,engine,patientCase,mode='practice',notes={},onNotesChange}={}){
  if(!container || !engine) return;
  if(mode==='exam'){
    container.innerHTML='';
    return;
  }
  const areas=getAnamnesisCompanionAreas(patientCase);
  const topicState=getCoverageTopicState({engine,patientCase});
  container.innerHTML=`
    <p class="companion-intro">${escapeHtml(mode==='teaching'?tr('teachingHint'):tr('practiceHint'))}</p>
    ${renderCoverage(areas,topicState,mode)}
    <details class="companion-worksheet-details">
      <summary>${escapeHtml(tr('worksheetIntro'))}</summary>
      ${renderWorksheet(areas,engine,notes)}
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

function renderCoverage(areas,topicState,mode){
  if(mode==='practice'){
    if(!topicState.covered.length) return `<p class="coverage-empty">${escapeHtml(tr('noTopics'))}</p>`;
    return `<div class="coverage-overview coverage-practice">${topicState.covered.map((topic)=>renderTopicRow(topic,true)).join('')}</div>`;
  }
  return `<div class="coverage-overview coverage-teaching">${areas.map((area)=>{
    const topics=topicState.expected.filter((topic)=>topic.areaId===area.id);
    return `<section class="coverage-area"><h3>${escapeHtml(areaTitle(area))}</h3>${topics.map((topic)=>renderTopicRow(topic,topic.covered)).join('')}</section>`;
  }).join('')}</div>`;
}

function renderTopicRow(topic,covered){
  const label=covered?tr('covered'):tr('notCovered');
  return `<div class="coverage-topic-row ${covered?'is-covered':'is-missing'}"><span class="coverage-topic-icon" aria-label="${escapeHtml(label)}">${covered?'✓':'✕'}</span><span>${escapeHtml(topic.name)}</span></div>`;
}

function renderWorksheet(areas,engine,notes){
  return `<div class="companion-worksheet-stack">${areas.map((area,index)=>{
    const asked=area.intents.filter((id)=>engine?.askedIntents?.has?.(id)).length;
    return `<details class="companion-sheet-section" ${index===0?'open':''}>
      <summary><span>${String(index+1).padStart(2,'0')}</span><strong>${escapeHtml(areaTitle(area))}</strong><small>${asked}/${area.intents.length} ${escapeHtml(tr('asked'))}</small></summary>
      <div class="companion-sheet-body"><textarea data-anamnesis-note="${escapeHtml(area.id)}" rows="4" placeholder="${escapeHtml(tr('notesPlaceholder'))}">${escapeHtml(notes[area.id]||'')}</textarea></div>
    </details>`;
  }).join('')}</div>`;
}

function escapeHtml(value){
  return String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}
