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
  { key: "basic_sciences", label: "Basic sciences", datasets: ["anatomy", "physiology"] },
  { key: "diagnostics_procedures", label: "Diagnostics & Procedures", datasets: ["diagnostic_methods", "procedures"] },
  { key: "disease_and_symptoms", label: "Diseases and symptoms", datasets: ["disease_and_symptoms"] },
  { key: "lab_parameters", label: "Laboratory parameters", datasets: ["lab_parameters"] },
  { key: "latin", label: "Latin", datasets: ["latin"] },
  { key: "microorganisms", label: "Microorganisms", datasets: ["microorganisms"] },
  { key: "pharmacology", label: "Pharmacology", datasets: ["pharmacology"] }
];

export const SEARCH_GROUP_BY_DATASET = {
  anatomy: "basic_sciences",
  physiology: "basic_sciences",
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
  const parsed = String(rawTags)
    .split(";")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
  const normalized = parsed.map((tag) => TAG_NORMALIZATION_MAP[tag] || tag);
  const filtered = normalized.filter((tag) => ALLOWED_TAGS.includes(tag));
  return [...new Set(filtered)];
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

function buildLowercaseCache(row, headers) {
  const lc = {};
  for (const field of SEARCH_LC_FIELDS) {
    lc[field] = String(row[field] || "").toLowerCase();
  }
  const lcHeaders = (headers || [])
    .filter(Boolean)
    .map((header) => String(row[header] || "").toLowerCase());
  return { lc, lcHeaders };
}

function buildLoadedMedicalRow(source, obj, headers) {
  const row = source.key === LAB_DATASET_KEY ? normalizeLabRow(obj) : obj;
  const { lc, lcHeaders } = buildLowercaseCache(row, headers);
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
    __lcHeaders: lcHeaders
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
    if (loadedSourcePaths.has(source.path)) {
      return datasetCache.get(source.path) || [];
    }
    const inFlight = datasetLoadPromises.get(source.path);
    if (inFlight) return inFlight;

    const work = (async () => {
      try {
        const txt = await loadText(source.path);
        const rows = parseCSVLines(txt);
        if (rows.length < 1) {
          datasetCache.set(source.path, []);
          loadedSourcePaths.add(source.path);
          return [];
        }
        const parsed = rowsToObjectsWithHeaders(rows);
        const headers = (parsed.headers || []).filter(Boolean);
        const loadedRows = (parsed.objects || []).map((obj) => buildLoadedMedicalRow(source, obj, headers));
        datasetCache.set(source.path, loadedRows);
        loadedSourcePaths.add(source.path);
        if (loadedRows.length > 0) {
          medicalTerms.push(...loadedRows);
        }
        return loadedRows;
      } catch (error) {
        onLoadError("Medical terms load failed for", `${source.path}:`, error && error.message ? error.message : error);
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
    if (wantedKeys.length === 0) return medicalTerms;
    const sources = TERMINOLOGY_SOURCES.filter((source) => wantedKeys.includes(source.key));
    if (sources.length === 0) return medicalTerms;
    await Promise.all(sources.map((source) => loadMedicalSource(source)));
    return medicalTerms;
  }

  function getSearchGroupDefinition(groupKey) {
    return SEARCH_GROUP_DEFINITIONS.find((group) => group.key === groupKey) || null;
  }

  function getSearchDatasetKeysForSelection(groupKey) {
    if (groupKey === "all") return ALL_SEARCH_DATASET_KEYS.slice();
    const definition = getSearchGroupDefinition(groupKey);
    return definition ? definition.datasets.slice() : [];
  }

  function isRowInSearchSelection(row, selectedGroup) {
    if (!row || !row.__group) return false;
    if (selectedGroup === "all") {
      return SEARCH_GROUP_KEYS.includes(row.__group);
    }
    return row.__group === selectedGroup;
  }

  function getLoadedSearchRows() {
    return medicalTerms.filter((row) => row && SEARCH_GROUP_KEYS.includes(row.__group));
  }

  function isSearchGroupLoaded(groupKey) {
    const group = getSearchGroupDefinition(groupKey);
    if (!group) return true;
    const sources = TERMINOLOGY_SOURCES.filter((source) => group.datasets.includes(source.key));
    return sources.every((source) => loadedSourcePaths.has(source.path));
  }

  function areAllSearchGroupsLoaded() {
    return SEARCH_GROUP_KEYS.every((groupKey) => isSearchGroupLoaded(groupKey));
  }

  async function loadMedicalTerms(options = {}) {
    const opts = options || {};
    if (opts.clearCache) {
      medicalTerms = [];
      datasetCache.clear();
      datasetLoadPromises.clear();
      loadedSourcePaths.clear();
    }
    const datasetKeys = opts.loadAll
      ? [...new Set(TERMINOLOGY_SOURCES.map((source) => source.key))]
      : (opts.datasetKeys || []);
    return ensureMedicalDatasetsLoaded(datasetKeys);
  }

  return {
    getAllTerms() {
      return medicalTerms;
    },
    getLoadedSearchRows,
    getSearchDatasetKeysForSelection,
    getSearchGroupDefinition,
    getSearchGroupKeyForDataset,
    isRowInSearchSelection,
    isSearchGroupLoaded,
    areAllSearchGroupsLoaded,
    ensureMedicalDatasetsLoaded,
    loadMedicalTerms
  };
}

const PHARMACOLOGY_CODES_FILE_CANDIDATES = [
  "terminology/pharmacology/atc_codes.csv",
  "atc_codes.csv"
];
const PHARMACOLOGY_REFERENCE_FILE_CANDIDATES = [
  "terminology/pharmacology/atc_reference.csv",
  "atc_reference.csv"
];
const PHARMACOLOGY_DESCRIPTION_FILE_CANDIDATES = [
  "terminology/pharmacology/atc_description.csv",
  "atc_description.csv"
];

function normalizeAtcCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function splitAtcCodes(value) {
  return String(value || "")
    .split(/[;,|]/)
    .map((part) => normalizeAtcCode(part))
    .filter(Boolean);
}

function scoreSearchValue(normalizeSearchText, value, query, exactScore, prefixScore, containsScore) {
  const normalizedValue = normalizeSearchText(value);
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedValue || !normalizedQuery) return 0;
  if (normalizedValue === normalizedQuery) return exactScore;
  if (normalizedValue.startsWith(normalizedQuery)) return prefixScore;
  if (normalizedValue.includes(normalizedQuery)) return containsScore;
  return 0;
}

export function createPharmacologyRepository({
  loadText,
  parseCSVLines,
  rowsToObjects,
  normalizeSearchText,
  toFileSafeName,
  onLoadError = console.warn
}) {
  let pharmacologyRecords = [];
  let pharmacologyByDrugId = new Map();
  let atcReferenceByCode = new Map();
  let atcReferenceChildrenByParent = new Map();
  let pharmacologyDescriptionsByDrugId = new Map();

  const state = {
    loaded: false,
    failed: false,
    loadPromise: null
  };

  function getAtcHierarchy(atcCode) {
    const normalizedCode = normalizeAtcCode(atcCode);
    if (!normalizedCode) return [];
    const candidateCodes = [
      normalizedCode.slice(0, 1),
      normalizedCode.slice(0, 3),
      normalizedCode.slice(0, 4),
      normalizedCode.slice(0, 5),
      normalizedCode.slice(0, 7)
    ].filter((code, index, list) => code && list.indexOf(code) === index);

    const chain = [];
    for (const code of candidateCodes) {
      const row = atcReferenceByCode.get(code);
      if (row) chain.push(row);
    }
    return chain;
  }

  function buildFallbackDrugId(row) {
    const base = String(
      (row && (row.drug_id || row.english_name || row.slovak_name || row.atc_primary || row.atc_code)) || ""
    ).trim();
    return `drug_${toFileSafeName(base || "unknown_drug")}`;
  }

  function getAtcLevelNumber(value) {
    const level = Number(value);
    return Number.isFinite(level) ? level : 0;
  }

  async function loadFirstAvailableCsv(candidatePaths) {
    let lastError = null;
    for (const path of candidatePaths) {
      try {
        const txt = await loadText(path);
        const rows = parseCSVLines(txt || "");
        if (rows.length < 1) continue;
        return rowsToObjects(rows);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("CSV file could not be loaded");
  }

  function buildPharmacologyIndex(atcCodeRows, atcReferenceRows, atcDescriptionRows) {
    pharmacologyRecords = [];
    pharmacologyByDrugId = new Map();
    atcReferenceByCode = new Map();
    atcReferenceChildrenByParent = new Map();
    pharmacologyDescriptionsByDrugId = new Map();

    const descriptionIdByName = new Map();
    for (const refRow of atcReferenceRows || []) {
      const code = normalizeAtcCode(refRow && refRow.atc_code);
      if (!code) continue;
      const normalizedRef = {
        ...refRow,
        atc_code: code,
        parent_code: normalizeAtcCode(refRow && refRow.parent_code)
      };
      atcReferenceByCode.set(code, normalizedRef);
      const level = getAtcLevelNumber(normalizedRef.level);
      if (level > 0 && level < 5) {
        const parentKey = normalizedRef.parent_code;
        const siblings = atcReferenceChildrenByParent.get(parentKey) || [];
        siblings.push(normalizedRef);
        atcReferenceChildrenByParent.set(parentKey, siblings);
      }
    }
    for (const children of atcReferenceChildrenByParent.values()) {
      children.sort((left, right) => String(left.atc_code || "").localeCompare(String(right.atc_code || "")));
    }

    for (const rawDesc of atcDescriptionRows || []) {
      const resolvedId = String(rawDesc && rawDesc.drug_id || "").trim() || buildFallbackDrugId(rawDesc);
      const descRow = { ...rawDesc, drug_id: resolvedId };
      pharmacologyDescriptionsByDrugId.set(resolvedId, descRow);
      for (const name of [descRow.english_name, descRow.slovak_name]) {
        const key = normalizeSearchText(name);
        if (key && !descriptionIdByName.has(key)) {
          descriptionIdByName.set(key, resolvedId);
        }
      }
    }

    const materializeRecord = (codeRow, descRow) => {
      const merged = { ...(codeRow || {}), ...(descRow || {}) };
      const drugId = String(merged.drug_id || "").trim() || buildFallbackDrugId(merged);
      const englishName = String(merged.english_name || "").trim();
      const slovakName = String(merged.slovak_name || "").trim();
      const atcPrimary = normalizeAtcCode(merged.atc_primary || merged.atc_code);
      const atcAll = [...new Set([atcPrimary, ...splitAtcCodes(merged.atc_all)].filter(Boolean))];
      const hierarchy = getAtcHierarchy(atcPrimary);
      const record = {
        type: "pharmacology",
        drug_id: drugId,
        english_name: englishName,
        slovak_name: slovakName,
        atc_primary: atcPrimary,
        atc_all: atcAll,
        atc_hierarchy: hierarchy.map((item) => ({
          atc_code: String(item && item.atc_code || "").trim(),
          atc_name: String(item && item.atc_name || "").trim(),
          parent_code: String(item && item.parent_code || "").trim(),
          level: String(item && item.level || "").trim()
        })),
        mechanism_of_action: String(merged.mechanism_of_action || "").trim(),
        indications: String(merged.indications || "").trim(),
        routes_of_administration: String(merged.routes_of_administration || "").trim(),
        standard_dose: String(merged.standard_dose || "").trim(),
        contraindications_absolute: String(merged.contraindications_absolute || "").trim(),
        contraindications_relative: String(merged.contraindications_relative || "").trim(),
        adverse_effects: String(merged.adverse_effects || "").trim(),
        major_interactions: String(merged.major_interactions || "").trim(),
        antidote_or_reversal: String(merged.antidote_or_reversal || "").trim(),
        half_life: String(merged.half_life || "").trim(),
        metabolism: String(merged.metabolism || "").trim(),
        elimination: String(merged.elimination || "").trim(),
        score: 0
      };
      pharmacologyByDrugId.set(drugId, record);
      pharmacologyRecords.push(record);
    };

    const seenIds = new Set();
    for (const rawCode of atcCodeRows || []) {
      const resolvedId =
        String(rawCode && rawCode.drug_id || "").trim() ||
        descriptionIdByName.get(normalizeSearchText(rawCode && rawCode.english_name)) ||
        descriptionIdByName.get(normalizeSearchText(rawCode && rawCode.slovak_name)) ||
        buildFallbackDrugId(rawCode);
      const normalizedCodeRow = { ...rawCode, drug_id: resolvedId };
      const descRow =
        pharmacologyDescriptionsByDrugId.get(resolvedId) ||
        pharmacologyDescriptionsByDrugId.get(descriptionIdByName.get(normalizeSearchText(rawCode && rawCode.english_name))) ||
        pharmacologyDescriptionsByDrugId.get(descriptionIdByName.get(normalizeSearchText(rawCode && rawCode.slovak_name)));
      materializeRecord(normalizedCodeRow, descRow || null);
      seenIds.add(resolvedId);
    }

    for (const [drugId, descRow] of pharmacologyDescriptionsByDrugId.entries()) {
      if (seenIds.has(drugId)) continue;
      materializeRecord(null, descRow);
    }

    pharmacologyRecords.sort((left, right) =>
      String(left.english_name || left.drug_id).localeCompare(String(right.english_name || right.drug_id))
    );
    return pharmacologyRecords;
  }

  function search(query) {
    if (!state.loaded || pharmacologyRecords.length === 0) return [];
    const normalizedQuery = normalizeSearchText(query);
    const normalizedCodeQuery = normalizeAtcCode(query);
    const resultsByDrugId = new Map();

    const addHit = (row, score) => {
      if (!row || !row.drug_id || score <= 0) return;
      const existing = resultsByDrugId.get(row.drug_id);
      if (!existing || score > existing.score) {
        resultsByDrugId.set(row.drug_id, { kind: "pharmacology", row, score });
      }
    };

    for (const record of pharmacologyRecords) {
      let score = 0;
      score = Math.max(score, scoreSearchValue(normalizeSearchText, record.english_name, normalizedQuery, 100, 80, 60));
      score = Math.max(score, scoreSearchValue(normalizeSearchText, record.slovak_name, normalizedQuery, 100, 80, 60));
      score = Math.max(score, scoreSearchValue(normalizeSearchText, record.drug_id, normalizedQuery, 85, 70, 55));
      const allCodes = [record.atc_primary, ...(record.atc_all || [])].filter(Boolean);
      for (const code of allCodes) {
        const normalizedCode = normalizeAtcCode(code);
        if (!normalizedCode || !normalizedCodeQuery) continue;
        if (normalizedCode === normalizedCodeQuery) {
          score = Math.max(score, 90);
        } else if (normalizedCode.startsWith(normalizedCodeQuery)) {
          score = Math.max(score, 75);
        }
      }
      score = Math.max(score, scoreSearchValue(normalizeSearchText, record.mechanism_of_action, normalizedQuery, 30, 30, 30));
      score = Math.max(score, scoreSearchValue(normalizeSearchText, record.indications, normalizedQuery, 30, 30, 30));
      addHit(record, score);
    }

    return [...resultsByDrugId.values()].sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return String(left.row.english_name || left.row.drug_id).localeCompare(
        String(right.row.english_name || right.row.drug_id)
      );
    });
  }

  async function ensureLoaded(options = {}) {
    const opts = options || {};
    if (opts.clearCache) {
      state.loaded = false;
      state.failed = false;
      state.loadPromise = null;
      pharmacologyRecords = [];
      pharmacologyByDrugId = new Map();
      atcReferenceByCode = new Map();
      atcReferenceChildrenByParent = new Map();
      pharmacologyDescriptionsByDrugId = new Map();
    }
    if (state.loaded) return pharmacologyRecords;
    if (state.loadPromise) return state.loadPromise;
    state.loadPromise = (async () => {
      try {
        const [codes, refs, descs] = await Promise.all([
          loadFirstAvailableCsv(PHARMACOLOGY_CODES_FILE_CANDIDATES),
          loadFirstAvailableCsv(PHARMACOLOGY_REFERENCE_FILE_CANDIDATES),
          loadFirstAvailableCsv(PHARMACOLOGY_DESCRIPTION_FILE_CANDIDATES)
        ]);
        buildPharmacologyIndex(codes, refs, descs);
        state.loaded = true;
        state.failed = false;
        return pharmacologyRecords;
      } catch (error) {
        state.failed = true;
        onLoadError("Pharmacology index load failed:", error && error.message ? error.message : error);
        return [];
      } finally {
        state.loadPromise = null;
      }
    })();
    return state.loadPromise;
  }

  return {
    state,
    ensureLoaded,
    getAtcChildren(parentCode) {
      return atcReferenceChildrenByParent.get(normalizeAtcCode(parentCode)) || [];
    },
    getAtcFilterLabel(atcCode) {
      const node = atcReferenceByCode.get(normalizeAtcCode(atcCode));
      if (!node) return normalizeAtcCode(atcCode);
      return [node.atc_code, node.atc_name].filter(Boolean).join(" - ");
    },
    getDrugRecord(drugId) {
      return pharmacologyByDrugId.get(String(drugId || "").trim()) || null;
    },
    getRecords() {
      return pharmacologyRecords;
    },
    search
  };
}
