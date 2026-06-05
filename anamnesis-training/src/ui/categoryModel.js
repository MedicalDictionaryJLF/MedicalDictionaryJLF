import { QUESTION_AREAS, INTENTS } from '../patientCase.js';

const LAB_LABELS = {
  wbc: 'White blood cell count',
  crp: 'CRP / inflammatory markers',
  creatinine: 'Creatinine',
  potassium: 'Potassium',
  glucose: 'Glucose',
  tsh: 'TSH'
};

export const ANAMNESIS_CATEGORIES = QUESTION_AREAS;

export function getVisibleCategories(patientCase) {
  return ANAMNESIS_CATEGORIES.filter((category) => category.id !== 'gynecological' || /female/i.test(patientCase.identity?.sex ?? ''));
}

export function getCategoryForIntent(intentId) {
  return ANAMNESIS_CATEGORIES.find((category) => category.intents.includes(intentId)) ?? null;
}

export function getChecklistItemsByCategory(engine, patientCase) {
  const coverageById = new Map(engine.getCoverage().map((area) => [area.id, area]));
  return getVisibleCategories(patientCase).map((category) => {
    const coverage = coverageById.get(category.id);
    const items = category.intents.map((intentId) => {
      const applicable = Boolean(INTENTS[intentId]);
      const complete = engine.askedIntents.has(intentId);
      return {
        id: intentId,
        label: labelForIntent(intentId),
        status: applicable ? (complete ? 'complete' : 'notAsked') : 'notApplicable'
      };
    });
    return {
      id: category.id,
      title: category.title,
      required: category.required,
      asked: coverage?.asked ?? items.filter((item) => item.status === 'complete').length,
      total: coverage?.total ?? items.length,
      percent: coverage?.percent ?? 0,
      items
    };
  });
}

export function getKnownFactsByCategory(engine, patientCase, orderedLabs = {}) {
  const orderedLabFacts = new Map(Object.entries(orderedLabs).map(([key, value]) => [`lab_${key}`, value]));
  return getVisibleCategories(patientCase)
    .map((category) => {
      const facts = category.intents
        .filter((intentId) => engine.askedIntents.has(intentId) || orderedLabFacts.has(intentId))
        .map((intentId) => ({
          id: intentId,
          label: labelForIntent(intentId),
          value: orderedLabFacts.get(intentId) || engine.answerFor(intentId)
        }))
        .filter((fact) => fact.value);
      return { id: category.id, title: category.title, facts };
    })
    .filter((category) => category.facts.length > 0);
}

export function getQuestionVariantsByCategory(patientCase, engine) {
  return getVisibleCategories(patientCase).map((category) => ({
    id: category.id,
    title: category.title,
    intents: category.intents
      .filter((intentId) => INTENTS[intentId])
      .map((intentId) => ({
        id: intentId,
        label: labelForIntent(intentId),
        covered: engine.askedIntents.has(intentId),
        variants: variantsForIntent(intentId)
      }))
  }));
}

export function labelForIntent(intentId) {
  if (intentId.startsWith('lab_')) {
    const key = intentId.replace(/^lab_/, '');
    return LAB_LABELS[key] ?? humanize(intentId);
  }
  return INTENTS[intentId]?.title || humanize(intentId);
}

function variantsForIntent(intentId) {
  const intent = INTENTS[intentId];
  if (!intent) return [];
  const fromKeywords = (intent.keywords ?? [])
    .filter((keyword) => keyword.length > 2 && !/^\b[a-z]{1,3}\b$/.test(keyword))
    .map((keyword) => keywordToQuestion(keyword, intent.title));
  const fallback = [
    `Could you tell me about ${intent.title.toLowerCase()}?`,
    `Can I ask about ${intent.title.toLowerCase()}?`
  ];
  return [...new Set([...fromKeywords, ...fallback])].slice(0, 4);
}

function keywordToQuestion(keyword, title) {
  const clean = String(keyword).trim();
  if (/^(what|when|where|why|how|who|do|does|did|is|are|was|were|can|could|have|has|had|any)\b/i.test(clean)) {
    return punctuate(capitalize(clean));
  }
  if (/pain site|site of pain|location/i.test(clean)) return 'Where exactly is the pain?';
  if (/radiat|spread|go anywhere/i.test(clean)) return 'Does the pain spread anywhere?';
  if (/severity|scale/i.test(clean)) return 'How severe is it from 0 to 10?';
  if (/medication|medicine|meds/i.test(clean)) return 'What medicines do you take regularly?';
  if (/allerg/i.test(clean)) return 'Do you have any allergies?';
  if (/smok/i.test(clean)) return 'Do you smoke?';
  if (/alcohol/i.test(clean)) return 'Do you drink alcohol?';
  return `Can you tell me about ${title.toLowerCase()}?`;
}

function punctuate(text) {
  return /[?.!]$/.test(text) ? text : `${text}?`;
}

function capitalize(text) {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function humanize(value) {
  return String(value).replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
