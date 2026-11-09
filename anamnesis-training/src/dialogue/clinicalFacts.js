import { INTENTS } from '../data/interviewSchema.js?v=134';
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
  if (target?.medication && attribute.startsWith('medication.')) {
    const drug = (authored.medicationFacts ?? MEDICATION_DETAILS[patient.id] ?? [])
      .find(item => item.name === target.medication);
    const key = attribute.split('.')[1];
    return [record(patient, intent, `${attribute}.${target.medication}`, drug,
      drug?.[key] == null ? FACT_STATE.NOT_AUTHORED : FACT_STATE.PRESENT, paths)];
  }
  const authoredValues = paths.map(path => [path, getCaseValue(authored, path)])
    .filter(([, value]) => value != null && value !== '');
  const facets = authored.conversationFacts?.[intent] ?? CONVERSATION_FACTS[patient.id]?.[intent];
  if (facets && Object.hasOwn(facets, attribute)) {
    const value = facets[attribute];
    return [record(patient, intent, attribute, value, value?.state ?? FACT_STATE.PRESENT, paths)];
  }
  // Broad requests and one-facet authored answers remain useful as authored.
  // A broad narrative cannot establish the answer to a narrower question.
  if ((attribute === 'overview' || attribute === 'authored-overview') && authoredValues.length) {
    return authoredValues.map(([path, value]) => record(patient, intent, attribute, value,
      /^(not applicable|that does not apply to me)\.?$/i.test(value) ? FACT_STATE.NOT_APPLICABLE : FACT_STATE.NARRATIVE, [path]));
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
