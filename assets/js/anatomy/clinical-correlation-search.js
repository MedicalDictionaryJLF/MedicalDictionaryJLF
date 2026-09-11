// Clinical Correlation Fuzzy Search v1
// Standalone ES module. Designed for browser use with clinical_correlations_logic_synonymized.json
// and clinical_correlation_synonyms.json. No dependencies. Because a search box should not need a pilgrimage.

export function normalizeClinicalQuery(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\bcn\s*([ivx]+)\b/gi, "cn-$1")
    .replace(/\bcranial\s+nerve\s+([ivx]+|\d+)\b/gi, "cn-$1")
    .replace(/[^a-z0-9+\-/% ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DEFAULT_STOPWORDS = new Set([
  "a","an","the","of","in","on","at","by","to","from","for","with","and","or","is","are","what","which","where","how","does","do","did","passes","pass","runs","run","structure","structures","clinical","exam","anatomy"
]);

const PROTECTED_TOKEN_RE = /^(cn-[ivx]+|cn-\d+|v1|v2|v3|lad|rca|lcx|sma|ica|ijv|sof|van|navl|pcha|mcfa|cbd)$/i;

function textOf(value) {
  if (value === null || value === undefined) return "";
  if (["string", "number", "boolean"].includes(typeof value)) return String(value);
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(" ");
  if (typeof value === "object") return Object.values(value).map(textOf).filter(Boolean).join(" ");
  return "";
}

function unique(values) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    const str = String(value || "").trim();
    if (!str) continue;
    const key = normalizeClinicalQuery(str);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(str);
  }
  return out;
}

export function tokenizeClinicalQuery(value, stopwords = DEFAULT_STOPWORDS) {
  return normalizeClinicalQuery(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => PROTECTED_TOKEN_RE.test(token) || !stopwords.has(token));
}

export function boundedDamerauLevenshtein(a, b, limit = 2) {
  a = String(a || "");
  b = String(b || "");
  if (a === b) return 0;
  if (!a || !b) return limit + 1;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    let rowMin = limit + 1;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
      }
      rowMin = Math.min(rowMin, dp[i][j]);
    }
    if (rowMin > limit) return limit + 1;
  }
  return dp[a.length][b.length];
}

function fuzzyLimit(token) {
  if (PROTECTED_TOKEN_RE.test(token)) return 0;
  if (token.length <= 4) return 0;
  if (token.length <= 7) return 1;
  return 2;
}

function hasDangerousConflict(queryNorm, candidateNorm) {
  const pairs = [
    ["left", "right"],
    ["greater", "lesser"],
    ["artery", "vein"],
    ["gastric", "gastro-omental"],
    ["gastric", "gastroepiploic"],
    ["cn-iii", "cn-iv"],
    ["cn-iv", "cn-vi"],
    ["v1", "v2"],
    ["v2", "v3"]
  ];
  return pairs.some(([a, b]) =>
    (queryNorm.includes(a) && candidateNorm.includes(b) && !candidateNorm.includes(a)) ||
    (queryNorm.includes(b) && candidateNorm.includes(a) && !candidateNorm.includes(b))
  );
}

function expandQueryTokens(tokens, synonymData) {
  const expanded = new Set(tokens);
  const normalizedPhrase = tokens.join(" ");
  const maps = [synonymData?.global_synonyms || {}, synonymData?.common_misspellings || {}];
  for (const map of maps) {
    for (const [canonical, aliases] of Object.entries(map)) {
      const canonicalNorm = normalizeClinicalQuery(canonical);
      const aliasNorms = (aliases || []).map(normalizeClinicalQuery);
      const all = [canonicalNorm, ...aliasNorms].filter(Boolean);
      if (all.some((term) => normalizedPhrase.includes(term) || tokens.includes(term))) {
        all.forEach((term) => term.split(" ").forEach((token) => expanded.add(token)));
      }
    }
  }
  return [...expanded];
}

export function buildClinicalCorrelationIndex(correlations, synonymData = {}) {
  return (correlations || []).map((record) => {
    const support = record.query_support || {};
    const fields = {
      subject: [record.subject?.name],
      target: [record.target?.name],
      canonical: support.canonical_terms || [],
      synonyms: support.direct_synonyms || [],
      misspellings: support.common_misspellings || [],
      abbreviations: support.abbreviations || [],
      relation: [record.relation_type, ...(support.relation_phrases || [])],
      questions: record.question_templates || [],
      answer: [record.answer],
      clinical: record.clinical_relevance || [],
      traps: [...(record.exam_traps || []), ...(support.negative_traps || [])],
      tags: [...(record.tags || []), ...(record.course_tags || [])],
      all: []
    };
    fields.all = Object.values(fields).flat().filter(Boolean);
    const normalizedFields = Object.fromEntries(
      Object.entries(fields).map(([key, values]) => [key, normalizeClinicalQuery(unique(values).join(" "))])
    );
    const tokenBag = new Set(tokenizeClinicalQuery(normalizedFields.all, new Set()));
    return { id: record.id, record, fields, normalizedFields, tokenBag };
  });
}

function scoreField(fieldText, queryNorm, queryTokens, points, matchedFields, fieldName) {
  if (!fieldText) return 0;
  let score = 0;
  if (fieldText === queryNorm) score = Math.max(score, points);
  else if (fieldText.includes(queryNorm)) score = Math.max(score, Math.round(points * 0.86));
  const coverage = queryTokens.length
    ? queryTokens.filter((token) => fieldText.includes(token)).length / queryTokens.length
    : 0;
  if (coverage >= 0.999) score = Math.max(score, Math.round(points * 0.82));
  else if (coverage >= 0.67) score = Math.max(score, Math.round(points * 0.62));
  else if (coverage >= 0.4) score = Math.max(score, Math.round(points * 0.42));
  if (score > 0) matchedFields.push(fieldName);
  return score;
}

export function searchClinicalCorrelations(query, index, synonymData = {}, options = {}) {
  const queryNorm = normalizeClinicalQuery(query);
  if (!queryNorm) return [];
  const stopwords = new Set(synonymData.stopwords || [...DEFAULT_STOPWORDS]);
  const rawTokens = tokenizeClinicalQuery(queryNorm, stopwords);
  const expandedTokens = expandQueryTokens(rawTokens, synonymData);
  const minScore = Number(options.minScore || 45);
  const results = [];

  for (const item of index || []) {
    const n = item.normalizedFields;
    const matchedFields = [];
    let score = 0;
    score = Math.max(score, scoreField(n.subject, queryNorm, expandedTokens, 100, matchedFields, "subject"));
    score = Math.max(score, scoreField(n.target, queryNorm, expandedTokens, 95, matchedFields, "target"));
    score = Math.max(score, scoreField(n.abbreviations, queryNorm, expandedTokens, 92, matchedFields, "abbreviation"));
    score = Math.max(score, scoreField(n.canonical, queryNorm, expandedTokens, 88, matchedFields, "canonical"));
    score = Math.max(score, scoreField(n.synonyms, queryNorm, expandedTokens, 80, matchedFields, "synonym"));
    score = Math.max(score, scoreField(n.relation, queryNorm, expandedTokens, 65, matchedFields, "relation"));
    score = Math.max(score, scoreField(n.questions, queryNorm, expandedTokens, 62, matchedFields, "question"));
    score = Math.max(score, scoreField(n.answer, queryNorm, expandedTokens, 55, matchedFields, "answer"));
    score = Math.max(score, scoreField(n.clinical, queryNorm, expandedTokens, 45, matchedFields, "clinical"));
    score = Math.max(score, scoreField(n.traps, queryNorm, expandedTokens, 35, matchedFields, "exam_trap"));

    let fuzzyHits = 0;
    for (const token of rawTokens) {
      const limit = fuzzyLimit(token);
      if (limit === 0) continue;
      for (const candidate of item.tokenBag) {
        if (hasDangerousConflict(token, candidate)) continue;
        const distance = boundedDamerauLevenshtein(token, candidate, limit);
        if (distance <= limit) {
          fuzzyHits += 1;
          break;
        }
      }
    }
    if (fuzzyHits) {
      score = Math.max(score, 30 + fuzzyHits * 6);
      matchedFields.push("fuzzy");
    }

    if (hasDangerousConflict(queryNorm, n.subject + " " + n.target + " " + n.answer)) {
      score -= 70;
      matchedFields.push("safety_penalty");
    }

    const tokenCoverage = rawTokens.length
      ? rawTokens.filter((token) => item.tokenBag.has(token) || n.all.includes(token)).length / rawTokens.length
      : 0;
    score += Math.round(tokenCoverage * 20);

    if (score >= minScore) {
      const evidence = item.record?.evidence?.status || "seed_needs_review";
      const directAnswerAllowed = score >= Number(options.directAnswerScore || 75) && !matchedFields.includes("safety_penalty");
      results.push({
        id: item.id,
        score,
        matchedFields: [...new Set(matchedFields)],
        directAnswerAllowed,
        evidence,
        record: item.record
      });
    }
  }

  results.sort((a, b) => b.score - a.score || String(a.record?.subject?.name || "").localeCompare(String(b.record?.subject?.name || "")));
  const ambiguousDelta = Number(options.ambiguousDelta || 8);
  if (results.length > 1 && results[0].score - results[1].score <= ambiguousDelta) {
    results[0].ambiguous = true;
  }
  return results.slice(0, Number(options.maxResults || 10));
}

export function formatClinicalCorrelationAnswer(result) {
  const r = result?.record;
  if (!r) return null;
  return {
    title: `${r.subject?.name || "Structure"} → ${r.target?.name || "related structure"}`,
    category: r.category,
    relationType: r.relation_type,
    answer: r.answer,
    details: r.details || {},
    clinicalRelevance: r.clinical_relevance || [],
    examTraps: r.exam_traps || [],
    evidenceStatus: r.evidence?.status || "seed_needs_review",
    matchedFields: result.matchedFields || [],
    score: result.score,
    directAnswerAllowed: result.directAnswerAllowed === true,
    ambiguous: result.ambiguous === true
  };
}
