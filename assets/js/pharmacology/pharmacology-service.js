export const PHARMACOLOGY_DATA_PATH = "pharmacology_database_test.json";

export const SEARCH_WEIGHTS = Object.freeze({
  exactName: 100,
  normalizedName: 95,
  synonym: 90,
  exactAtc: 90,
  namePrefix: 80,
  classMatch: 60,
  mechanismMatch: 55,
  indicationMatch: 50,
  adverseEffectMatch: 40,
  contraindicationMatch: 35,
  interactionMatch: 35,
  metabolismMatch: 32,
  eliminationMatch: 30,
  generalTextMatch: 20,
  fuzzyNameMatch: 18
});

const CLINICAL_QUERY_FILLER = new Set([
  "a",
  "an",
  "and",
  "associated",
  "causing",
  "cause",
  "causes",
  "drug",
  "drugs",
  "for",
  "in",
  "medication",
  "medications",
  "of",
  "the",
  "that",
  "to",
  "treat",
  "used",
  "with"
]);

const textOf = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(" ");
  if (typeof value === "object") return Object.values(value).map(textOf).filter(Boolean).join(" ");
  return "";
};

const listOf = (value) => {
  if (!Array.isArray(value)) return value === null || value === undefined || value === "" ? [] : [value];
  return value.filter((item) => item !== null && item !== undefined && item !== "");
};

const uniqueStrings = (values) => [...new Set(
  listOf(values)
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => textOf(value))
    .filter(Boolean)
)];

export function normalizePharmacologyText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/[^a-z0-9+\-/% ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeAtcCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function clinicalQuery(value) {
  const normalized = normalizePharmacologyText(value);
  const useful = normalized.split(" ").filter((token) => token && !CLINICAL_QUERY_FILLER.has(token));
  return useful.length ? useful.join(" ") : normalized;
}

function getEnglishName(record) {
  return textOf(record?.names?.english?.source_value || record?.names?.english?.normalized || record?.id);
}

function getSlovakName(record) {
  return textOf(record?.names?.slovak?.verified_value || record?.names?.slovak?.source_value);
}

function getSynonyms(record) {
  return uniqueStrings([
    record?.names?.synonyms,
    record?.names?.international_nonproprietary_name,
    record?.names?.common_abbreviations
  ]);
}

function getAtcCodes(record) {
  return uniqueStrings([
    record?.atc?.primary_code,
    record?.atc?.combined_atc_codes,
    record?.atc?.source_additional_codes,
    listOf(record?.atc?.classifications).map((item) => item?.atc_code)
  ]).map(normalizeAtcCode).filter(Boolean);
}

function getAtcPath(record) {
  const hierarchy = record?.atc?.primary_hierarchy || {};
  return ["level_1", "level_2", "level_3", "level_4", "level_5"]
    .map((key, index) => {
      const item = hierarchy?.[key];
      if (!item?.code && !item?.name) return null;
      return {
        code: normalizeAtcCode(item.code),
        name: textOf(item.name),
        level: index + 1
      };
    })
    .filter(Boolean);
}

function getMechanisms(record) {
  return listOf(record?.pharmacology?.mechanisms_of_action);
}

function getIndications(record) {
  return [
    ...listOf(record?.clinical_uses?.approved_indications),
    ...listOf(record?.clinical_uses?.common_off_label_uses)
  ];
}

function getInteractionRows(record) {
  const interactions = record?.interactions || {};
  return [
    ...listOf(interactions.drug_drug),
    ...listOf(interactions.drug_food),
    ...listOf(interactions.drug_disease),
    ...listOf(interactions.drug_laboratory),
    ...listOf(interactions.pharmacogenomic)
  ];
}

function isUnavailableStatement(value) {
  const normalized = normalizePharmacologyText(value);
  return !normalized || normalized.includes("not verified") || normalized.includes("not available");
}

function hasDosingData(record) {
  return listOf(record?.administration?.representative_dosing).some((row) => {
    const dose = row?.dose || {};
    return [
      dose.value,
      dose.minimum,
      dose.maximum,
      dose.unit,
      row?.frequency,
      row?.maximum_dose,
      row?.route,
      row?.formulation
    ].some((value) => value !== null && value !== undefined && String(value).trim() !== "");
  });
}

function hasPharmacokineticData(record) {
  const pk = record?.pharmacokinetics || {};
  const concreteValues = [
    pk?.bioavailability?.value,
    pk?.bioavailability?.range,
    pk?.time_to_peak,
    pk?.onset,
    pk?.duration,
    pk?.half_life?.value,
    pk?.half_life?.range,
    pk?.protein_binding_percent,
    pk?.volume_of_distribution,
    pk?.dialyzability
  ];
  if (concreteValues.some((value) => value !== null && value !== undefined && textOf(value))) return true;
  return [
    pk?.metabolism?.summary,
    pk?.elimination?.summary,
    pk?.pharmacokinetic_notes
  ].some((value) => !isUnavailableStatement(value));
}

export function getEvidenceCategory(record) {
  const sources = listOf(record?.evidence?.sources);
  const inferences = listOf(record?.data_quality?.inferences);
  const hasClassInference =
    sources.some((source) => /class-derived|class level|atc class/i.test(textOf(source))) ||
    inferences.some((item) => String(item?.field || "").includes("class_level_pharmacology"));
  const hasSubstanceSource = sources.some((source) => {
    const type = normalizePharmacologyText(source?.source_type);
    return ["regulatory label", "guideline", "peer reviewed", "drug monograph"].some((kind) => type.includes(kind));
  });
  return hasClassInference && !hasSubstanceSource ? "class-derived" : "substance-specific";
}

function indexRecord(record) {
  const englishName = getEnglishName(record);
  const normalizedName = textOf(record?.names?.english?.normalized || englishName);
  const slovakName = getSlovakName(record);
  const synonyms = getSynonyms(record);
  const atcCodes = getAtcCodes(record);
  const atcPath = getAtcPath(record);
  const mechanisms = getMechanisms(record);
  const indications = getIndications(record);
  const adverse = record?.adverse_effects || {};
  const contraindications = record?.contraindications_and_precautions || {};
  const interactions = getInteractionRows(record);
  const metabolism = record?.pharmacokinetics?.metabolism || {};
  const elimination = record?.pharmacokinetics?.elimination || {};
  const therapeuticClasses = uniqueStrings(record?.pharmacology?.therapeutic_class);
  const chemicalClasses = uniqueStrings(record?.pharmacology?.chemical_class);
  const routes = uniqueStrings(record?.administration?.routes);
  const dosageForms = uniqueStrings(record?.administration?.dosage_forms);

  const normalized = {
    englishName: normalizePharmacologyText(englishName),
    normalizedName: normalizePharmacologyText(normalizedName),
    slovakName: normalizePharmacologyText(slovakName),
    synonyms: synonyms.map(normalizePharmacologyText),
    atcCodes: atcCodes.map(normalizeAtcCode),
    atcNames: normalizePharmacologyText(atcPath.map((item) => item.name).join(" ")),
    classes: normalizePharmacologyText([...therapeuticClasses, ...chemicalClasses].join(" ")),
    mechanism: normalizePharmacologyText([
      record?.pharmacology?.summary,
      mechanisms.map((item) => [item?.description, item?.target, item?.target_type, item?.action, item?.pathway])
    ]),
    indications: normalizePharmacologyText(indications.map((item) => [item?.indication || item, item?.notes])),
    administration: normalizePharmacologyText([routes, dosageForms]),
    adverse: normalizePharmacologyText([
      adverse.common,
      adverse.serious,
      adverse.rare,
      adverse.dose_related,
      adverse.class_effects,
      adverse.withdrawal_or_rebound,
      adverse.toxicity_profile
    ]),
    contraindications: normalizePharmacologyText([
      contraindications.absolute_contraindications,
      contraindications.relative_contraindications,
      contraindications.warnings_and_precautions,
      contraindications.boxed_warnings,
      contraindications.pregnancy,
      contraindications.lactation
    ]),
    interactions: normalizePharmacologyText(interactions),
    metabolism: normalizePharmacologyText([metabolism.summary, metabolism.enzymes, metabolism.organ, metabolism.active_metabolites]),
    elimination: normalizePharmacologyText(elimination),
    general: ""
  };
  normalized.general = [
    normalized.englishName,
    normalized.normalizedName,
    normalized.slovakName,
    ...normalized.synonyms,
    ...normalized.atcCodes.map((code) => code.toLowerCase()),
    normalized.atcNames,
    normalized.classes,
    normalized.mechanism,
    normalized.indications,
    normalized.administration,
    normalized.adverse,
    normalized.contraindications,
    normalized.interactions,
    normalized.metabolism,
    normalized.elimination
  ].filter(Boolean).join(" ");

  return {
    id: textOf(record?.id),
    record,
    englishName,
    normalizedName,
    slovakName,
    synonyms,
    atcCodes,
    atcPath,
    primaryAtcCode: normalizeAtcCode(record?.atc?.primary_code),
    therapeuticClasses,
    chemicalClasses,
    routes,
    dosageForms,
    evidenceCategory: getEvidenceCategory(record),
    confidence: textOf(record?.data_quality?.confidence).toLowerCase(),
    recordType: textOf(record?.record_type),
    requiresHumanReview: record?.data_quality?.requires_human_review === true,
    hasDosing: hasDosingData(record),
    hasPharmacokinetics: hasPharmacokineticData(record),
    normalized
  };
}

function boundedLevenshtein(left, right, limit = 2) {
  const a = String(left || "");
  const b = String(right || "");
  if (!a || !b) return limit + 1;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMinimum = current[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
      rowMinimum = Math.min(rowMinimum, current[j]);
    }
    if (rowMinimum > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

function includesQuery(value, query) {
  return !!value && !!query && value.includes(query);
}

function tokenCoverage(value, query) {
  const tokens = String(query || "").split(" ").filter((token) => token.length > 1);
  if (!tokens.length || !value) return 0;
  const matched = tokens.filter((token) => value.includes(token)).length;
  return matched / tokens.length;
}

function scoreIndexedRecord(item, rawQuery, mode = "drug") {
  const query = mode === "clinical" ? clinicalQuery(rawQuery) : normalizePharmacologyText(rawQuery);
  const atcQuery = normalizeAtcCode(rawQuery);
  if (!query && !atcQuery) return null;

  const n = item.normalized;
  const matchedFields = [];
  let score = 0;
  const add = (field, points) => {
    if (points <= score) {
      if (points > 0 && !matchedFields.includes(field)) matchedFields.push(field);
      return;
    }
    score = points;
    if (!matchedFields.includes(field)) matchedFields.push(field);
  };

  if (mode !== "clinical") {
    if (n.englishName === query) add("English name", SEARCH_WEIGHTS.exactName);
    if (n.normalizedName === query) add("Normalized name", SEARCH_WEIGHTS.normalizedName);
    if ([n.slovakName, ...n.synonyms].some((value) => value === query)) add("Synonym or abbreviation", SEARCH_WEIGHTS.synonym);
    if (atcQuery && n.atcCodes.includes(atcQuery)) add("ATC code", SEARCH_WEIGHTS.exactAtc);
    if ([n.englishName, n.normalizedName, n.slovakName, ...n.synonyms].some((value) => value.startsWith(query))) {
      add("Name prefix", SEARCH_WEIGHTS.namePrefix);
    }
  }

  if (includesQuery(n.classes, query) || includesQuery(n.atcNames, query)) add("Therapeutic class", SEARCH_WEIGHTS.classMatch);
  if (includesQuery(n.mechanism, query)) add("Mechanism or target", SEARCH_WEIGHTS.mechanismMatch);
  if (includesQuery(n.indications, query)) add("Indication", SEARCH_WEIGHTS.indicationMatch);
  if (includesQuery(n.adverse, query)) add("Adverse effect", SEARCH_WEIGHTS.adverseEffectMatch);
  if (includesQuery(n.contraindications, query)) add("Contraindication", SEARCH_WEIGHTS.contraindicationMatch);
  if (includesQuery(n.interactions, query)) add("Interaction", SEARCH_WEIGHTS.interactionMatch);
  if (includesQuery(n.metabolism, query)) add("Metabolism", SEARCH_WEIGHTS.metabolismMatch);
  if (includesQuery(n.elimination, query)) add("Elimination", SEARCH_WEIGHTS.eliminationMatch);

  const coverage = tokenCoverage(n.general, query);
  if (!score && coverage === 1) add("Full text", SEARCH_WEIGHTS.generalTextMatch);
  else if (!score && coverage >= 0.6) add("Related terms", Math.round(SEARCH_WEIGHTS.generalTextMatch * coverage));

  if (!score && mode !== "clinical" && !query.includes(" ") && query.length >= 4) {
    const candidates = [n.englishName, n.normalizedName, ...n.synonyms].filter(Boolean);
    const fuzzyLimit = query.length >= 8 ? 2 : 1;
    if (candidates.some((candidate) => boundedLevenshtein(candidate, query, fuzzyLimit) <= fuzzyLimit)) {
      add("Similar name", SEARCH_WEIGHTS.fuzzyNameMatch);
    }
  }

  return score > 0 ? { item, score, matchedFields, query } : null;
}

function matchesFilters(item, filters = {}) {
  if (filters.atcLevel1 && item.atcPath[0]?.code !== filters.atcLevel1) return false;
  if (filters.atcLevel2 && item.atcPath[1]?.code !== filters.atcLevel2) return false;
  if (filters.therapeuticClass && !item.therapeuticClasses.includes(filters.therapeuticClass)) return false;
  if (filters.recordType && item.recordType !== filters.recordType) return false;
  if (filters.evidenceCategory && item.evidenceCategory !== filters.evidenceCategory) return false;
  if (filters.confidence && item.confidence !== filters.confidence) return false;
  if (filters.route && !item.routes.includes(filters.route)) return false;
  if (filters.hasDosing === true && !item.hasDosing) return false;
  if (filters.hasPharmacokinetics === true && !item.hasPharmacokinetics) return false;
  if (filters.requiresHumanReview === true && !item.requiresHumanReview) return false;
  if (filters.requiresHumanReview === false && item.requiresHumanReview) return false;
  if (filters.atcPrefix && !item.atcCodes.some((code) => code.startsWith(normalizeAtcCode(filters.atcPrefix)))) return false;
  return true;
}

function sortOptions(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function buildAtcTree(items) {
  const roots = new Map();
  for (const item of items) {
    let siblings = roots;
    for (const step of item.atcPath.slice(0, 5)) {
      if (!step.code) continue;
      if (!siblings.has(step.code)) {
        siblings.set(step.code, {
          ...step,
          children: new Map(),
          drugIds: new Set()
        });
      }
      const node = siblings.get(step.code);
      node.drugIds.add(item.id);
      siblings = node.children;
    }
  }
  const materialize = (nodes) => [...nodes.values()]
    .sort((left, right) => left.code.localeCompare(right.code))
    .map((node) => ({
      code: node.code,
      name: node.name,
      level: node.level,
      count: node.drugIds.size,
      drugIds: [...node.drugIds],
      children: materialize(node.children)
    }));
  return materialize(roots);
}

function getMechanismSummary(record) {
  return textOf(record?.pharmacology?.summary) ||
    textOf(listOf(record?.pharmacology?.mechanisms_of_action)[0]?.description);
}

function indicationLabels(record) {
  return uniqueStrings(getIndications(record).map((item) => item?.indication || item));
}

function interactionLabels(record) {
  return uniqueStrings(getInteractionRows(record).map((item) => item?.interacting_agent_or_class || item?.clinical_effect || item));
}

function dosingLabels(record) {
  return uniqueStrings(listOf(record?.administration?.representative_dosing).map((row) => {
    const dose = row?.dose || {};
    const amount = [dose.value ?? dose.minimum, dose.unit].filter((value) => value !== null && value !== undefined && value !== "").join(" ");
    return [row?.indication, amount, row?.frequency, row?.route].filter(Boolean).join(": ");
  }));
}

export function createPharmacologyService({
  loadText,
  dataPath = PHARMACOLOGY_DATA_PATH,
  expectedRecordCount = 1000,
  onError = console.error
} = {}) {
  if (typeof loadText !== "function") throw new TypeError("createPharmacologyService requires loadText(path)");

  let database = null;
  let items = [];
  let drugById = new Map();
  let atcTree = [];
  let facets = null;

  const state = {
    loaded: false,
    failed: false,
    loadPromise: null,
    recordCount: 0
  };

  function buildFacets() {
    facets = {
      atcLevel1: sortOptions(items.map((item) => item.atcPath[0]?.code)),
      atcLevel2: sortOptions(items.map((item) => item.atcPath[1]?.code)),
      therapeuticClasses: sortOptions(items.flatMap((item) => item.therapeuticClasses)),
      recordTypes: sortOptions(items.map((item) => item.recordType)),
      evidenceCategories: ["substance-specific", "class-derived"],
      confidence: sortOptions(items.map((item) => item.confidence)),
      routes: sortOptions(items.flatMap((item) => item.routes))
    };
  }

  function buildIndex(payload) {
    if (!payload || !Array.isArray(payload.drugs)) throw new Error("Pharmacology JSON must contain a drugs array.");
    if (expectedRecordCount && payload.drugs.length !== expectedRecordCount) {
      throw new Error(`Expected ${expectedRecordCount} pharmacology records, received ${payload.drugs.length}.`);
    }
    const ids = payload.drugs.map((record) => textOf(record?.id));
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
      throw new Error("Every pharmacology record must have a unique non-empty ID.");
    }
    database = payload;
    items = payload.drugs.map(indexRecord);
    drugById = new Map(items.map((item) => [item.id, item]));
    atcTree = buildAtcTree(items);
    buildFacets();
    state.recordCount = items.length;
    return payload.drugs;
  }

  async function ensureLoaded({ clearCache = false } = {}) {
    if (clearCache) {
      database = null;
      items = [];
      drugById = new Map();
      atcTree = [];
      facets = null;
      state.loaded = false;
      state.failed = false;
      state.loadPromise = null;
      state.recordCount = 0;
    }
    if (state.loaded) return database?.drugs || [];
    if (state.loadPromise) return state.loadPromise;
    state.loadPromise = (async () => {
      try {
        const payload = JSON.parse(await loadText(dataPath));
        const records = buildIndex(payload);
        state.loaded = true;
        state.failed = false;
        return records;
      } catch (error) {
        state.failed = true;
        onError("Pharmacology database load failed:", error);
        throw error;
      } finally {
        state.loadPromise = null;
      }
    })();
    return state.loadPromise;
  }

  function searchDrugs(query, filters = {}, options = {}) {
    if (!state.loaded) return [];
    const mode = options.mode || "drug";
    const limit = Number.isFinite(options.limit) ? options.limit : Number.POSITIVE_INFINITY;
    const queryText = String(query || "").trim();
    const candidates = items.filter((item) => matchesFilters(item, filters));
    const scored = queryText
      ? candidates.map((item) => scoreIndexedRecord(item, queryText, mode)).filter(Boolean)
      : candidates.map((item) => ({ item, score: 0, matchedFields: [] }));
    return scored
      .sort((left, right) => right.score - left.score || left.item.englishName.localeCompare(right.item.englishName))
      .slice(0, limit)
      .map((result) => ({
        id: result.item.id,
        record: result.item.record,
        index: result.item,
        score: result.score,
        matchedFields: result.matchedFields
      }));
  }

  function getDrugById(id) {
    return drugById.get(String(id || "").trim())?.record || null;
  }

  function searchField(term, field, limit = 100) {
    const query = normalizePharmacologyText(term);
    if (!query) return [];
    return items
      .filter((item) => item.normalized[field]?.includes(query))
      .slice(0, limit)
      .map((item) => item.record);
  }

  function buildDrugContext(id) {
    const record = getDrugById(id);
    if (!record) return null;
    const evidenceCategory = getEvidenceCategory(record);
    return {
      id: record.id,
      name: getEnglishName(record),
      atcCode: normalizeAtcCode(record?.atc?.primary_code),
      evidenceCategory,
      confidence: textOf(record?.data_quality?.confidence) || "Not available",
      classDerived: evidenceCategory === "class-derived",
      mechanism: getMechanismSummary(record) || "Not available",
      therapeuticClass: uniqueStrings(record?.pharmacology?.therapeutic_class),
      indications: indicationLabels(record),
      adverseEffects: {
        common: uniqueStrings(record?.adverse_effects?.common),
        serious: uniqueStrings(record?.adverse_effects?.serious)
      },
      contraindications: uniqueStrings([
        record?.contraindications_and_precautions?.absolute_contraindications,
        record?.contraindications_and_precautions?.relative_contraindications
      ]),
      interactions: interactionLabels(record),
      dosing: hasDosingData(record) ? dosingLabels(record) : ["Not available"],
      dosingDisclaimer: "Representative educational dosing only. Verify the current product label and individual patient requirements.",
      halfLife: textOf(record?.pharmacokinetics?.half_life) || "Not available",
      metabolism: textOf(record?.pharmacokinetics?.metabolism?.summary) || "Not available",
      elimination: textOf(record?.pharmacokinetics?.elimination?.summary) || "Not available"
    };
  }

  function compareDrugs(ids) {
    return uniqueStrings(ids).slice(0, 3).map(buildDrugContext).filter(Boolean);
  }

  return {
    state,
    ensureLoaded,
    searchDrugs,
    getDrugById,
    getDrugsByAtcCode(code) {
      const normalized = normalizeAtcCode(code);
      return items.filter((item) => item.atcCodes.some((atc) => atc.startsWith(normalized))).map((item) => item.record);
    },
    getDrugsByTherapeuticClass(className) {
      const query = normalizePharmacologyText(className);
      return items.filter((item) => item.normalized.classes.includes(query)).map((item) => item.record);
    },
    getDrugsByMechanism(term) {
      return searchField(term, "mechanism");
    },
    getDrugsByAdverseEffect(term) {
      return searchField(term, "adverse");
    },
    getDrugsByInteraction(term) {
      return searchField(term, "interactions");
    },
    compareDrugs,
    buildDrugContext,
    getAtcTree() {
      return atcTree;
    },
    getFacets() {
      return facets;
    },
    getDatasetSummary() {
      const sourceBacked = items.filter((item) => item.evidenceCategory === "substance-specific").length;
      return {
        schemaVersion: textOf(database?.schema_version),
        recordCount: items.length,
        substanceSpecificCount: sourceBacked,
        classDerivedCount: items.length - sourceBacked,
        generatedAt: textOf(database?.dataset?.generated_at),
        disclaimer: textOf(database?.dataset?.medical_disclaimer)
      };
    },
    getIndexedRecord(id) {
      return drugById.get(String(id || "").trim()) || null;
    },
    getAllRecords() {
      return items.map((item) => item.record);
    }
  };
}
