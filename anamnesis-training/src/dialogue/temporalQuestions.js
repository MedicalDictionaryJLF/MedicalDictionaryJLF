// A temporal cue describes the question, never the patient's history.
const numbers = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const quantity = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten) (minute|hour|day|week|month|year)s?\b/;
const duration = /\b(?:last(?:s|ed|ing)?|duration)\b|\b(?:each|one) (?:attack|spell|episode)\b/;
const onset = /\b(?:start(?:ed)?|beg(?:in|an)|(?:came|come) on|first (?:appear\w*|happen\w*|notice\w*|feel|felt))\b/;
const arrival = /\bbefore (?:you )?(?:came in|arrived|admission|came to (?:the )?hospital)\b/;
const relative = /\b(?:ago|yesterday|today|last (?:night|week|month|year)|this (?:morning|afternoon|evening)|(?:mid)?night|noon)\b/;
const rate = /\b(?:once|twice|(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten) times) (?:a|per|each) (?:day|week|month)\b|\bevery (?:(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten) )?(?:hours?|days?|weeks?|months?)\b/;
const progression = /\b(?:get|got|getting|become|became|becoming) (?:better|worse)\b|\b(?:improv\w*|worsen\w*|changed?)\b/;
const eventLink = /\b(?:before|after|when) you (?:took|take|started|stopped|changed|missed|used)\b/;
const oneOffMedicine = /\b(?:did|had|have) you (?:just )?(?:take|taken|use|used)\b/;
const confirmed = /^(?:did|was|were|has|have|does|do|is|are|so)\b/;

export function temporalCue(question) {
  const numeric = question.match(quantity);
  const numericValue = numeric ? numbers[numeric[1]] ?? Number(numeric[1]) : null;
  const amount = numeric && Number.isSafeInteger(numericValue) &&
    !/\d[.,]\d|\d \d/.test(question.slice(Math.max(0, numeric.index - 2), numeric.index + numeric[0].length))
    ? { value: numericValue, unit: numeric[2] } : null;
  const anchor = question.match(arrival)?.[0] ?? question.match(relative)?.[0] ?? null;
  const frequency = question.match(rate)?.[0];
  const confirmation = confirmed.test(question);
  if (duration.test(question) && (numeric || /\bhow long\b/.test(question))) return { role: 'duration', amount, confirmation };
  if (onset.test(question) && eventLink.test(question)) return { role: 'event_relative', confirmation };
  if (oneOffMedicine.test(question) && (anchor || /\b(?:before|after)\b/.test(question)) && !frequency) {
    return { role: 'one_off_medication', confirmation };
  }
  if (progression.test(question) && anchor) return { role: 'progression', confirmation };
  if (frequency) return { role: 'frequency', confirmation, rate: frequency };
  if (anchor && (onset.test(question) || /^(?:was|were|did) (?:it|that) (?:happen )?(?:(?:about|around) )?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|yesterday|last night|this morning)\b/.test(question))) {
    return { role: 'onset', anchor, amount, confirmation };
  }
  if (anchor && /^(?:about |around )?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten) (?:minutes?|hours?|days?|weeks?|months?|years?) (?:ago|before you (?:arrived|came in))$/.test(question)) {
    return { role: 'onset_followup', anchor, amount, confirmation: true };
  }
  return null;
}

export function temporalFacet(cue, question, symptomIsActive, medicationIsActive, lastAttribute) {
  if (!cue) return null;
  if (cue.role === 'frequency' && medicationIsActive && /\b(?:take|taking|meds|medicines?|medications?|pills?|tablets?)\b/.test(question)) {
    return ['medication_frequency', 'overview'];
  }
  if (!symptomIsActive) return null;
  if (cue.role === 'onset' || (cue.role === 'onset_followup' && lastAttribute === 'onset.time')) return ['hpi_onset', 'onset.time'];
  if (cue.role === 'duration') return ['hpi_timing', 'timing.duration'];
  if (cue.role === 'progression') return ['hpi_course', 'progression'];
  if (cue.role === 'frequency' && /\b(?:happen|occur|attacks?|episodes?)\b/.test(question)) return ['hpi_timing', 'timing.frequency'];
  return null;
}
