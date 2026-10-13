import { QUESTION_AREAS, INTENTS, getModelQuestions } from '../data/interviewSchema.js?v=134';

const TEXT = {
  English: {
    covered:'Covered', notCovered:'Not yet covered', noTopics:'No history sections started yet.',
    practiceHint:'Practice shows section-level progress only. It does not reveal the missing questions.',
    teachingHint:'Teaching mode shows the relevant interview curriculum, model questions and live coverage.',
    worksheetIntro:'Optional worksheet notes', notesPlaceholder:'Write your notes for this section…', asked:'asked',
    started:'started', modelQuestion:'Example question', complete:'complete'
  },
  Deutsch: {
    covered:'Abgedeckt', notCovered:'Noch nicht abgedeckt', noTopics:'Noch kein Anamnesebereich begonnen.',
    practiceHint:'Der Übungsmodus zeigt nur den Fortschritt pro Abschnitt und verrät keine fehlenden Fragen.',
    teachingHint:'Der Lehrmodus zeigt die relevanten Themen, Beispielfragen und den aktuellen Fortschritt.',
    worksheetIntro:'Optionale Arbeitsblatt-Notizen', notesPlaceholder:'Notizen zu diesem Abschnitt…', asked:'erfragt',
    started:'begonnen', modelQuestion:'Beispielfrage', complete:'vollständig'
  },
  Slovensky: {
    covered:'Pokryté', notCovered:'Zatiaľ nepokryté', noTopics:'Zatiaľ nebola začatá žiadna časť anamnézy.',
    practiceHint:'Cvičný režim zobrazuje iba priebeh jednotlivých častí. Neodhaľuje, ktoré konkrétne otázky chýbajú.',
    teachingHint:'Výučbový režim zobrazuje relevantnú štruktúru anamnézy, vzorové otázky a priebežné pokrytie.',
    worksheetIntro:'Voliteľné poznámky k anamnéze', notesPlaceholder:'Napíšte si poznámky k tejto časti…', asked:'spýtané',
    started:'začaté', modelQuestion:'Vzorová otázka', complete:'hotové'
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
function language(){ return canonicalLanguage(localStorage.getItem('app_language')||'English'); }
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

function intentSatisfied(engine,intentId,setName){
  const set=engine?.[setName];
  if(!set) return false;
  return typeof engine?.isIntentSatisfied==='function' ? engine.isIntentSatisfied(intentId,set) : Boolean(set?.has?.(intentId));
}

export function getCoverageTopicState({ engine, patientCase } = {}) {
  const areas = getAnamnesisCompanionAreas(patientCase);
  const expected = areas.flatMap((area) => area.intents
    .filter((id) => INTENTS[id])
    .map((id) => ({ id, name: INTENTS[id]?.title || id, areaId: area.id, areaName: areaTitle(area), covered: intentSatisfied(engine,id,'askedIntents'), attempted: intentSatisfied(engine,id,'attemptedIntents'), examples:getModelQuestions(id) })));
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
    ${renderCoverage(areas,topicState,mode,engine)}
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

function renderCoverage(areas,topicState,mode,engine){
  if(mode==='practice'){
    const rows=areas.map((area)=>{
      const total=area.intents.length;
      const asked=area.intents.filter((id)=>intentSatisfied(engine,id,'attemptedIntents')).length;
      const percent=total ? Math.round((asked/total)*100) : 0;
      const state=percent>=100?tr('complete'):asked>0?tr('started'):'—';
      return `<article class="coverage-area coverage-area-summary"><div class="coverage-title"><strong>${escapeHtml(areaTitle(area))}</strong><span>${asked}/${total}</span></div><div class="coverage-section-meter"><i style="width:${percent}%"></i></div><small>${escapeHtml(state)}</small></article>`;
    }).join('');
    return rows ? `<div class="coverage-overview coverage-practice">${rows}</div>` : `<p class="coverage-empty">${escapeHtml(tr('noTopics'))}</p>`;
  }
  return `<div class="coverage-overview coverage-teaching">${areas.map((area)=>{
    const topics=topicState.expected.filter((topic)=>topic.areaId===area.id);
    return `<section class="coverage-area"><h3>${escapeHtml(areaTitle(area))}</h3>${topics.map((topic)=>renderTopicRow(topic,topic.covered)).join('')}</section>`;
  }).join('')}</div>`;
}

function renderTopicRow(topic,covered){
  const label=covered?tr('covered'):tr('notCovered');
  const examples=(topic.examples||[]).slice(0,2);
  return `<div class="coverage-topic-row ${covered?'is-covered':'is-missing'}"><span class="coverage-topic-icon" aria-label="${escapeHtml(label)}">${covered?'✓':'○'}</span><div><strong>${escapeHtml(topic.name)}</strong>${examples.length?`<div class="coverage-model-questions"><small>${escapeHtml(tr('modelQuestion'))}</small>${examples.map(q=>`<em>${escapeHtml(q)}</em>`).join('')}</div>`:''}</div></div>`;
}

function renderWorksheet(areas,engine,notes){
  return `<div class="companion-worksheet-stack">${areas.map((area,index)=>{
    const asked=area.intents.filter((id)=>engine?.attemptedIntents?.has?.(id)).length;
    return `<details class="companion-sheet-section" ${index===0?'open':''}>
      <summary><span>${String(index+1).padStart(2,'0')}</span><strong>${escapeHtml(areaTitle(area))}</strong><small>${asked}/${area.intents.length} ${escapeHtml(tr('asked'))}</small></summary>
      <div class="companion-sheet-body"><textarea data-anamnesis-note="${escapeHtml(area.id)}" rows="4" placeholder="${escapeHtml(tr('notesPlaceholder'))}">${escapeHtml(notes[area.id]||'')}</textarea></div>
    </details>`;
  }).join('')}</div>`;
}

function escapeHtml(value){
  return String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}
