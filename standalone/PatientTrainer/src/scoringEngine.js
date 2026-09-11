import { medicalDomains, osceCategories } from './data/medicalDomains.js';
import { questionnaireCoverage } from './data/questionnaireCoverage.js';
import { scoringRubrics } from './data/scoringRubrics.js';
import { getAssessedRedFlags, getMissedRedFlags } from './data/redFlagRules.js';

export function calculateScore(patientCase, state) {
  const covered = new Set(state.coveredIntents);
  const relevantChecklist = new Set([...patientCase.requiredChecklist, ...patientCase.optionalChecklist]);
  const categories = osceCategories.map((category) => scoreCategory(category, patientCase, state, covered, relevantChecklist));
  const weightedRaw = categories.reduce((sum, category) => sum + category.weightedScore, 0);
  const qualityPenalty = calculateQualityPenalty(state);
  const rapportAdjustment = state.rapport >= 0.75 ? 2 : state.rapport < 0.35 ? -4 : 0;
  const difficultyMultiplier = scoringRubrics.difficultyMultipliers[state.difficulty] ?? 1;
  const percentage = clamp(Math.round((weightedRaw * difficultyMultiplier) - qualityPenalty + rapportAdjustment), 0, 100);

  return {
    percentage,
    categories,
    qualityPenalty,
    rapportAdjustment,
    assessedRedFlags: getAssessedRedFlags(patientCase, state.coveredIntents),
    missedRedFlags: getMissedRedFlags(patientCase, state.coveredIntents),
    repeatedQuestions: Object.entries(state.repeatedIntents).filter(([, count]) => count > 0)
  };
}

export function getCoverageMap(patientCase, state) {
  const coverageDomains = [
    ...questionnaireCoverage.filter((domain) => !domain.femaleOnly || patientCase.identity.sex === 'Female'),
    {
      id: 'redFlags',
      label: 'Red flags',
      intents: patientCase.redFlags.flatMap((flag) => flag.triggerIntents)
    }
  ];

  const allRelevant = new Set([...patientCase.requiredChecklist, ...patientCase.optionalChecklist]);
  const covered = new Set(state.coveredIntents);

  return coverageDomains
    .map((domain) => {
      const relevant = [...new Set(domain.intents)].filter((intent) =>
        allRelevant.has(intent) || patientCase.redFlags.some((flag) => flag.triggerIntents.includes(intent))
      );
      if (!relevant.length) return null;
      const asked = relevant.filter((intent) => covered.has(intent));
      const required = relevant.filter((intent) => patientCase.requiredChecklist.includes(intent));
      return {
        ...domain,
        requiredCount: required.length,
        requiredAsked: required.filter((intent) => covered.has(intent)).length,
        total: relevant.length,
        asked: asked.length,
        percent: Math.round((asked.length / relevant.length) * 100),
        missing: relevant.filter((intent) => !covered.has(intent)),
        completed: asked.length === relevant.length
      };
    })
    .filter(Boolean);
}

function scoreCategory(category, patientCase, state, covered, relevantChecklist) {
  let raw = 0;
  let total = 1;

  if (category.redFlags) {
    const assessed = getAssessedRedFlags(patientCase, state.coveredIntents).length;
    const flags = patientCase.redFlags.length || 1;
    raw = assessed;
    total = flags;
  } else if (category.structure) {
    raw = structureScore(state);
    total = 1;
  } else {
    const intents = category.intents ?? medicalDomains[category.domain]?.intents ?? [];
    const relevant = intents.filter((intent) => relevantChecklist.has(intent));
    const denominator = relevant.length ? relevant : intents;
    raw = denominator.filter((intent) => covered.has(intent)).length;
    total = denominator.length || 1;
  }

  const percent = Math.round((raw / total) * 100);
  return {
    id: category.id,
    label: category.label,
    weight: category.weight,
    percent,
    raw,
    total,
    weightedScore: (percent / 100) * category.weight
  };
}

function structureScore(state) {
  const chiefIndex = firstQuestionIndex(state, 'chief_complaint');
  const hpiIndex = firstQuestionIndex(state, 'pain_onset');
  const socialIndex = firstQuestionIndex(state, 'smoking');
  if (chiefIndex >= 0 && (socialIndex === -1 || chiefIndex < socialIndex) && (hpiIndex === -1 || chiefIndex <= hpiIndex)) return 1;
  return 0.5;
}

function firstQuestionIndex(state, intentId) {
  return state.questionHistory.findIndex((entry) => entry.role === 'student' && entry.intentIds?.includes(intentId));
}

function calculateQualityPenalty(state) {
  return state.qualityEvents.reduce((sum, event) => {
    let penalty = 0;
    if (event.tags.includes('repeated')) penalty += scoringRubrics.penalties.repeatedQuestion;
    if (event.tags.includes('leading')) penalty += scoringRubrics.penalties.leadingQuestion;
    if (event.tags.includes('tooTechnical')) penalty += scoringRubrics.penalties.tooTechnicalQuestion;
    if (event.tags.includes('vague')) penalty += scoringRubrics.penalties.vagueQuestion;
    if (event.tags.includes('harsh')) penalty += scoringRubrics.penalties.harshTone;
    return sum + penalty;
  }, 0);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
