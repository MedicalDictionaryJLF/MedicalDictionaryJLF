// Anatomy Structures v2 browser/search helpers.
// Static-host compatible and deliberately dependency-free.

export function normalizeAnatomyText(value){
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function list(value){
  return Array.isArray(value) ? value : (value === null || value === undefined || value === "" ? [] : [value]);
}

function unique(values){
  const out = [];
  const seen = new Set();
  for(const value of values || []){
    const text = String(value || "").trim();
    if(!text) continue;
    const key = normalizeAnatomyText(text);
    if(!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

export function getStructureTerm(record, lang = "en"){
  const terms = record?.terms || {};
  const node = terms[lang] || {};
  return String(node.preferred || "").trim();
}

export function getStructureAliases(record){
  const terms = record?.terms || {};
  return unique(Object.values(terms).flatMap(node => list(node?.aliases)));
}

export function getStructureAllTerms(record){
  const terms = record?.terms || {};
  return unique(Object.values(terms).flatMap(node => [node?.preferred, ...list(node?.aliases)]));
}

export function isAnatomyMuscle(record){
  return String(record?.type || "") === "muscle";
}

export function getAnatomyMuscleDetails(record){
  if(!isAnatomyMuscle(record)) return null;
  const details = record?.details?.muscle;
  return details && typeof details === "object" ? details : null;
}

function joined(values){
  return list(values).map(value => String(value || "").trim()).filter(Boolean).join("; ");
}

// Compatibility adapter for the existing muscle-training UI. The canonical
// source is now Anatomy v2.3; this adapter deliberately does NOT treat
// translated region/category labels as translations of the muscle name.
export function anatomyMuscleToLegacyRows(record){
  const muscle = getAnatomyMuscleDetails(record);
  if(!muscle) return [];
  const classifications = list(muscle.classifications);
  const variants = classifications.length ? classifications : [{}];
  return variants.map(classification => ({
    id: String(record?.id || ""),
    muscle_region_en: String(classification?.region?.en || record?.region?.[0] || ""),
    muscle_region_sk: "",
    muscle_region_ge: String(classification?.region?.de || ""),
    muscle_category_en: String(classification?.category?.en || ""),
    muscle_category_sk: "",
    muscle_category_ge: String(classification?.category?.de || ""),
    latin_muscle_name: getStructureTerm(record, "la"),
    english_muscle_name: getStructureTerm(record, "en"),
    slovak_muscle_name: "",
    german_muscle_name: getStructureTerm(record, "de"),
    muscle_part: joined(muscle.parts),
    innervation: joined(muscle.innervation),
    blood_supply: joined(muscle.blood_supply),
    origo: joined(muscle.origin),
    insercio: joined(muscle.insertion),
    movement_function: joined(muscle.actions)
  }));
}

function objectText(value){
  if(value === null || value === undefined) return "";
  if(typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if(Array.isArray(value)) return value.map(objectText).filter(Boolean).join(" ");
  if(typeof value === "object") return Object.entries(value).map(([k,v]) => `${k} ${objectText(v)}`).join(" ");
  return "";
}

export function buildAnatomyStructureIndex(dataset){
  const structures = Array.isArray(dataset?.structures) ? dataset.structures : [];
  const relationships = Array.isArray(dataset?.relationships) ? dataset.relationships : [];
  const byId = new Map(structures.map(record => [String(record.id || ""), record]));
  const relationsById = new Map();
  const addRel = (id, rel, direction)=>{
    if(!id) return;
    if(!relationsById.has(id)) relationsById.set(id, []);
    const otherId = direction === "out" ? rel.target_id : rel.source_id;
    relationsById.get(id).push({
      ...rel,
      direction,
      otherId,
      other: byId.get(otherId) || null
    });
  };
  for(const rel of relationships){
    addRel(rel.source_id, rel, "out");
    addRel(rel.target_id, rel, "in");
  }

  const rows = structures.map(record => {
    const learning = record.learning || {};
    const fields = {
      english: getStructureTerm(record, "en"),
      latin: getStructureTerm(record, "la"),
      german: getStructureTerm(record, "de"),
      aliases: getStructureAliases(record).join(" "),
      type: String(record.type || ""),
      region: list(record.region).join(" "),
      system: list(record.system).join(" "),
      courseTags: list(record.course_tags).join(" "),
      keyFeatures: list(record.key_features).join(" "),
      clinicalNotes: list(record.clinical_notes).join(" "),
      details: objectText(record.details),
      oral: list(learning.oral_exam_prompts).join(" "),
      confusions: list(learning.common_confusions).join(" "),
      examImportance: String(learning.exam_importance || ""),
      all: ""
    };
    const relationText = (relationsById.get(record.id) || []).map(rel => [rel.relation_type, getStructureAllTerms(rel.other).join(" "), rel.note].filter(Boolean).join(" ")).join(" ");
    fields.relations = relationText;
    fields.all = Object.values(fields).join(" ");
    const normalized = Object.fromEntries(Object.entries(fields).map(([key,value]) => [key, normalizeAnatomyText(value)]));
    return { id: record.id, record, fields, normalized };
  });
  return { rows, byId, relationships, relationsById };
}

function fieldScore(text, q, tokens, weights){
  if(!text) return 0;
  if(text === q) return weights.exact;
  if(text.startsWith(q)) return weights.prefix;
  if(text.includes(q)) return weights.contains;
  if(tokens.length){
    const hit = tokens.filter(token => text.includes(token)).length;
    if(hit === tokens.length) return weights.tokens;
    if(hit >= Math.ceil(tokens.length * 0.66)) return Math.round(weights.tokens * 0.72);
  }
  return 0;
}

export function searchAnatomyStructures(query, index, options = {}){
  const q = normalizeAnatomyText(query);
  if(!q) return [];
  const tokens = q.split(" ").filter(Boolean);
  const filters = options.filters || {};
  const maxResults = Number(options.maxResults || 50);
  const results = [];

  for(const item of index?.rows || []){
    const r = item.record || {};
    const learning = r.learning || {};
    if(filters.types?.size && !filters.types.has(String(r.type || ""))) continue;
    if(filters.systems?.size && !list(r.system).some(v => filters.systems.has(String(v)))) continue;
    if(filters.regions?.size && !list(r.region).some(v => filters.regions.has(String(v)))) continue;
    if(filters.courseTags?.size && !list(r.course_tags).some(v => filters.courseTags.has(String(v)))) continue;
    if(filters.examImportance?.size && !filters.examImportance.has(String(learning.exam_importance || ""))) continue;

    const n = item.normalized;
    const scored = [
      ["english", fieldScore(n.english, q, tokens, {exact:110,prefix:98,contains:84,tokens:82})],
      ["latin", fieldScore(n.latin, q, tokens, {exact:108,prefix:96,contains:82,tokens:80})],
      ["aliases", fieldScore(n.aliases, q, tokens, {exact:96,prefix:88,contains:78,tokens:76})],
      ["german", fieldScore(n.german, q, tokens, {exact:94,prefix:86,contains:76,tokens:74})],
      ["type", fieldScore(n.type, q, tokens, {exact:74,prefix:68,contains:58,tokens:56})],
      ["region", fieldScore(n.region, q, tokens, {exact:78,prefix:70,contains:62,tokens:60})],
      ["system", fieldScore(n.system, q, tokens, {exact:78,prefix:70,contains:62,tokens:60})],
      ["relations", fieldScore(n.relations, q, tokens, {exact:70,prefix:66,contains:60,tokens:60})],
      ["key_features", fieldScore(n.keyFeatures, q, tokens, {exact:68,prefix:62,contains:56,tokens:56})],
      ["clinical_notes", fieldScore(n.clinicalNotes, q, tokens, {exact:64,prefix:58,contains:52,tokens:52})],
      ["details", fieldScore(n.details, q, tokens, {exact:60,prefix:54,contains:48,tokens:48})],
      ["course_tags", fieldScore(n.courseTags, q, tokens, {exact:58,prefix:52,contains:46,tokens:46})],
      ["exam_importance", fieldScore(n.examImportance, q, tokens, {exact:54,prefix:48,contains:42,tokens:42})]
    ];
    scored.sort((a,b)=>b[1]-a[1]);
    const score = scored[0][1];
    if(score <= 0) continue;
    results.push({
      id: item.id,
      record: item.record,
      score,
      matchedFields: scored.filter(([,s])=>s > 0).map(([field])=>field).slice(0,4)
    });
  }
  results.sort((a,b)=> b.score-a.score || getStructureTerm(a.record,"en").localeCompare(getStructureTerm(b.record,"en")));
  return results.slice(0,maxResults);
}

export function getStructureRelations(structureId, index){
  return (index?.relationsById?.get(String(structureId || "")) || []).slice();
}

export function findRelatedClinicalCorrelations(structureId, correlations){
  const id = String(structureId || "");
  if(!id) return [];
  return (correlations || []).filter(record => {
    if(String(record?.subject?.id || "") === id || String(record?.target?.id || "") === id) return true;
    const blob = JSON.stringify(record?.details || {});
    return blob.includes(`\"${id}\"`);
  });
}
