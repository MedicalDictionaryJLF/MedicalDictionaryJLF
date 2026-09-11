import {
  buildClinicalCorrelationIndex,
  formatClinicalCorrelationAnswer,
  searchClinicalCorrelations
} from "./clinical-correlation-search.js?v=1";

export function createClinicalCorrelationService({ loadText }){
  let dataset = null;
  let synonyms = null;
  let index = [];
  let loadPromise = null;

  async function ensureLoaded(){
    if(dataset && index.length) return dataset;
    if(loadPromise) return loadPromise;
    loadPromise = (async()=>{
      const [logicText, synonymText] = await Promise.all([
        loadText("anatomy/clinical_correlations_logic.json"),
        loadText("anatomy/clinical_correlation_synonyms.json")
      ]);
      dataset = JSON.parse(logicText);
      synonyms = JSON.parse(synonymText);
      const records = Array.isArray(dataset?.correlations) ? dataset.correlations : [];
      if(records.length !== 40) throw new Error(`Expected 40 clinical correlations, received ${records.length}`);
      index = buildClinicalCorrelationIndex(records, synonyms || {});
      return dataset;
    })().finally(()=>{ loadPromise = null; });
    return loadPromise;
  }

  async function search(query, options = {}){
    await ensureLoaded();
    return searchClinicalCorrelations(query, index, synonyms || {}, options);
  }

  function searchLoaded(query, options = {}){
    if(!dataset || !index.length) return [];
    return searchClinicalCorrelations(query, index, synonyms || {}, options);
  }

  function format(result){
    return formatClinicalCorrelationAnswer(result);
  }

  function getAll(){
    return Array.isArray(dataset?.correlations) ? dataset.correlations : [];
  }

  function findByStructureId(structureId){
    const id = String(structureId || "");
    return getAll().filter(record => String(record?.subject?.id || "") === id || String(record?.target?.id || "") === id);
  }

  function findByCourseTags(tags){
    const wanted = new Set((tags || []).map(String));
    if(!wanted.size) return [];
    return getAll().filter(record => (record.course_tags || []).some(tag => wanted.has(String(tag))));
  }

  return {
    ensureLoaded,
    search,
    searchLoaded,
    format,
    getAll,
    findByStructureId,
    findByCourseTags,
    get dataset(){ return dataset; },
    get synonyms(){ return synonyms; },
    get index(){ return index; }
  };
}
