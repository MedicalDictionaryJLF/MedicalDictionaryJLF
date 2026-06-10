export function createSearchService({
  maxResults = 60,
  languageFieldEquivalents = {},
  userSearchFields = [],
  normalizeSearchText,
  getLoadedRows,
  isRowInSelection,
  getLocalTerms,
  ensureUserSearchLowercaseCache,
  matchAnyHeader,
  searchPharmacology
}) {
  function scoreSearchValue(value, query, exactScore, prefixScore, containsScore) {
    const normalizedValue = normalizeSearchText(value);
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedValue || !normalizedQuery) return 0;
    if (normalizedValue === normalizedQuery) return exactScore;
    if (normalizedValue.startsWith(normalizedQuery)) return prefixScore;
    if (normalizedValue.includes(normalizedQuery)) return containsScore;
    return 0;
  }

  function scoreMedicalRow(row, query, langField) {
    const lc = row && row.__lc ? row.__lc : {};
    let score = scoreSearchValue(lc[langField] || row && row[langField], query, 100, 80, 60);
    const alternatives = languageFieldEquivalents[langField] || [langField];
    for (const field of alternatives) {
      score = Math.max(score, scoreSearchValue(lc[field] || row && row[field], query, 95, 78, 58));
    }
    if (matchAnyHeader(row, query)) {
      score = Math.max(score, 25);
    }
    return score;
  }

  function scoreUserRow(row, query, userField) {
    const lc = ensureUserSearchLowercaseCache(row) || {};
    let score = scoreSearchValue(lc[userField] || row && row[userField], query, 100, 80, 60);
    for (const field of userSearchFields) {
      score = Math.max(score, scoreSearchValue(lc[field] || row && row[field], query, 92, 76, 56));
    }
    return score;
  }

  function queryLooksLikeAtcCode(query) {
    return /^[A-Za-z]\d{1,2}[A-Za-z]{0,2}\d{0,2}$/.test(String(query || "").trim());
  }

  function collectMainSearchResults(query, selectedGroup, langField, userField) {
    const results = [];
    const includePharmacology = selectedGroup === "all" || selectedGroup === "pharmacology";

    for (const row of getLoadedRows()) {
      if (!isRowInSelection(row, selectedGroup)) continue;
      const score = scoreMedicalRow(row, query, langField);
      if (score > 0) {
        results.push({ kind: "base", row, score });
      }
    }

    if (selectedGroup === "all") {
      for (const row of getLocalTerms()) {
        const score = scoreUserRow(row, query, userField);
        if (score > 0) {
          results.push({ kind: "user", row, score });
        }
      }
    }

    if (includePharmacology) {
      results.push(...searchPharmacology(query));
    }

    const pharmacologyBias = queryLooksLikeAtcCode(query) ? 12 : 0;
    const sorted = results.sort((left, right) => {
      const leftScore = Number(left.score || 0) + (left.kind === "pharmacology" ? pharmacologyBias : 0);
      const rightScore = Number(right.score || 0) + (right.kind === "pharmacology" ? pharmacologyBias : 0);
      if (rightScore !== leftScore) return rightScore - leftScore;
      if (left.kind !== right.kind) {
        if (left.kind === "pharmacology") return -1;
        if (right.kind === "pharmacology") return 1;
      }
      const leftLabel = left.kind === "pharmacology"
        ? String(left.row && (left.row.names?.english?.source_value || left.row.names?.english?.normalized || left.row.id) || "")
        : String(left.row && (left.row[langField] || left.row[userField] || left.row.english_translation || left.row.english || "") || "");
      const rightLabel = right.kind === "pharmacology"
        ? String(right.row && (right.row.names?.english?.source_value || right.row.names?.english?.normalized || right.row.id) || "")
        : String(right.row && (right.row[langField] || right.row[userField] || right.row.english_translation || right.row.english || "") || "");
      return leftLabel.localeCompare(rightLabel);
    });

    return {
      results: sorted.slice(0, maxResults),
      truncated: sorted.length > maxResults
    };
  }

  return {
    collectMainSearchResults,
    queryLooksLikeAtcCode
  };
}
