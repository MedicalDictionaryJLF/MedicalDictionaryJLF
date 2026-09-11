import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const readJson = rel => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));

const anatomy = readJson("data/anatomy/anatomy_structures_core_elaborated.json");
const anatomySchema = readJson("data/schemas/anatomy_structures_v2.schema.json");
const questions = readJson("data/anatomy/anatomy_structures_question_bank_seed.json");
const generatedQuestions = readJson("data/anatomy/anatomy_structures_question_bank_generated.json");
const rubrics = readJson("data/anatomy/anatomy_structures_oral_rubrics_seed.json");
const bridges = readJson("data/anatomy/anatomy_structures_clinical_bridges_seed.json");
const clinical = readJson("data/anatomy/clinical_correlations_logic.json");
const clinicalSchema = readJson("data/schemas/clinical_correlations.schema.json");

assert.ok(anatomySchema && typeof anatomySchema === "object");
assert.ok(clinicalSchema && typeof clinicalSchema === "object");
assert.equal(anatomy.schema_version, "2.3.0");
assert.equal(anatomy.structures.length, 604, "unified anatomy structure count");
assert.equal(anatomy.relationships.length, 1080, "unified anatomy relationship count");
assert.equal(anatomy.structures.filter(record => record.type === "muscle").length, 225, "canonical muscle concept count");
const structureIds = anatomy.structures.map(record => record.id);
assert.equal(new Set(structureIds).size, structureIds.length, "duplicate anatomy structure IDs");
const structureIdSet = new Set(structureIds);
for(const rel of anatomy.relationships){
  assert.ok(structureIdSet.has(rel.source_id), `missing relationship source ${rel.source_id}`);
  assert.ok(structureIdSet.has(rel.target_id), `missing relationship target ${rel.target_id}`);
}
const semanticRelationKeys = anatomy.relationships.map(rel => `${rel.source_id}\u241f${rel.relation_type}\u241f${rel.target_id}`);
assert.equal(new Set(semanticRelationKeys).size, semanticRelationKeys.length, "duplicate semantic relationship triples");
assert.equal(questions.questions.length, 10, "question seed count");
assert.equal(rubrics.rubrics.length, 4, "oral rubric count");
assert.equal(bridges.cases.length, 5, "clinical bridge count");
assert.ok(questions.questions.every(q => q.status === "seed_needs_review"));
assert.ok(rubrics.rubrics.every(q => q.status === "seed_needs_review"));
assert.ok(bridges.cases.every(q => q.status === "seed_needs_review"));
assert.equal(generatedQuestions.metadata.deterministic, true, "graph question bank must be deterministic");
assert.equal(generatedQuestions.metadata.slovak_anatomy_terms_included, false, "Slovak anatomy terminology must stay removed");
assert.equal(generatedQuestions.questions.length, 3684, "deterministic Anatomy question count");
assert.equal(generatedQuestions.metadata.graph_question_count, 1872, "graph-derived question count");
assert.equal(generatedQuestions.metadata.graph_concept_coverage, 604, "every Anatomy concept must have a graph-derived question");
assert.equal(generatedQuestions.metadata.quiz_eligible_question_count, 1278, "quiz-eligible deterministic question count");
assert.equal(generatedQuestions.metadata.quiz_eligible_graph_question_count, 60, "quiz-eligible graph question count");
assert.equal(generatedQuestions.metadata.quiz_eligible_graph_concept_coverage, 58, "quiz-eligible graph concept coverage");
assert.ok(generatedQuestions.questions.every(q => typeof q.quiz_eligible === "boolean"), "every generated question must declare quiz eligibility");
assert.ok(generatedQuestions.questions.filter(q => q.origin === "anatomy_graph" && q.quiz_eligible).every(q => String(q.evidence_status || "").startsWith("source_backed") || ["reviewed", "faculty_verified"].includes(q.evidence_status)), "unreviewed graph facts must not enter active quiz pool");
assert.ok(generatedQuestions.questions.every(q => !("correct_answer_slovak" in q)), "generated question bank must not reintroduce Slovak Anatomy answers");

assert.equal(clinical.correlations.length, 40, "clinical correlation count");
const clinicalIds = clinical.correlations.map(record => record.id);
assert.equal(new Set(clinicalIds).size, clinicalIds.length, "duplicate clinical correlation IDs");
assert.ok(clinical.correlations.every(record => Array.isArray(record.question_templates) && record.question_templates.length > 0));
assert.ok(clinical.correlations.every(record => String(record.answer || "").trim().length > 0));
assert.ok(clinical.correlations.every(record => record.evidence?.status === "seed_needs_review"));

const structureSource = fs.readFileSync(path.join(root, "assets/js/anatomy/anatomy-structure-service.js"), "utf8");
const structureModuleUrl = `data:text/javascript;base64,${Buffer.from(structureSource).toString("base64")}`;
const { anatomyMuscleToLegacyRows, buildAnatomyStructureIndex, getStructureRelations, searchAnatomyStructures } = await import(structureModuleUrl);
const index = buildAnatomyStructureIndex(anatomy);
assert.equal(index.rows.length, 604);
for(const query of ["median nerve", "nervus medianus", "foramen ovale", "cavernous sinus", "thoracic duct", "deltoid muscle", "musculus deltoideus"]){
  const hits = searchAnatomyStructures(query, index, { maxResults: 10 });
  assert.ok(hits.length > 0, `no anatomy-v2 hit for ${query}`);
}

const deltoid = anatomy.structures.find(record => record.id === "muscle_deltoideus");
assert.ok(deltoid, "integrated deltoid muscle concept missing");
assert.equal(Object.prototype.hasOwnProperty.call(deltoid.terms, "sk"), false, "Slovak canonical Anatomy term must be removed");
assert.equal(deltoid.terms.de.preferred, "Deltamuskel", "German deltoid terminology missing");
assert.ok(anatomy.structures.every(record => !Object.prototype.hasOwnProperty.call(record.terms || {}, "sk")), "Slovak canonical Anatomy terminology remains in dataset");
assert.ok(anatomy.structures.filter(record => record.type === "muscle").every(record => (record.details?.muscle?.classifications || []).every(item => !Object.prototype.hasOwnProperty.call(item.region || {}, "sk") && !Object.prototype.hasOwnProperty.call(item.category || {}, "sk"))), "Slovak muscle classification labels remain in canonical Anatomy data");
assert.ok(deltoid.terms.de.preferred !== deltoid.details.muscle.classifications[0].category.de, "German category must not masquerade as muscle translation");
const deltoidRelations = getStructureRelations(deltoid.id, index);
assert.ok(deltoidRelations.some(rel => rel.relation_type === "innervated_by" && rel.other?.id === "nerve_axillary"), "deltoid -> axillary nerve relation missing");
assert.ok(deltoidRelations.some(rel => rel.relation_type === "originates_from" && rel.other?.id === "bone_scapula"), "deltoid -> scapula origin relation missing");
const legacyMuscleRows = anatomy.structures.filter(record => record.type === "muscle").flatMap(anatomyMuscleToLegacyRows);
assert.equal(legacyMuscleRows.length, 226, "legacy muscle-training adapter row count");
const legacyDeltoid = legacyMuscleRows.find(row => row.id === "muscle_deltoideus");
assert.equal(legacyDeltoid.slovak_muscle_name, "");
assert.equal(legacyDeltoid.german_muscle_name, "Deltamuskel");
for(const query of ["Deltamuskel", "Gaumenaponeurose", "plantar nerve", "musculus soleus", "foramen infraorbitale"]){
  assert.ok(searchAnatomyStructures(query, index, { maxResults: 10 }).length > 0, `no v2.3 terminology/support hit for ${query}`);
}
assert.equal(searchAnatomyStructures("deltový sval", index, { maxResults: 10 }).length, 0, "removed Slovak Anatomy terminology should not remain searchable from the canonical graph");
const vagueTypes = new Set(["part_or_branch_of", "gives_branch_or_continues_as", "passes_through_or_lies_in", "related_to", "innervates_or_related_to", "includes_or_uses", "anatomically_related_to", "participates_in", "includes"]);
assert.ok(anatomy.relationships.every(rel => !vagueTypes.has(rel.relation_type)), "legacy vague relation types remain");
assert.deepEqual(Object.keys(anatomy.relationship_definitions).sort(), anatomy.relationship_types.slice().sort(), "controlled relationship definitions must cover active vocabulary exactly");
assert.equal(anatomy.relationship_definitions.innervated_by.inverse_relation_type, "innervates");
assert.equal(anatomy.relationship_definitions.supplied_by.inverse_relation_type, "supplies");
assert.ok(anatomy.relationships.some(rel => rel.relation_type === "contains_pathway_component"), "pathway relation normalization missing");
const muscles = anatomy.structures.filter(record => record.type === "muscle");
assert.ok(muscles.every(record => getStructureRelations(record.id, index).length > 0), "every canonical muscle must now have a graph relation");
const scalene = anatomy.structures.find(record => record.id === "muscle_scalenus_anterior");
assert.ok(getStructureRelations(scalene.id, index).some(rel => rel.relation_type === "innervated_by" && rel.other?.id === "nerve_group_cervical_spinal"), "anterior scalene support relation missing");
const adductorHallucis = anatomy.structures.find(record => record.id === "muscle_adductor_hallucis");
assert.ok(getStructureRelations(adductorHallucis.id, index).some(rel => rel.relation_type === "originates_from" && rel.other?.id === "ligament_plantar_mtp"), "adductor hallucis plantar-ligament support relation missing");
assert.ok(anatomy.relationships.some(rel => rel.source_id === "sinus_cavernous" && rel.relation_type === "contains" && rel.target_id === "artery_internal_carotid"), "cavernous sinus deep relation missing");
assert.ok(anatomy.relationships.some(rel => rel.source_id === "organ_epididymis" && rel.relation_type === "continues_as" && rel.target_id === "duct_ductus_deferens"), "male reproductive continuity relation missing");
assert.ok(anatomy.relationships.some(rel => rel.source_id === "pathway_visual" && rel.relation_type === "receives_input_from" && rel.target_id === "structure_retina"), "visual pathway relation missing");
assert.ok(anatomy.relationships.some(rel => rel.source_id === "nerve_ophthalmic_v1" && rel.relation_type === "passes_through" && rel.target_id === "fissure_superior_orbital"), "V1 -> superior orbital fissure relation missing");
assert.ok(anatomy.relationships.some(rel => rel.source_id === "nerve_maxillary_v2" && rel.relation_type === "passes_through" && rel.target_id === "foramen_rotundum"), "V2 -> foramen rotundum relation missing");
assert.ok(anatomy.relationships.some(rel => rel.source_id === "nerve_mandibular_v3" && rel.relation_type === "passes_through" && rel.target_id === "foramen_ovale"), "V3 -> foramen ovale relation missing");
assert.ok(!anatomy.relationships.some(rel => rel.source_id === "nerve_cn_v" && rel.relation_type === "passes_through" && ["foramen_rotundum", "foramen_ovale"].includes(rel.target_id)), "CN V must not be used as a coarse substitute for V2/V3 skull-base passage");
assert.ok(!anatomy.relationships.some(rel => ["rel_0001", "rel_0002"].includes(rel.id)), "laterality-unsafe generic aorta -> common carotid/subclavian relations must stay removed");
assert.ok(!anatomy.relationships.some(rel => rel.id === "rel_deep_v23_0205"), "conjunctiva must not be modeled as part of the eyeball proper");
assert.ok(anatomy.relationships.some(rel => rel.id === "rel_deep_v23_extra_05" && rel.source_id === "organ_spinal_cord" && rel.target_id === "foramen_magnum"), "foramen-magnum relation should model spinal cord/medullary continuation, not whole brainstem passage");
for(const id of ["rel_deep_v23_0217", "rel_deep_v23_0218", "rel_deep_v23_0222", "rel_deep_v23_0207", "rel_deep_v23_extra_20"]){
  assert.equal(anatomy.relationships.find(rel => rel.id === id)?.question_eligible, false, `${id} should remain graph-visible but quiz-gated until modeled more precisely`);
}
const linkedIds = new Set(anatomy.relationships.flatMap(rel => [rel.source_id, rel.target_id]));
assert.ok(anatomy.structures.every(record => linkedIds.has(record.id)), "every Anatomy concept must be linked in v2.3 graph");
const graphQuestionConceptIds = new Set(generatedQuestions.questions.filter(q => q.origin === "anatomy_graph").flatMap(q => q.concept_ids || []));
assert.ok(anatomy.structures.every(record => graphQuestionConceptIds.has(record.id)), "every Anatomy concept must have a graph-derived deterministic question");

console.log(`Anatomy package tests passed: ${anatomy.structures.length} structures, ${anatomy.relationships.length} relationships, ${clinical.correlations.length} clinical correlations.`);
