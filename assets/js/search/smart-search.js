const QUESTION_PREFIX = /^(what|which|who|where|when|why|how|list|name|show|give|tell|define|identify|aké|ake|ktoré|ktore|čo|co|kde|kedy|prečo|preco|ako|vymenuj|uveď|uved|welche|welcher|welches|was|wer|wo|wann|warum|wie|nenne|nenn|liste)\b/i;

export function normalizeSmartText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/[^a-z0-9+\-/% ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function looksLikeSmartQuestion(value) {
  const raw = String(value || "").trim();
  const normalized = normalizeSmartText(raw);
  return raw.includes("?") || QUESTION_PREFIX.test(normalized) || /\b(what are|which are|what is|which drugs|which muscles|normal range|reference range)\b/i.test(raw);
}

const ACTIONS = [
  { key: "abduct", words: ["abduct", "abduction", "abductor", "abductors"] },
  { key: "adduct", words: ["adduct", "adduction", "adductor", "adductors"] },
  { key: "flex", words: ["flex", "flexion", "flexor", "flexors"] },
  { key: "extend", words: ["extend", "extension", "extensor", "extensors"] },
  { key: "rotate", words: ["rotate", "rotation", "rotator", "rotators"] },
  { key: "elevat", words: ["elevate", "elevation", "elevator", "elevators"] },
  { key: "depress", words: ["depress", "depression", "depressor", "depressors"] },
  { key: "pronat", words: ["pronate", "pronation", "pronator", "pronators"] },
  { key: "supinat", words: ["supinate", "supination", "supinator", "supinators"] },
  { key: "protract", words: ["protract", "protraction", "protractor", "protractors"] },
  { key: "retract", words: ["retract", "retraction", "retractor", "retractors"] },
  { key: "invert", words: ["invert", "inversion", "invertor", "invertors"] },
  { key: "evert", words: ["evert", "eversion", "evertor", "evertors"] },
  { key: "dorsiflex", words: ["dorsiflex", "dorsiflexion", "dorsiflexors"] },
  { key: "plantarflex", words: ["plantarflex", "plantar flex", "plantarflexion", "plantar flexion", "plantarflexors"] }
];

const TYPE_ALIASES = new Map([
  ["muscle", ["muscle", "muscles", "sval", "svaly", "muskel", "muskeln"]],
  ["bone", ["bone", "bones", "kost", "kosti", "knochen"]],
  ["nerve", ["nerve", "nerves", "nerv", "nervy", "nerven"]],
  ["artery", ["artery", "arteries", "tepna", "tepny", "arterie", "arterien"]],
  ["vein", ["vein", "veins", "zila", "zily", "vene", "venen"]],
  ["airway", ["airway", "airways", "dychacie cesty", "atemweg", "atemwege"]],
  ["joint", ["joint", "joints", "klb", "klby", "gelenk", "gelenke"]],
  ["ligament", ["ligament", "ligaments", "vaz", "vazy", "band", "bander"]],
  ["foramen", ["foramen", "foramina", "otvor", "otvory"]],
  ["organ", ["organ", "organs", "organy"]],
  ["duct", ["duct", "ducts", "vyvod", "vyvody"]],
  ["gland", ["gland", "glands", "zlaza", "zlazy"]]
]);

function actionMatch(query) {
  const q = normalizeSmartText(query);
  return ACTIONS.find(action => action.words.some(word => q.includes(normalizeSmartText(word)))) || null;
}

function targetPhrase(query) {
  const q = normalizeSmartText(query)
    .replace(/\b(what|which|name|list|show|give me|tell me|are|is|the|all|main|muscles?|muskel[n]?|svaly?)\b/g, " ")
    .replace(/\b(abductors?|abduction|abduct|adductors?|adduction|adduct|flexors?|flexion|flex|extensors?|extension|extend|rotators?|rotation|rotate|elevators?|elevation|elevate|depressors?|depression|depress|pronators?|pronation|pronate|supinators?|supination|supinate)\b/g, " ")
    .replace(/\b(of|in|at|for)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return q;
}

function alpha(items) {
  return items.slice().sort((a, b) => String(a.label || "").localeCompare(String(b.label || ""), undefined, { sensitivity: "base" }));
}

function containsTargetTokens(text, targetTokens) {
  const haystackTokens = new Set(normalizeSmartText(text).split(" ").filter(Boolean));
  return targetTokens.every(token => haystackTokens.has(token));
}

export function resolveMuscleActionQuestion(query, muscles = []) {
  const action = actionMatch(query);
  if (!action) return null;
  const target = targetPhrase(query);
  if (!target) return null;
  const targetTokens = target.split(" ").filter(token => token.length > 2);
  const matches = [];
  for (const row of muscles || []) {
    const movement = normalizeSmartText(row?.movement_function);
    if (!movement.includes(action.key)) continue;
    const context = normalizeSmartText([
      row?.movement_function,
      row?.muscle_region_en,
      row?.muscle_category_en,
      row?.english_muscle_name,
      row?.latin_muscle_name,
      row?.german_muscle_name
    ].filter(Boolean).join(" "));
    if (targetTokens.length && !containsTargetTokens(context, targetTokens)) continue;
    const label = String(row?.english_muscle_name || row?.latin_muscle_name || "").trim();
    if (!label) continue;
    matches.push({
      label,
      detail: String(row?.latin_muscle_name || row?.movement_function || "").trim(),
      row
    });
  }
  if (!matches.length) return null;
  return {
    source: "internal",
    domain: "anatomy",
    title: `Muscles matching ${target}`,
    answer: `The internal anatomy data identifies ${matches.length} matching muscle${matches.length === 1 ? "" : "s"}.`,
    items: alpha(matches),
    confidence: 0.96,
    reason: "movement_function"
  };
}

function detectStructureType(query) {
  const q = normalizeSmartText(query);
  for (const [type, aliases] of TYPE_ALIASES.entries()) {
    if (aliases.some(alias => q.includes(normalizeSmartText(alias)))) return type;
  }
  return null;
}

function collectionTarget(query, type) {
  let q = normalizeSmartText(query);
  q = q.replace(/\b(what|which|name|list|show|give|tell|me|are|is|the|all|main|structures?|parts?)\b/g, " ");
  const aliases = TYPE_ALIASES.get(type) || [];
  for (const alias of aliases) q = q.replace(new RegExp(`\\b${normalizeSmartText(alias).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " ");
  q = q.replace(/\b(of|in|at|from|for)\b/g, " ").replace(/\s+/g, " ").trim();
  return q;
}

export function resolveAnatomyCollectionQuestion(query, anatomyRows = [], muscles = [], getName = record => record?.terms?.en?.preferred || record?.id || "") {
  const type = detectStructureType(query);
  if (!type) return null;
  if (type === "muscle") return null;
  const target = collectionTarget(query, type);
  const targetTokens = target.split(" ").filter(token => token.length > 2);
  const compatibleType = value => {
    const t = normalizeSmartText(value);
    if (type === "nerve") return t === "nerve" || t === "cranial nerve" || t === "nerve plexus";
    if (type === "vein") return t === "vein" || t === "venous sinus";
    if (type === "gland") return t.includes("gland");
    return t === type;
  };
  const matches = [];
  for (const item of anatomyRows || []) {
    const record = item?.record || item;
    if (!compatibleType(record?.type)) continue;
    const context = normalizeSmartText([
      ...(Array.isArray(record?.region) ? record.region : [record?.region]),
      ...(Array.isArray(record?.system) ? record.system : [record?.system]),
      getName(record),
      record?.terms?.la?.preferred,
      ...(record?.key_features || [])
    ].filter(Boolean).join(" "));
    if (targetTokens.length && !containsTargetTokens(context, targetTokens)) continue;
    const label = String(getName(record) || "").trim();
    if (!label) continue;
    matches.push({ label, detail: String(record?.terms?.la?.preferred || "").trim(), record });
  }
  if (!matches.length) return null;
  return {
    source: "internal",
    domain: "anatomy",
    title: target ? `${type} · ${target}` : type,
    answer: `The internal anatomy data contains ${matches.length} matching ${type}${matches.length === 1 ? "" : "s"}.`,
    items: alpha(matches),
    confidence: targetTokens.length ? 0.92 : 0.9,
    reason: "structure_type_region"
  };
}

function generationQualifier(q) {
  const match = q.match(/\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)[ -]?generation\b/);
  return match ? match[0] : "";
}

function normalizeDrugClassQuery(query) {
  let q = normalizeSmartText(query)
    .replace(/\b(what|which|name|list|show|give|tell|me|are|is|the|all|examples?|drugs?|agents?|medications?)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/\bbeta blockers?\b/.test(q)) q = q.replace(/\bbeta blockers?\b/g, "beta blocking agents");
  if (/\bbeta-blockers?\b/.test(q)) q = q.replace(/\bbeta-blockers?\b/g, "beta blocking agents");
  return q;
}

export function resolvePharmacologyListQuestion(query, searchFn) {
  if (typeof searchFn !== "function") return null;
  const normalized = normalizeSmartText(query);
  if (!looksLikeSmartQuestion(query) && !/(inhibitors?|blockers?|agonists?|antagonists?|antibiotics?|diuretics?|antidepressants?|antipsychotics?|statins?)/.test(normalized)) return null;
  const generation = generationQualifier(normalized);
  const classQuery = normalizeDrugClassQuery(query);
  if (!classQuery) return null;
  const results = searchFn(classQuery).slice(0, 60);
  if (!results.length) return null;
  const qualified = generation
    ? results.filter(item => normalizeSmartText(JSON.stringify(item?.row || item?.record || {})).includes(generation.replace(/-/g, " ")))
    : results;
  const candidates = qualified.filter(item => Number(item?.score || 0) >= 50 && (item?.matchedFields || []).some(field => /class|atc|mechanism|target/i.test(String(field))));
  if (!candidates.length) return null;
  const items = candidates.map(item => {
    const record = item?.row || item?.record || {};
    return {
      label: String(record?.names?.english?.source_value || record?.names?.english?.normalized || record?.id || "").trim(),
      detail: String(record?.atc?.primary_code || (record?.pharmacology?.therapeutic_class || [])[0] || "").trim(),
      record
    };
  }).filter(item => item.label);
  if (!items.length) return null;
  return {
    source: "internal",
    domain: "pharmacology",
    title: classQuery,
    answer: `The internal pharmacology data identifies ${items.length} matching drug${items.length === 1 ? "" : "s"}.`,
    items: alpha(items).slice(0, 40),
    confidence: generation ? 0.88 : 0.93,
    reason: generation ? "generation_encoded_in_dataset" : "pharmacology_class"
  };
}

export function buildRelaxedPharmacologyQuery(query) {
  let q = normalizeSmartText(query);
  q = q.replace(/\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)[ -]?generation\b/g, " ");
  q = q.replace(/\s+/g, " ").trim();
  return normalizeDrugClassQuery(q);
}
