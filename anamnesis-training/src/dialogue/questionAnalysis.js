import { MEDICATION_NAMES, PRESENTING_SYMPTOMS } from '../cases/conversationFacts.js';

export const medicationSubject = /\b(?:medicines?|medications?|meds|pills?|tablets?|prescriptions?)\b/;
export const sleepQuestion = /^(?:can|could|do|did|how well do) (?:you|zou) sleep\b/;

const startsQuestion = '(?:what|where|when|why|how|who|do|does|did|is|are|was|were|have|has|had|can|could|any|tell)';
const clauseBreak = new RegExp(`[?!;]+|(?:,\\s*(?:and\\s+)?|\\s+and\\s+)(?=${startsQuestion}\\b)`, 'i');

const facets = [
  ['hpi_activity_at_onset', 'onset.activity', /\b(?:what were you doing|what did you do (?:when|as|just before)|activity at onset)\b/],
  ['hpi_onset', 'onset.type', /\b(?:sudden(?:ly)?|gradual(?:ly)?|all at once|out of nowhere|come on fast|build up slowly)\b/],
  ['hpi_timing', 'timing.duration', /\b(?:how long (?:does|did|do) .*\blasts?|how long (?:is|was) (?:each|the) (?:episode|spell|attack)|duration of (?:each|the)|how long (?:are|were) you unconscious)\b/],
  ['hpi_onset', 'onset.time', /\b(?:when (?:exactly )?(?:(?:did|does) .*\b(?:start|begin|come on|first notice|first appear)|(?:was|were) .*\b(?:first|onset))|when (?:exactly )?it (?:started|began)|when (?:exactly )?did you (?:first feel|start feeling|first experience)|how long ago|since when|what time did .*\b(?:start|begin)|how long have you had|when was the onset)\b/],
  ['hpi_relieving', 'relief', /\b(?:anything (?:help|helping)|what (?:makes|made) .* better|what (?:relieves|relieved|eases) |what helps|what is helping)\b/],
  ['hpi_course', 'progression', /\b(?:get(?:ting)? (?:better|worse)|(?:got|become|became) worse|changed since|worse (?:today|now|than|over time)|better than|improving|worsening over time)\b/],
  ['hpi_radiation', 'radiation.sites', /\b(?:radiat\w*|spread\w*|travel\w*|(?:go|shoot|move) (?:to|into|anywhere))\b/],
  ['hpi_site', 'location', /\b(?:where .*\b(?:hurt|hurts|pain|ache|feel it|feel the|located|pressure|discomfort)|where is it|where exactly|(?:which|what) (?:part|area) .*\b(?:hurts|affected|feel)|(?:point|show me) to where)\b/],
  ['hpi_character', 'character.qualities', /\b(?:what .* feel like|what .* is it like|what is it like|how .* describe|describe (?:it|the pain)|what kind of pain)\b/],
  ['hpi_severity', 'severity.worst', /\b(?:at (?:its|the) worst|worst (?:out of|on a|severity|rating)|how (?:bad|severe) was it at)\b/],
  ['hpi_severity', 'severity.current', /\b(?:out of 10|scale|how (?:bad|severe|strong|intense)|rate (?:it|the pain))\b/],
  ['hpi_timing', 'timing.pattern', /\b(?:constant|intermittent|continuous|come[s]? and go(?:es)?|all the time)\b/],
  ['hpi_timing', 'timing.frequency', /\b(?:how (?:often|many times)|frequency)\b/]
];

export const attributesByIntent = Object.freeze(facets.reduce((result, [intent, attribute]) => {
  (result[intent] ??= []).push(attribute);
  return result;
}, { ros_hemoptysis: ['presence'] }));

const otherTopic = /\b(?:allerg\w*|medicine\w*|medication\w*|tablet\w*|dose\w*|surg\w*|operation\w*|(?:family|work) history|period\w*|contracept\w*|pregnan\w*|drink\w*|smok\w*|vape\w*|alcohol|temperature|pulse|blood pressure|hospital admission)\b/;
const ambiguousSymptom = /\b(?:cough\w*|fever\w*|vomit\w*|nause\w*|dizz\w*|light headed\w*|palpitation\w*|swelling|urina\w*|dysuria|weight loss|headache|chest pain|flank pain|back pain|abdominal pain|shortness of breath|breathless\w*|black stools?|diarrh\w*|faint\w*)\b/;
const bareSite = /^(?:and|what about|how about|into|to|in) (?:(?:in|into|to) )?(?:your |the )?(?:(?:left|right) )?(?:arm|jaw|back|shoulder(?: blade)?|neck)$/;

export function splitQuestions(input) {
  const parts = String(input).split(clauseBreak).map(text => text.trim()).filter(Boolean);
  // A greeting or courtesy sentence is part of the consultation, not a
  // clinical subquestion. Keep it in the original turn for rapport scoring.
  const clinical = parts.filter(part => /[\p{L}\p{N}]/u.test(part) &&
    !/^(?:hello|hi|good (?:morning|afternoon)|thanks|thank you)[.! ]*$/i.test(part));
  return clinical.length > 1 || (clinical.length === 1 && parts.length > 1) ? clinical : [String(input)];
}

export function analyzeQuestion(normalized, patient, context = {}) {
  const symptom = patient.presentingSymptom ?? PRESENTING_SYMPTOMS[patient.id];
  const explicit = symptom?.aliases?.test(normalized) ?? false;
  const active = context.activeSymptom?.name === symptom?.name && Boolean(symptom);
  const specificOther = !explicit && (otherTopic.test(normalized) || ambiguousSymptom.test(normalized));
  const pain = /\b(?:pain|hurt\w*|ache\w*|discomfort)\b/.test(normalized);
  const competingSymptom = /\b(?:pain|burning) (?:when|while|on) (?:passing urine|urinat\w*|peeing)\b|\b(?:and|or) (?:the |your )?(?:cough|fever|headache|dizziness|vomiting)\b/.test(normalized);
  const site = normalized.match(/\b(?:(left|right) )?(arm|jaw|back|shoulder(?: blade)?|neck)\b/);
  const negative = normalized.match(/\b(?:not|never|no|(?:did|do|does|is|are|was|were|has|have)nt)\b/g) ?? [];
  const [intent, attribute] = (active && bareSite.test(normalized) && context.lastAttribute === 'radiation.sites')
    ? ['hpi_radiation', 'radiation.sites']
    : active && context.lastIntent === 'hpi_onset' && normalized === 'when exactly'
      ? ['hpi_onset', 'onset.time']
      : facets.find(([, , rule]) => rule.test(normalized)) ?? [];
  const expectedValue = attribute === 'onset.type' ?
    /\b(?:sudden(?:ly)?|all at once|out of nowhere|fast)\b/.test(normalized) ? 'sudden' : 'gradual' : null;
  const hemoptysis = /\b(?:cough\w* up blood|blood (?:in (?:your )?(?:phlegm|sputum)|when (?:you )?cough))\b/.test(normalized);
  const namedMedicine = [...(patient.medicationFacts ?? []).map(item => item.name), ...MEDICATION_NAMES]
    .find(name => ` ${normalized} `.includes(` ${name} `));
  const medicationMentioned = medicationSubject.test(normalized);
  const medicine = namedMedicine ?? (!explicit && !specificOther && !medicationMentioned ? context.activeMedication : null);
  const medicationAttribute = (medicine || medicationMentioned) && [
    ['dose', /\b(?:dose|dosage|strength|mg|milligrams|how much|micrograms)\b/],
    ['frequency', /\b(?:how often|frequency|daily|how many times)\b/],
    ['indication', /\b(?:why|indication|what .* for)\b/]
  ].find(([, pattern]) => pattern.test(normalized))?.[0];
  const locationSide = normalized.match(/\b(left|right)\b/)?.[0] ?? null;
  const type = /\b(?:just to confirm|to confirm|is that right|correct me if|so you said)\b/.test(normalized) ? 'confirmation' :
    /\b(?:than|compared|versus)\b/.test(normalized) ? 'comparison' :
    /^(?:how (?:many|much|long|often|severe|bad)|on a scale)\b/.test(normalized) ? 'numerical' :
    normalized.match(/^(what|where|when|how|why|who)\b/)?.[0] ??
    (/^(?:do|does|did|is|are|was|were|have|has|had|any)\w*\b/.test(normalized) ? 'yes_no' :
      /^(?:tell|describe|explain)\b/.test(normalized) ? 'open' : 'follow_up');

  return {
    intent: medicationAttribute ? `medication_${medicationAttribute}` : hemoptysis ? 'ros_hemoptysis' : !specificOther && !competingSymptom && (explicit || active || (pain && (!symptom?.region || ['chest','abdomen','flank','head'].includes(symptom.region)))) ? intent ?? null : null,
    attribute: medicationAttribute ? (medicine ? `medication.${medicationAttribute}` : 'overview') : hemoptysis ? 'presence' : attribute ?? 'overview',
    type,
    expectedValue,
    negationCount: negative.length,
    target: medicationAttribute ? (medicine ? { medication: medicine } : null) : attribute === 'radiation.sites' && site ? { site: site[2], side: site[1] ?? null } : null,
    laterality: locationSide,
    region: explicit || active ? symptom?.region ?? null : null,
    symptom: explicit || active ? symptom?.name ?? null : null,
    contextUsed: Boolean(medicationAttribute && medicine && !namedMedicine || !medicationAttribute && !hemoptysis && active && !explicit && !pain && !specificOther),
    unresolvedReference: Boolean(!medicationAttribute && intent && ((!active && !explicit && !pain && !specificOther) || competingSymptom)),
    differentSymptom: Boolean(intent && (specificOther && !otherTopic.test(normalized) || competingSymptom)),
    explicitOtherTopic: specificOther && otherTopic.test(normalized)
  };
}
