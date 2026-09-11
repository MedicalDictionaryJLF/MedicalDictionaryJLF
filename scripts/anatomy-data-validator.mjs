import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const fail = (message) => { throw new Error(`[anatomy:data] ${message}`); };
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");
const readJson = rel => JSON.parse(read(rel));
const clean = value => String(value ?? "").trim();
const list = value => Array.isArray(value) ? value : [];

function parseCsv(text){
  const rows = [];
  let row = [], field = "", quoted = false;
  for(let i = 0; i < text.length; i += 1){
    const ch = text[i];
    if(quoted){
      if(ch === '"' && text[i + 1] === '"'){ field += '"'; i += 1; continue; }
      if(ch === '"'){ quoted = false; continue; }
      field += ch;
      continue;
    }
    if(ch === '"'){ quoted = true; continue; }
    if(ch === ','){ row.push(field); field = ""; continue; }
    if(ch === '\n'){
      row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; continue;
    }
    field += ch;
  }
  if(quoted) fail("unterminated quoted CSV field");
  if(field.length || row.length){ row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows.filter((r, i) => i === 0 || r.some(value => clean(value)));
}

const anatomy = readJson("data/anatomy/anatomy_structures_core_elaborated.json");
const structures = list(anatomy.structures);
const relations = list(anatomy.relationships);
const allowedTypes = new Set(list(anatomy.allowed_types));
const allowedRelations = new Set(list(anatomy.relationship_types));

if(anatomy.schema_version !== "2.3.0") fail(`expected schema_version 2.3.0, got ${anatomy.schema_version}`);
if(Number(anatomy.dataset?.record_count) !== structures.length) fail("dataset.record_count does not match structures.length");
if(Number(anatomy.dataset?.relationship_count) !== relations.length) fail("dataset.relationship_count does not match relationships.length");
const actualTypeCounts = Object.fromEntries([...new Set(structures.map(record => clean(record?.type)))].sort().map(type => [type, structures.filter(record => clean(record?.type) === type).length]));
const declaredTypeCounts = anatomy.dataset?.type_counts || {};
if(JSON.stringify(actualTypeCounts) !== JSON.stringify(declaredTypeCounts)) fail("dataset.type_counts does not match actual structure types");

const ids = structures.map(record => clean(record?.id));
if(ids.some(id => !id)) fail("structure without id");
if(new Set(ids).size !== ids.length) fail("duplicate structure IDs");
const idSet = new Set(ids);

for(const record of structures){
  if(!allowedTypes.has(clean(record.type))) fail(`${record.id}: unknown type ${record.type}`);
  for(const lang of ["en", "la", "de"]){
    const term = record?.terms?.[lang];
    if(!term || !Array.isArray(term.aliases)) fail(`${record.id}: invalid terms.${lang}`);
  }
  if(record.parent_id && !idSet.has(clean(record.parent_id))) fail(`${record.id}: missing parent ${record.parent_id}`);
  if(Object.prototype.hasOwnProperty.call(record?.terms || {}, "sk")) fail(`${record.id}: canonical Slovak Anatomy term must be absent in v2.3`);
  if(record?.evidence?.terminology && Object.prototype.hasOwnProperty.call(record.evidence.terminology, "sk")) fail(`${record.id}: Slovak terminology evidence must be absent in v2.3`);
  if(!clean(record?.terms?.de?.preferred)) fail(`${record.id}: missing German preferred term in v2.3 terminology layer`);
  const terminologyStatus = clean(record?.evidence?.terminology?.de?.status);
  if(!["source_backed", "seed_needs_review"].includes(terminologyStatus)) fail(`${record.id}: invalid terminology status for de`);
}

const relationIds = relations.map(rel => clean(rel?.id));
if(new Set(relationIds).size !== relationIds.length) fail("duplicate relationship IDs");
const semanticRelationKeys = relations.map(rel => [clean(rel?.source_id), clean(rel?.relation_type), clean(rel?.target_id)].join("\u241f"));
if(new Set(semanticRelationKeys).size !== semanticRelationKeys.length) fail("duplicate semantic relationship triple (source_id + relation_type + target_id)");
for(const rel of relations){
  if(!idSet.has(clean(rel.source_id))) fail(`${rel.id}: missing source ${rel.source_id}`);
  if(!idSet.has(clean(rel.target_id))) fail(`${rel.id}: missing target ${rel.target_id}`);
  if(!allowedRelations.has(clean(rel.relation_type))) fail(`${rel.id}: undeclared relation type ${rel.relation_type}`);
}
const evidenceSources = anatomy.dataset?.evidence_sources || {};
for(const rel of relations){
  if(rel.evidence_refs !== undefined && !Array.isArray(rel.evidence_refs)) fail(`${rel.id}: evidence_refs must be an array`);
  for(const ref of list(rel.evidence_refs)){ if(!evidenceSources[clean(ref)]) fail(`${rel.id}: unknown evidence ref ${ref}`); }
}
const relationDefinitions = anatomy.relationship_definitions || {};
if(Object.keys(relationDefinitions).sort().join("\u241f") !== [...allowedRelations].sort().join("\u241f")) fail("relationship_definitions must define every and only declared relationship type");
for(const type of allowedRelations){
  if(!clean(relationDefinitions[type]?.description)) fail(`relationship_definitions.${type}: missing description`);
  if(typeof relationDefinitions[type]?.symmetric !== "boolean") fail(`relationship_definitions.${type}: missing symmetric flag`);
  const inverse = clean(relationDefinitions[type]?.inverse_relation_type);
  if(inverse && !allowedRelations.has(inverse)) fail(`relationship_definitions.${type}: unknown inverse relation ${inverse}`);
}
const vagueRelationTypes = new Set(["part_or_branch_of", "gives_branch_or_continues_as", "passes_through_or_lies_in", "related_to", "innervates_or_related_to", "includes_or_uses", "anatomically_related_to", "participates_in", "includes"]);
for(const rel of relations){
  if(vagueRelationTypes.has(clean(rel.relation_type))) fail(`${rel.id}: legacy vague relation type remains: ${rel.relation_type}`);
}

const muscles = structures.filter(record => record.type === "muscle");
const expectedMuscles = Number(anatomy.dataset?.muscle_integration?.canonical_muscle_concepts || 0);
if(!expectedMuscles || muscles.length !== expectedMuscles) fail(`canonical muscle count mismatch: ${muscles.length} vs ${expectedMuscles}`);
for(const record of muscles){
  if(!clean(record?.terms?.en?.preferred)) fail(`${record.id}: missing English muscle name`);
  if(!clean(record?.terms?.la?.preferred)) fail(`${record.id}: missing Latin muscle name`);
  if(!list(record.system).includes("muscular")) fail(`${record.id}: muscle must belong to muscular system`);
  const details = record?.details?.muscle;
  if(!details || typeof details !== "object") fail(`${record.id}: missing details.muscle`);
  for(const field of ["classifications", "parts", "origin", "insertion", "innervation", "blood_supply", "actions"]){
    if(!Array.isArray(details[field])) fail(`${record.id}: details.muscle.${field} must be an array`);
  }
  // Guard the original bug: classification labels are not muscle-name translations; Slovak anatomy content was removed in v2.3.
  for(const item of list(details.classifications)){
    if(item?.region && Object.prototype.hasOwnProperty.call(item.region, "sk")) fail(`${record.id}: Slovak muscle region classification must be absent from canonical v2.3 data`);
    if(item?.category && Object.prototype.hasOwnProperty.call(item.category, "sk")) fail(`${record.id}: Slovak muscle category classification must be absent from canonical v2.3 data`);
  }
  const classificationTranslations = list(details.classifications).flatMap(item => [item?.region?.de, item?.category?.de]).map(clean).filter(Boolean);
  const preferredDe = clean(record?.terms?.de?.preferred);
  if(preferredDe && classificationTranslations.includes(preferredDe)) fail(`${record.id}: de preferred term is a classification label, not a muscle translation`);
}

const muscleRelations = relations.filter(rel => clean(rel.id).startsWith("rel_muscle_"));
const expectedMuscleRelations = Number(anatomy.dataset?.muscle_integration?.generated_relationships || 0);
if(muscleRelations.length !== expectedMuscleRelations) fail(`muscle relation count mismatch: ${muscleRelations.length} vs ${expectedMuscleRelations}`);

const muscleCsv = parseCsv(read("data/terminology/muscles.csv"));
const muscleHeaders = muscleCsv[0] || [];
if(muscleHeaders.length !== 14) fail(`muscles.csv must have 14 columns, got ${muscleHeaders.length}`);
for(let i = 1; i < muscleCsv.length; i += 1){
  if(muscleCsv[i].length !== muscleHeaders.length) fail(`muscles.csv row ${i + 1}: ${muscleCsv[i].length} columns, expected ${muscleHeaders.length}`);
}
const legacyRows = muscleCsv.length - 1;
const expectedLegacyRows = Number(anatomy.dataset?.muscle_integration?.legacy_rows_after_cleanup || 0);
if(legacyRows !== expectedLegacyRows) fail(`legacy muscle row count mismatch: ${legacyRows} vs ${expectedLegacyRows}`);

const headerIndex = Object.fromEntries(muscleHeaders.map((name, index) => [name, index]));
const exactKeys = new Set();
for(let i = 1; i < muscleCsv.length; i += 1){
  const row = muscleCsv[i];
  for(const required of ["latin_muscle_name", "english_muscle_name"]){
    if(!clean(row[headerIndex[required]])) fail(`muscles.csv row ${i + 1}: missing ${required}`);
  }
  const keyFields = ["muscle_region_en", "muscle_category_en", "latin_muscle_name", "english_muscle_name", "innervation", "blood_supply", "origo", "insercio", "movement_function"];
  const key = keyFields.map(field => clean(row[headerIndex[field]]).toLowerCase()).join("\u241f");
  if(exactKeys.has(key)) fail(`muscles.csv row ${i + 1}: exact duplicate muscle record`);
  exactKeys.add(key);
}

const flat = parseCsv(read("data/anatomy/anatomy_structures_core_elaborated_flat.csv"));
const flatHeaders = flat[0] || [];
const flatIdIndex = flatHeaders.indexOf("id");
if(flatIdIndex < 0) fail("flat anatomy CSV missing id column");
if(flatHeaders.includes("slovak")) fail("flat anatomy CSV must not expose Slovak canonical terms in v2.3");
if(flat.length - 1 !== structures.length) fail(`flat anatomy row count mismatch: ${flat.length - 1} vs ${structures.length}`);
const flatIds = new Set(flat.slice(1).map(row => clean(row[flatIdIndex])));
for(const id of ids){ if(!flatIds.has(id)) fail(`flat anatomy CSV missing ${id}`); }

const linkedIds = new Set(relations.flatMap(rel => [clean(rel.source_id), clean(rel.target_id)]).filter(Boolean));
const isolated = structures.filter(record => !linkedIds.has(record.id));
if(isolated.length) fail(`${isolated.length} Anatomy concepts have no explicit graph relation: ${isolated.map(record => record.id).join(", ")}`);
const linkedMuscleIds = new Set([...linkedIds].filter(id => structures.find(s => s.id === id)?.type === "muscle"));
const unlinked = muscles.filter(record => !linkedMuscleIds.has(record.id));
if(unlinked.length) fail(`${unlinked.length} muscle concepts have no explicit graph relation: ${unlinked.map(record => record.id).join(", ")}`);
const terminologyCoverage = Object.fromEntries(["en", "la", "de"].map(lang => [lang, structures.filter(record => clean(record?.terms?.[lang]?.preferred)).length]));

const generated = readJson("data/anatomy/anatomy_structures_question_bank_generated.json");
const generatedQuestions = list(generated.questions);
if(generated.source_schema_version !== anatomy.schema_version) fail("generated question bank source_schema_version is stale");
if(generated.metadata?.deterministic !== true) fail("generated question bank must declare deterministic=true");
if(generated.metadata?.slovak_anatomy_terms_included !== false) fail("generated question bank must exclude Slovak Anatomy terminology");
if(Number(generated.metadata?.question_count) !== generatedQuestions.length) fail("generated question_count metadata mismatch");
const questionIds = generatedQuestions.map(q => clean(q.question_id));
if(questionIds.some(id => !id) || new Set(questionIds).size !== questionIds.length) fail("generated questions must have unique non-empty IDs");
const relationIdSet = new Set(relationIds);
const relationById = new Map(relations.map(rel => [clean(rel.id), rel]));
const structureById = new Map(structures.map(record => [clean(record.id), record]));
const graphQuestionConcepts = new Set();
const eligibleGraphConcepts = new Set();
const eligibleEvidence = status => {
  const value=clean(status).toLowerCase();
  return value.startsWith("source_backed") || value === "reviewed" || value === "faculty_verified";
};
for(const q of generatedQuestions){
  for(const id of list(q.concept_ids)){ if(!idSet.has(clean(id))) fail(`${q.question_id}: unknown concept ${id}`); }
  if(typeof q.quiz_eligible !== "boolean") fail(`${q.question_id}: quiz_eligible must be boolean`);
  if(q.origin === "anatomy_graph"){
    if(!relationIdSet.has(clean(q.source_relation_id))) fail(`${q.question_id}: missing source relation ${q.source_relation_id}`);
    const sourceRel=relationById.get(clean(q.source_relation_id));
    const expectedEligible=eligibleEvidence(sourceRel?.evidence_status) && sourceRel?.question_eligible !== false;
    if(q.quiz_eligible !== expectedEligible) fail(`${q.question_id}: quiz eligibility does not match source relation evidence`);
    for(const id of list(q.concept_ids)){
      graphQuestionConcepts.add(clean(id));
      if(q.quiz_eligible) eligibleGraphConcepts.add(clean(id));
    }
  } else if(q.origin === "canonical_terminology"){
    const rule=clean(q.generation_rule);
    if(rule === "terminology:en_to_la" || rule === "terminology:la_to_en"){
      if(q.quiz_eligible !== true) fail(`${q.question_id}: canonical EN/LA terminology must remain quiz-eligible`);
    } else if(rule === "terminology:en_to_de"){
      const concept=structureById.get(clean(list(q.concept_ids)[0]));
      const expectedEligible=eligibleEvidence(concept?.evidence?.terminology?.de?.status);
      if(q.quiz_eligible !== expectedEligible) fail(`${q.question_id}: German terminology quiz eligibility mismatch`);
    }
  }
  if(q.type === "multiple_choice" && list(q.distractors).length !== 3) fail(`${q.question_id}: multiple-choice question must have exactly 3 distractors`);
}
if(graphQuestionConcepts.size !== structures.length) fail(`graph-generated question coverage ${graphQuestionConcepts.size}/${structures.length}`);
if(Number(generated.metadata?.quiz_eligible_question_count) !== generatedQuestions.filter(q => q.quiz_eligible === true).length) fail("generated quiz-eligible question_count metadata mismatch");
if(Number(generated.metadata?.quiz_eligible_graph_question_count) !== generatedQuestions.filter(q => q.origin === "anatomy_graph" && q.quiz_eligible === true).length) fail("generated quiz-eligible graph count metadata mismatch");
if(Number(generated.metadata?.quiz_eligible_graph_concept_coverage) !== eligibleGraphConcepts.size) fail("generated quiz-eligible graph coverage metadata mismatch");
const generatedFlat = parseCsv(read("data/anatomy/anatomy_structures_question_bank_generated_flat.csv"));
if(generatedFlat.length - 1 !== generatedQuestions.length) fail("generated flat question CSV row count mismatch");
if(!(generatedFlat[0] || []).includes("quiz_eligible")) fail("generated flat question CSV missing quiz_eligible column");

console.log(`Anatomy data validation passed: ${structures.length} concepts, ${muscles.length} muscle concepts, ${relations.length} relationships (${muscleRelations.length} muscle-derived), ${legacyRows} clean legacy muscle rows.`);
console.log(`Graph coverage: ${linkedIds.size}/${structures.length}. Preferred terminology coverage: EN ${terminologyCoverage.en}, LA ${terminologyCoverage.la}, DE ${terminologyCoverage.de}.`);
console.log(`Deterministic question bank: ${generatedQuestions.length} questions; graph coverage ${graphQuestionConcepts.size}/${structures.length}; quiz-eligible graph coverage ${eligibleGraphConcepts.size}/${structures.length}.`);
