export function getRedFlagsForCase(patientCase) {
  return patientCase.redFlags ?? [];
}

export function getAssessedRedFlags(patientCase, coveredIntents) {
  const covered = new Set(coveredIntents);
  return getRedFlagsForCase(patientCase).filter((flag) =>
    flag.triggerIntents.some((intentId) => covered.has(intentId))
  );
}

export function getMissedRedFlags(patientCase, coveredIntents) {
  const assessed = new Set(getAssessedRedFlags(patientCase, coveredIntents).map((flag) => flag.id));
  return getRedFlagsForCase(patientCase).filter((flag) => !assessed.has(flag.id));
}
