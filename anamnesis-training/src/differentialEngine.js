export function initializeDifferential(patientCase) {
  return normalizeDistribution(patientCase.differentialWeights?.initial ?? {});
}

export function updateDifferential(patientCase, state) {
  const covered = new Set(state.coveredIntents);
  const next = { ...(patientCase.differentialWeights?.initial ?? {}) };

  for (const rule of patientCase.differentialWeights?.evidence ?? []) {
    if (!rule.intents.every((intent) => covered.has(intent))) continue;
    for (const [diagnosis, adjustment] of Object.entries(rule.adjust)) {
      next[diagnosis] = Math.max(0.01, (next[diagnosis] ?? 0.01) + adjustment);
    }
  }

  state.differentialState = normalizeDistribution(next);
  return state.differentialState;
}

function normalizeDistribution(distribution) {
  const total = Object.values(distribution).reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
  return Object.fromEntries(
    Object.entries(distribution)
      .map(([key, value]) => [key, Math.round((Math.max(0, value) / total) * 100) / 100])
      .sort((a, b) => b[1] - a[1])
  );
}
