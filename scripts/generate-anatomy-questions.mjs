import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const srcPath = path.join(root, 'data/anatomy/anatomy_structures_core_elaborated.json');
const outPath = path.join(root, 'data/anatomy/anatomy_structures_question_bank_generated.json');
const flatPath = path.join(root, 'data/anatomy/anatomy_structures_question_bank_generated_flat.csv');
const anatomy = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
const structures = Array.isArray(anatomy.structures) ? anatomy.structures : [];
const relationships = Array.isArray(anatomy.relationships) ? anatomy.relationships : [];
const byId = new Map(structures.map(s => [String(s.id), s]));

function clean(v){ return String(v ?? '').trim(); }
function list(v){ return Array.isArray(v) ? v : []; }
function term(s, lang='en'){ return clean(s?.terms?.[lang]?.preferred); }
function stableHash(text){
  let h = 2166136261;
  for(const ch of String(text || '')){
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function overlap(a,b){
  const A = new Set(list(a).map(clean).filter(Boolean));
  return list(b).map(clean).filter(Boolean).reduce((n,x)=>n+(A.has(x)?1:0),0);
}
function relationPhrase(type){
  return ({
    adjacent_to:'is adjacent to', articulates_with:'articulates with', bifurcates_into:'bifurcates into', branch_of:'is a branch of',
    carries_blood_to:'carries blood to', communicates_with:'communicates with', conducts_air_to:'conducts air to', contains:'contains',
    contains_pathway_component:'contains as a pathway component', continues_as:'continues as', drains_to:'drains to', formed_by:'is formed by',
    forms_boundary_of:'forms a boundary of', forms_part_of_joint:'forms part of', gives_branch_to:'gives a branch to', has_part:'has as a part',
    inferior_to:'is inferior to', innervated_by:'is innervated by', innervates:'innervates', inserts_on:'inserts on', joins_to_form:'joins to form',
    located_in:'is located in', opens_into:'opens into', originates_from:'originates from', part_of:'is part of', passes_anterior_to:'passes anterior to',
    passes_through:'passes through', posterior_to:'is posterior to', projects_to:'projects to', receives_blood_from:'receives blood from',
    receives_input_from:'receives input from', supplied_by:'is supplied by', supplies:'supplies', surrounded_by:'is surrounded by', surrounds:'surrounds',
    anastomoses_with:'anastomoses with', bounded_by:'is bounded by'
  })[type] || type.replaceAll('_',' ');
}

const outgoing = new Map();
const incoming = new Map();
for(const rel of relationships){
  const outKey = `${rel.source_id}|${rel.relation_type}`;
  const inKey = `${rel.target_id}|${rel.relation_type}`;
  if(!outgoing.has(outKey)) outgoing.set(outKey, []);
  if(!incoming.has(inKey)) incoming.set(inKey, []);
  outgoing.get(outKey).push(rel.target_id);
  incoming.get(inKey).push(rel.source_id);
}

function candidateIds(answerId, excludedIds, seed){
  const answer = byId.get(answerId);
  if(!answer) return [];
  const excluded = new Set([answerId, ...excludedIds]);
  const scored = [];
  for(const s of structures){
    if(excluded.has(s.id)) continue;
    let score = 0;
    if(s.type === answer.type) score += 50;
    else continue;
    score += overlap(s.region, answer.region) * 12;
    score += overlap(s.system, answer.system) * 8;
    const hash = stableHash(`${seed}|${s.id}`) % 10000;
    scored.push({id:s.id, score, hash});
  }
  scored.sort((a,b)=>b.score-a.score || a.hash-b.hash || a.id.localeCompare(b.id));
  const strong = scored.filter(x => x.score >= 58);
  return strong.slice(0,3).map(x=>x.id);
}

function displayAnswer(id){
  const s = byId.get(id);
  return term(s,'en') || term(s,'la') || id;
}
function isReviewedEvidenceStatus(status){
  const value=clean(status).toLowerCase();
  return value.startsWith('source_backed') || value === 'reviewed' || value === 'faculty_verified';
}
function germanTerminologyEligible(structure){
  return isReviewedEvidenceStatus(structure?.evidence?.terminology?.de?.status);
}
function makeMcq({id,prompt,answerId,excludedIds=[],conceptIds=[],rel=null,direction='forward',rule='relation'}){
  const answer = byId.get(answerId);
  if(!answer) return null;
  const distractorIds = candidateIds(answerId, [...excludedIds, ...conceptIds], id);
  const evidenceStatus = rel?.evidence_status || 'generated_from_canonical_terms';
  const sourceBacked = isReviewedEvidenceStatus(evidenceStatus);
  const quizEligible = sourceBacked && rel?.question_eligible !== false;
  const isMcq = distractorIds.length >= 3;
  return {
    question_id:id,
    origin: rule === 'terminology' ? 'canonical_terminology' : 'anatomy_graph',
    type:isMcq ? 'multiple_choice' : 'typing',
    prompt,
    correct_answer:displayAnswer(answerId),
    correct_answer_latin:term(answer,'la') || null,
    correct_answer_german:term(answer,'de') || null,
    answer_id:answerId,
    distractors:isMcq ? distractorIds.map(displayAnswer) : [],
    distractor_ids:isMcq ? distractorIds : [],
    concept_ids:[...new Set(conceptIds.filter(Boolean))],
    source_relation_id:rel?.id || null,
    relation_type:rel?.relation_type || null,
    direction,
    explanation: rel ? `${displayAnswer(rel.source_id)} ${relationPhrase(rel.relation_type)} ${displayAnswer(rel.target_id)}.` + (rel.note ? ` ${clean(rel.note)}` : '') : null,
    evidence_status:evidenceStatus,
    quiz_eligible:quizEligible,
    status:sourceBacked ? 'generated_from_source_backed_fact' : (rule === 'terminology' ? 'generated_from_canonical_terminology' : 'generated_from_graph_needs_review'),
    generation_rule:rule
  };
}

function makeTyping({id,prompt,answer,answerLatin=null,answerGerman=null,conceptIds=[],rule,quizEligible=true,evidenceStatus='canonical_terminology'}){
  return {
    question_id:id, origin:'canonical_terminology', type:'typing', prompt,
    correct_answer:answer, correct_answer_latin:answerLatin, correct_answer_german:answerGerman,
    answer_id:conceptIds[0] || null, distractors:[], distractor_ids:[], concept_ids:conceptIds,
    source_relation_id:null, relation_type:null, direction:'terminology', explanation:null,
    evidence_status:evidenceStatus, quiz_eligible:Boolean(quizEligible),
    status:quizEligible ? 'generated_from_canonical_terminology' : 'generated_from_terminology_needs_review', generation_rule:rule
  };
}

const questions=[];
const qids=new Set();
function push(q){ if(!q || qids.has(q.question_id)) return; qids.add(q.question_id); questions.push(q); }

function sourcePrompt(rel){
  const s=byId.get(rel.source_id), t=byId.get(rel.target_id);
  const S=term(s,'en')||rel.source_id, T=term(t,'en')||rel.target_id;
  switch(rel.relation_type){
    case 'innervated_by': return `Which nerve or neural structure innervates ${S}?`;
    case 'innervates': return `Which structure is innervated by ${S}?`;
    case 'supplies': return `Which structure is supplied by ${S}?`;
    case 'gives_branch_to': return `Which structure arises as a branch from ${S}?`;
    case 'contains': return `Which structure is contained in ${S}?`;
    case 'has_part': return `Which structure is a part of ${S}?`;
    case 'surrounds': return `Which structure is surrounded by ${S}?`;
    case 'forms_boundary_of': return `Which structure has ${S} as an anatomical boundary?`;
    case 'articulates_with': return `Which structure articulates with ${S}?`;
    case 'communicates_with': return `Which structure communicates with ${S}?`;
    case 'anastomoses_with': return `Which vessel anastomoses with ${S}?`;
    case 'covers': return `Which structure is covered or invested by ${S}?`;
    case 'extends_through': return `Which structure contains a major component of ${S}?`;
    case 'supplied_by': return `Which artery supplies ${S}?`;
    case 'originates_from': return s?.type==='muscle' ? `From which structure does ${S} originate?` : `From which structure does ${S} arise?`;
    case 'inserts_on': return `On which structure does ${S} insert?`;
    case 'branch_of': return `${S} is a branch of which structure?`;
    case 'bifurcates_into': return `Which structure is produced by the bifurcation of ${S}?`;
    case 'continues_as': return `What does ${S} continue as?`;
    case 'drains_to': return `Into which structure does ${S} drain?`;
    case 'passes_through': return `Through which structure does ${S} pass?`;
    case 'located_in': return `Where is ${S} located?`;
    case 'part_of': return `${S} is part of which structure?`;
    case 'forms_part_of_joint': return `Which joint includes ${S} as a structural component?`;
    case 'joins_to_form': return `What does ${S} join to form?`;
    case 'opens_into': return `Into which structure does ${S} open?`;
    case 'projects_to': return `Where does ${S} project?`;
    case 'receives_input_from': return `From which structure does ${S} receive input?`;
    case 'surrounded_by': return `Which structure surrounds ${S}?`;
    case 'bounded_by': return `Which structure forms a boundary of ${S}?`;
    case 'carries_blood_to': return `Toward which organ does ${S} carry blood?`;
    case 'posterior_to': return `${S} lies posterior to which structure?`;
    case 'inferior_to': return `${S} lies inferior to which structure?`;
    default: return `Which structure completes this anatomical relation: ${S} ${relationPhrase(rel.relation_type)} ... ?`;
  }
}
function reversePrompt(rel){
  const s=byId.get(rel.source_id), t=byId.get(rel.target_id);
  const S=term(s,'en')||rel.source_id, T=term(t,'en')||rel.target_id;
  switch(rel.relation_type){
    case 'innervated_by': return `Which of these structures is innervated by ${T}?`;
    case 'supplied_by': return `Which of these structures is supplied by ${T}?`;
    case 'passes_through': return `Which structure passes through ${T}?`;
    case 'branch_of': return `Which structure is a branch of ${T}?`;
    case 'originates_from': return `Which structure originates from ${T}?`;
    case 'inserts_on': return `Which muscle inserts on ${T}?`;
    case 'forms_part_of_joint': return `Which structure forms part of ${T}?`;
    case 'contains': return `Which structure contains ${T}?`;
    case 'has_part': return `Which structure has ${T} as a part?`;
    case 'surrounds': return `Which structure surrounds ${T}?`;
    case 'forms_boundary_of': return `Which structure forms a boundary of ${T}?`;
    case 'articulates_with': return `Which structure articulates with ${T}?`;
    default: return null;
  }
}

const reverseTypes=new Set(['innervated_by','supplied_by','passes_through','branch_of','originates_from','inserts_on','forms_part_of_joint','contains','has_part','surrounds','forms_boundary_of','articulates_with']);
for(const rel of relationships){
  const source=byId.get(rel.source_id), target=byId.get(rel.target_id);
  if(!source || !target) continue;
  const outCorrect = outgoing.get(`${rel.source_id}|${rel.relation_type}`) || [rel.target_id];
  push(makeMcq({
    id:`graph_${rel.id}_f`, prompt:sourcePrompt(rel), answerId:rel.target_id, excludedIds:outCorrect,
    conceptIds:[rel.source_id,rel.target_id], rel, direction:'forward', rule:`relation:${rel.relation_type}:forward`
  }));
  if(reverseTypes.has(rel.relation_type)){
    const rp=reversePrompt(rel);
    if(rp){
      const inCorrect = incoming.get(`${rel.target_id}|${rel.relation_type}`) || [rel.source_id];
      push(makeMcq({
        id:`graph_${rel.id}_r`, prompt:rp, answerId:rel.source_id, excludedIds:inCorrect,
        conceptIds:[rel.source_id,rel.target_id], rel, direction:'reverse', rule:`relation:${rel.relation_type}:reverse`
      }));
    }
  }
}

// Canonical terminology questions. Slovak anatomy terminology is intentionally absent in v2.3.
for(const s of structures){
  const en=term(s,'en'), la=term(s,'la'), de=term(s,'de');
  if(en && la){
    push(makeTyping({id:`term_${s.id}_en_la`,prompt:`Give the Latin anatomical term for ${en}.`,answer:la,answerLatin:la,answerGerman:de||null,conceptIds:[s.id],rule:'terminology:en_to_la',quizEligible:true,evidenceStatus:'canonical_en_la'}));
    push(makeTyping({id:`term_${s.id}_la_en`,prompt:`What is the English anatomical name of ${la}?`,answer:en,answerLatin:la,answerGerman:de||null,conceptIds:[s.id],rule:'terminology:la_to_en',quizEligible:true,evidenceStatus:'canonical_en_la'}));
  }
  if(en && de){
    const deEligible=germanTerminologyEligible(s);
    push(makeTyping({id:`term_${s.id}_en_de`,prompt:`Give the German anatomical term for ${en}.`,answer:de,answerLatin:la||null,answerGerman:de,conceptIds:[s.id],rule:'terminology:en_to_de',quizEligible:deEligible,evidenceStatus:s?.evidence?.terminology?.de?.status || 'seed_needs_review'}));
  }
}

questions.sort((a,b)=>a.question_id.localeCompare(b.question_id));
const byOrigin=questions.reduce((m,q)=>{m[q.origin]=(m[q.origin]||0)+1;return m;},{});
const relationQs=questions.filter(q=>q.origin==='anatomy_graph');
const coveredConcepts=new Set(relationQs.flatMap(q=>q.concept_ids));
const sourceBackedCount=questions.filter(q=>q.status==='generated_from_source_backed_fact').length;
const quizEligible=questions.filter(q=>q.quiz_eligible===true);
const quizEligibleGraph=quizEligible.filter(q=>q.origin==='anatomy_graph');
const quizEligibleTerminology=quizEligible.filter(q=>q.origin==='canonical_terminology');
const quizEligibleGraphCoverage=new Set(quizEligibleGraph.flatMap(q=>q.concept_ids));
const payload={
  schema_version:'2.0.0',
  generated_at:new Date().toISOString(),
  generation_version:'anatomy_graph_questions_v1',
  dataset_id:anatomy.dataset?.id || 'anatomy_structures_core_elaborated',
  source_schema_version:anatomy.schema_version,
  metadata:{
    deterministic:true,
    slovak_anatomy_terms_included:false,
    question_count:questions.length,
    graph_question_count:relationQs.length,
    terminology_question_count:questions.length-relationQs.length,
    source_backed_graph_question_count:sourceBackedCount,
    quiz_eligible_question_count:quizEligible.length,
    quiz_eligible_graph_question_count:quizEligibleGraph.length,
    quiz_eligible_terminology_question_count:quizEligibleTerminology.length,
    quiz_eligible_graph_concept_coverage:quizEligibleGraphCoverage.size,
    graph_concept_coverage:coveredConcepts.size,
    concept_count:structures.length,
    origins:byOrigin,
    distractor_policy:'Same answer structure type; prefer overlapping anatomical region/system; exclude all other known correct answers for the same relation grouping and both question concepts; require strong contextual score or fall back to typing; stable hash ordering.',
    quiz_eligibility_policy:'Graph questions are quiz-eligible only when the source relation is source-backed/reviewed/faculty-verified and is not explicitly question_eligible=false. EN↔LA canonical terminology is eligible; German terminology is eligible only when its DE term is source-backed/reviewed/faculty-verified.'
  },
  questions
};
fs.writeFileSync(outPath, JSON.stringify(payload,null,2)+'\n','utf8');

function csvEscape(v){
  const s=Array.isArray(v)?v.join('; '):clean(v);
  if(/[",\n\r]/.test(s)) return `"${s.replaceAll('"','""')}"`;
  return s;
}
const headers=['question_id','origin','type','prompt','correct_answer','correct_answer_latin','correct_answer_german','distractors','concept_ids','source_relation_id','relation_type','direction','evidence_status','quiz_eligible','status','generation_rule','explanation'];
const lines=[headers.join(',')];
for(const q of questions){
  lines.push(headers.map(h=>csvEscape(q[h] ?? '')).join(','));
}
fs.writeFileSync(flatPath, lines.join('\n')+'\n','utf8');
console.log(`Generated ${questions.length} deterministic Anatomy questions: ${relationQs.length} graph + ${questions.length-relationQs.length} terminology; graph coverage ${coveredConcepts.size}/${structures.length}; quiz-eligible ${quizEligible.length} (${quizEligibleGraph.length} graph).`);
