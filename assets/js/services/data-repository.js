export const TERMINOLOGY_SOURCES = [
  { key: "anatomy", label: "Anatomy", path: "terminology/anatomy.csv" },
  { key: "diagnostic_methods", label: "Diagnostic methods", path: "terminology/diagnostic_methods.csv" },
  { key: "disease_and_symptoms", label: "Diseases and symptoms", path: "terminology/disease_and_symptoms.csv" },
  { key: "lab_parameters", label: "Laboratory parameters", path: "terminology/lab_parameters.csv" },
  { key: "latin", label: "Latin", path: "terminology/latin/latin_units.csv", sourceLabel: "Units" },
  { key: "latin", label: "Latin", path: "terminology/latin/latin_greek.csv", sourceLabel: "Latin-Greek synonyms" },
  { key: "latin", label: "Latin", path: "terminology/latin/latin_abbreviations.csv", sourceLabel: "Abbreviations in medicine" },
  { key: "latin", label: "Latin", path: "terminology/latin/latin_remedies.csv", sourceLabel: "Remedies" },
  { key: "microorganisms", label: "Microorganisms", path: "terminology/microorganisms.csv" },
  { key: "physiology", label: "Physiology", path: "terminology/physiology.csv" },
  { key: "procedures", label: "Procedures", path: "terminology/procedures.csv" },
  { key: "muscles", label: "Muscles", path: "terminology/muscles.csv" }
];

export const SEARCH_GROUP_DEFINITIONS = [
  { key: "anatomy", label: "Anatomy", datasets: ["anatomy", "muscles"] },
  { key: "physiology", label: "Physiology", datasets: ["physiology"] },
  { key: "diagnostics_procedures", label: "Diagnostics & Procedures", datasets: ["diagnostic_methods", "procedures"] },
  { key: "disease_and_symptoms", label: "Diseases and symptoms", datasets: ["disease_and_symptoms"] },
  { key: "lab_parameters", label: "Laboratory parameters", datasets: ["lab_parameters"] },
  { key: "latin", label: "Latin", datasets: ["latin"] },
  { key: "microorganisms", label: "Microorganisms", datasets: ["microorganisms"] },
  { key: "pharmacology", label: "Pharmacology", datasets: ["pharmacology"] }
];

export const SEARCH_GROUP_BY_DATASET = {
  anatomy: "anatomy",
  muscles: "anatomy",
  physiology: "physiology",
  diagnostic_methods: "diagnostics_procedures",
  procedures: "diagnostics_procedures",
  disease_and_symptoms: "disease_and_symptoms",
  lab_parameters: "lab_parameters",
  latin: "latin",
  microorganisms: "microorganisms",
  pharmacology: "pharmacology"
};

export const SEARCH_GROUP_LABEL_BY_KEY = Object.fromEntries(
  SEARCH_GROUP_DEFINITIONS.map((group) => [group.key, group.label])
);
export const SEARCH_GROUP_KEYS = SEARCH_GROUP_DEFINITIONS.map((group) => group.key);
export const ALL_SEARCH_DATASET_KEYS = [...new Set(SEARCH_GROUP_DEFINITIONS.flatMap((group) => group.datasets))];
export const SEARCH_LC_FIELDS = [
  "english_translation",
  "german_translation",
  "slovak_translation",
  "latin_translation",
  "abbreviation"
];

export const LAB_DATASET_KEY = "lab_parameters";
const LAB_DEFAULT_SYSTEM = "Uncategorized";

export const ALLOWED_TAGS = [
  "Complete blood count",
  "Inflammation",
  "Infection",
  "Renal",
  "Electrolytes",
  "Acid-base",
  "Metabolism",
  "Liver",
  "Lipids",
  "Endocrine",
  "Cardiac",
  "Coagulation",
  "Urinalysis",
  "Arterial blood gas",
  "ICU",
  "Oncology",
  "Autoimmune",
  "Toxicology",
  "Neurology",
  "Transfusion"
];

const TAG_NORMALIZATION_MAP = {
  CBC: "Complete blood count",
  Anemia: "Complete blood count",
  Hemolysis: "Complete blood count",
  "Iron studies": "Complete blood count",
  Deficiency: "Complete blood count",
  Hyperkalemia: "Electrolytes",
  Hyponatremia: "Electrolytes",
  Hypernatremia: "Electrolytes",
  AKI: "Renal",
  CKD: "Renal",
  Hydration: "Renal",
  ACS: "Cardiac",
  Arrhythmia: "Cardiac",
  "Heart failure": "Cardiac",
  ASCVD: "Cardiac",
  Bleeding: "Coagulation",
  Thrombosis: "Coagulation",
  DIC: "Coagulation",
  Thrombophilia: "Coagulation",
  Cholestasis: "Liver",
  "Liver injury": "Liver",
  Jaundice: "Liver",
  DKA: "Metabolism",
  Diabetes: "Metabolism",
  Gout: "Metabolism",
  "Metabolic syndrome": "Metabolism",
  Sepsis: "ICU",
  Shock: "ICU",
  Perfusion: "ICU",
  Meningitis: "Neurology",
  UTI: "Urinalysis",
  ABG: "Arterial blood gas",
  "Blood bank": "Transfusion"
};

function normalizeTags(rawTags) {
  if (!rawTags) return [];
  const normalized = String(rawTags)
    .split(";")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => TAG_NORMALIZATION_MAP[tag] || tag);
  return [...new Set(normalized.filter((tag) => ALLOWED_TAGS.includes(tag)))];
}

function normalizeLabRow(obj) {
  const system = String(obj.system || "").trim() || LAB_DEFAULT_SYSTEM;
  const tagLabels = normalizeTags(obj.tags);
  const tagKeys = tagLabels.map((tag) => tag.toLowerCase());
  return {
    ...obj,
    tags: tagLabels,
    system,
    __labSystem: system,
    __labSystemKey: system.toLowerCase(),
    __labTags: tagLabels,
    __labTagKeys: tagKeys,
    __labTagKeySet: new Set(tagKeys)
  };
}

function getSearchGroupKeyForDataset(datasetKey) {
  return SEARCH_GROUP_BY_DATASET[datasetKey] || datasetKey;
}

function buildLoadedMedicalRow(source, obj, headers) {
  const row = source.key === LAB_DATASET_KEY ? normalizeLabRow(obj) : obj;
  const lc = Object.fromEntries(SEARCH_LC_FIELDS.map((field) => [field, String(row[field] || "").toLowerCase()]));
  const groupKey = getSearchGroupKeyForDataset(source.key);
  return {
    ...row,
    __dataset: source.key,
    __group: groupKey,
    __datasetLabel: source.label,
    __groupLabel: SEARCH_GROUP_LABEL_BY_KEY[groupKey] || source.label,
    __sourceLabel: source.sourceLabel || source.label,
    __sourcePath: source.path,
    __headers: headers,
    __lc: lc,
    __lcHeaders: headers.filter(Boolean).map((header) => String(row[header] || "").toLowerCase())
  };
}

export function createMedicalDataRepository({
  loadText,
  parseCSVLines,
  rowsToObjectsWithHeaders,
  onLoadError = console.warn
}) {
  let medicalTerms = [];
  const datasetCache = new Map();
  const datasetLoadPromises = new Map();
  const loadedSourcePaths = new Set();

  async function loadMedicalSource(source) {
    if (loadedSourcePaths.has(source.path)) return datasetCache.get(source.path) || [];
    if (datasetLoadPromises.has(source.path)) return datasetLoadPromises.get(source.path);
    const work = (async () => {
      try {
        const rows = parseCSVLines(await loadText(source.path));
        const parsed = rows.length ? rowsToObjectsWithHeaders(rows) : { headers: [], objects: [] };
        const headers = (parsed.headers || []).filter(Boolean);
        const loadedRows = (parsed.objects || []).map((row) => buildLoadedMedicalRow(source, row, headers));
        datasetCache.set(source.path, loadedRows);
        loadedSourcePaths.add(source.path);
        medicalTerms.push(...loadedRows);
        return loadedRows;
      } catch (error) {
        onLoadError("Medical terms load failed for", `${source.path}:`, error?.message || error);
        datasetCache.set(source.path, []);
        loadedSourcePaths.add(source.path);
        return [];
      } finally {
        datasetLoadPromises.delete(source.path);
      }
    })();
    datasetLoadPromises.set(source.path, work);
    return work;
  }

  async function ensureMedicalDatasetsLoaded(datasetKeys) {
    const wantedKeys = [...new Set((datasetKeys || []).map((value) => String(value || "").trim()).filter(Boolean))];
    const sources = TERMINOLOGY_SOURCES.filter((source) => wantedKeys.includes(source.key));
    await Promise.all(sources.map(loadMedicalSource));
    return medicalTerms;
  }

  function getSearchGroupDefinition(groupKey) {
    return SEARCH_GROUP_DEFINITIONS.find((group) => group.key === groupKey) || null;
  }

  function getSearchDatasetKeysForSelection(groupKey) {
    if (groupKey === "all") return ALL_SEARCH_DATASET_KEYS.slice();
    return getSearchGroupDefinition(groupKey)?.datasets.slice() || [];
  }

  function isRowInSearchSelection(row, selectedGroup) {
    if (!row?.__group) return false;
    return selectedGroup === "all" ? SEARCH_GROUP_KEYS.includes(row.__group) : row.__group === selectedGroup;
  }

  function isSearchGroupLoaded(groupKey) {
    const group = getSearchGroupDefinition(groupKey);
    if (!group) return true;
    return TERMINOLOGY_SOURCES
      .filter((source) => group.datasets.includes(source.key))
      .every((source) => loadedSourcePaths.has(source.path));
  }

  async function loadMedicalTerms(options = {}) {
    if (options.clearCache) {
      medicalTerms = [];
      datasetCache.clear();
      datasetLoadPromises.clear();
      loadedSourcePaths.clear();
    }
    const datasetKeys = options.loadAll
      ? [...new Set(TERMINOLOGY_SOURCES.map((source) => source.key))]
      : (options.datasetKeys || []);
    return ensureMedicalDatasetsLoaded(datasetKeys);
  }

  return {
    getAllTerms: () => medicalTerms,
    getLoadedSearchRows: () => medicalTerms.filter((row) => row && SEARCH_GROUP_KEYS.includes(row.__group)),
    getSearchDatasetKeysForSelection,
    getSearchGroupDefinition,
    getSearchGroupKeyForDataset,
    isRowInSearchSelection,
    isSearchGroupLoaded,
    areAllSearchGroupsLoaded: () => SEARCH_GROUP_KEYS.every(isSearchGroupLoaded),
    ensureMedicalDatasetsLoaded,
    loadMedicalTerms
  };
}
