import { INTENTS } from '../data/interviewSchema.js?v=pilot-9';
import { getAuthoredCase } from '../cases/caseFactory.js';
import { CONVERSATION_FACTS, MEDICATION_DETAILS } from '../cases/conversationFacts.js';

export const FACT_STATE = Object.freeze({
  PRESENT: 'present',
  ABSENT: 'absent',
  UNKNOWN: 'unknown',
  NOT_ASKED: 'not_asked',
  NOT_APPLICABLE: 'not_applicable',
  NOT_AUTHORED: 'not_authored',
  NARRATIVE: 'authored_narrative'
});

export function getCaseValue(source, path) {
  return path.split('.').reduce((value, key) => Object.hasOwn(value ?? {}, key) ? value[key] : undefined, source);
}

function record(patient, intent, attribute, value, state, paths) {
  return { id: `${patient.id}:${intent}:${attribute}`, intent, attribute, state, value,
    provenance: { caseId: patient.id, paths, documented: state !== FACT_STATE.NOT_AUTHORED } };
}

export function retrieveFacts(patient, intent, attribute = 'overview', target) {
  const paths = INTENTS[intent]?.answerKeys ?? [];
  const authored = getAuthoredCase(patient);
  if (intent === 'family_history' && attribute === 'overview') {
    const familyTopics = INTENTS.family_history.relatedIntents;
    const topics = Array.isArray(authored.familyOverviewTopics) ? authored.familyOverviewTopics :
      (authored.familyHistory ? [] : familyTopics);
    const overview = [...new Set(topics)].filter(topic => familyTopics.includes(topic))
      .flatMap(topic => retrieveFacts(patient, topic))
      .filter(fact => [FACT_STATE.PRESENT, FACT_STATE.ABSENT, FACT_STATE.NARRATIVE].includes(fact.state));
    if (overview.length) return overview;
  }
  if (target?.medication && attribute.startsWith('medication.')) {
    const medicines = authored.medicationFacts ?? MEDICATION_DETAILS[patient.id] ?? [];
    const index = medicines.findIndex(item => item.name === target.medication);
    const drug = medicines[index];
    const key = attribute.split('.')[1];
    const source = authored.medicationFacts ? 'medicationFacts' : `MEDICATION_DETAILS.${patient.id}`;
    return [record(patient, intent, `${attribute}.${target.medication}`, drug,
      drug?.[key] == null ? FACT_STATE.NOT_AUTHORED : FACT_STATE.PRESENT,
      index < 0 ? paths : [`${source}.${index}.${key}`])];
  }
  const authoredValues = [...new Set(paths)].map(path => [path, getCaseValue(authored, path)])
    .filter(([, value]) => value != null && (typeof value !== 'string' || value.trim()));
  const localFacets = authored.conversationFacts?.[intent] ?? {};
  const curatedFacets = CONVERSATION_FACTS[patient.id]?.[intent] ?? {};
  const hasLocalFacet = Object.hasOwn(localFacets, attribute);
  if (hasLocalFacet || Object.hasOwn(curatedFacets, attribute)) {
    const value = hasLocalFacet ? localFacets[attribute] : curatedFacets[attribute];
    const source = hasLocalFacet ? 'conversationFacts' : `CONVERSATION_FACTS.${patient.id}`;
    return [record(patient, intent, attribute, value, value?.state ?? FACT_STATE.PRESENT,
      [`${source}.${intent}.${attribute}`])];
  }
  // Broad requests and one-facet authored answers remain useful as authored.
  // A broad narrative cannot establish the answer to a narrower question.
  if ((attribute === 'overview' || attribute === 'authored-overview') && authoredValues.length) {
    return authoredValues.map(([path, value]) => {
      const state = value?.state ??
        (/^(not applicable|that does not apply to me)\.?$/i.test(value) ? FACT_STATE.NOT_APPLICABLE : FACT_STATE.NARRATIVE);
      return record(patient, intent, attribute, value, state, [path]);
    });
  }
  return [record(patient, intent, attribute, undefined, FACT_STATE.NOT_AUTHORED, paths)];
}

export function validateConversationCase(patient, attributesByIntent) {
  return Object.keys(INTENTS).flatMap(intent => {
    const attributes = ['overview', ...(attributesByIntent[intent] ?? [])];
    return attributes.flatMap(attribute => retrieveFacts(patient, intent, attribute)
      .filter(fact => [FACT_STATE.NOT_AUTHORED, FACT_STATE.UNKNOWN].includes(fact.state))
      .map(({ id, state, provenance }) => ({ id, state, paths: provenance.paths })));
  });
}
