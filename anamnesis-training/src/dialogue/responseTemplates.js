// English realization. Other languages can use the same fact and question records.
import { FACT_STATE } from './clinicalFacts.js?v=pilot-4';

const finish = text => text ? text[0].toUpperCase() + text.slice(1).replace(/[.]+$/, '') + '.' : '';
const list = (items, conjunction = 'and') => items.length < 2 ? items.join('') :
  [items.slice(0, -1).join(', '), items.at(-1)].join(` ${conjunction} `);
const quantity = ({ value, max, unit, about, limit }) =>
  [limit || (about ? 'about' : ''), max == null ? value : `${value} to ${max}`,
    unit + (value === 1 && max == null ? '' : 's')].filter(Boolean).join(' ');
const article = noun => /^[aeiou]/i.test(noun) ? 'an' : 'a';
const indefinite = noun => /^(a|an|the) /i.test(noun) ? noun : `${article(noun)} ${noun}`;

const identityRules = {
  identity_name: name => `My name is ${name}`,
  identity_age: age => Number.isFinite(age) ? `I am ${age} years old` : '',
  identity_dob: date => `I was born on ${date}`,
  identity_sex: sex => `I am ${sex}`,
  identity_residence: place => `I live in ${place}`,
  identity_occupation: job => `I work as ${indefinite(job)}`,
  administrative_admission_time: time => `I came to the hospital ${time}`
};

const radiation = (value, target) => {
  if (value.state === FACT_STATE.ABSENT) return 'It does not spread';
  if (target) {
    const related = value.values.filter(site => site.includes(target.site));
    if (!related.length) return ''; // The listed sites are documented. Other sites are not.
    if (target.side && !related.some(site => site.startsWith(target.side))) {
      return `It spreads to my ${list(related, 'and my')}`;
    }
    return `I feel it in my ${list(related, 'and my')}`;
  }
  return `It spreads to my ${list(value.values, 'and my')}`;
};

const englishRules = {
  location: place => `It is ${place}`,
  'onset.time': value => `${value.subject ?? 'It'} ${value.verb ?? 'started'} ${value.phrase ??
    (quantity(value) + (({ admission: ' before I came to the hospital', interval: '' }[value.reference] ?? ' ago')))}`,
  'onset.type': type => ({ sudden: 'It came on suddenly', gradual: 'It came on gradually' })[type],
  'onset.activity': value => typeof value === 'string' ? `I was ${value} when it started` :
    `I first noticed it while ${value.activity}`,
  'character.qualities': value => `It feels like ${list(value.positive, 'or')}${value.negative?.length ? `, rather than ${list(value.negative, 'or')}` : ''}`,
  'radiation.sites': radiation,
  'timing.pattern': value => `It ${value}`,
  'timing.duration': value => {
    const episode = value.episode;
    const duration = quantity(value);
    if (episode === 'attacks') return `The attacks last ${duration}${value.condition ? ` ${value.condition}` : ''}`;
    return `The ${episode} lasted ${duration}${value.source ? `, according to ${value.source}` : ''}`;
  },
  'timing.frequency': value => `I have passed ${value.count} ${value.event}${value.count === 1 ? '' : 's'} ${value.period}`,
  'severity.current': value => `${value.reference === 'today' ? 'Today' : 'Right now'} it is ${value.qualifier ? `${value.qualifier} ` : ''}${value.value} out of ${value.scale}`,
  'severity.worst': value => `At its worst it was ${value.value} out of ${value.scale}`,
  progression: value => `It ${value}`,
  presence: (value, _target, intent) => {
    if (intent === 'ros_hemoptysis') return value.state === FACT_STATE.ABSENT ?
      'I have not coughed up blood' : 'I have coughed up blood';
    return '';
  }
};

function realizeClause({ subject = 'I', verb, complement, negative = false, auxiliary }) {
  if (typeof verb !== 'string' || typeof complement !== 'string') return '';
  const predicate = auxiliary ? `${auxiliary}${negative ? ' not' : ''} ${verb}` :
    negative ? `do not ${verb}` : verb;
  return finish(`${subject} ${predicate} ${complement}`);
}

function realizeMedication(drug, attribute) {
  const [, key] = attribute.split('.');
  if (key === 'dose' && Number.isFinite(drug.dose) && drug.dose > 0 &&
      ['mg', 'g', 'micrograms'].includes(drug.unit)) {
    return `I take ${drug.dose} ${drug.unit} of ${drug.name}`;
  }
  if (key === 'frequency' && drug.frequency) return `I take ${drug.name} ${drug.frequency}`;
  if (key === 'indication' && drug.indication) return `I take ${drug.name} for ${drug.indication}`;
  return '';
}

function isComplete(value, attribute) {
  if (value == null) return false;
  if (['severity.current', 'severity.worst'].includes(attribute)) {
    return Number.isFinite(value.value) && Number.isFinite(value.scale) && value.value >= 0 && value.value <= value.scale;
  }
  if (['onset.time', 'timing.duration'].includes(attribute)) {
    return Boolean(value.phrase) || (Number.isFinite(value.value) && value.value >= 0 &&
      ['minute', 'hour', 'day', 'week', 'month', 'year'].includes(value.unit) &&
      (value.max == null || (Number.isFinite(value.max) && value.max >= value.value)) &&
      (attribute !== 'timing.duration' || Boolean(value.episode)));
  }
  if (attribute === 'radiation.sites') return value.state === FACT_STATE.ABSENT ?
    value.values?.length === 0 : Array.isArray(value.values) && value.values.length > 0;
  if (attribute === 'onset.activity') return typeof value === 'string' ? Boolean(value) : typeof value.activity === 'string' && Boolean(value.activity);
  if (attribute === 'timing.frequency') return Number.isInteger(value.count) && value.count >= 0 && Boolean(value.event && value.period);
  if (attribute === 'character.qualities') return Array.isArray(value.positive) && value.positive.length > 0;
  return value !== '';
}

export function realizeEnglish(fact, question = {}) {
  const { state, value, intent, attribute } = fact;
  if ([FACT_STATE.UNKNOWN, FACT_STATE.NOT_AUTHORED, FACT_STATE.NOT_ASKED].includes(state)) return null;
  if (state === FACT_STATE.NOT_APPLICABLE) return { text: 'That does not apply to me.', rule: 'not_applicable' };
  if ([FACT_STATE.PRESENT, FACT_STATE.ABSENT].includes(state) && typeof value?.text === 'string' && value.text.trim()) {
    return { text: value.text.trim(), rule: 'authored_text' };
  }
  if (state === FACT_STATE.NARRATIVE) {
    const pattern = identityRules[intent];
    const text = pattern ? finish(pattern(value)) :
      (Array.isArray(value) ? value : [value]).filter(item => ['string', 'number'].includes(typeof item)).join(' ').trim();
    return text ? { text, rule: pattern ? `english.${intent}` : 'authored_narrative' } : null;
  }
  if (attribute === 'overview' && Array.isArray(value?.clauses) && value.clauses.length) {
    const clauses = value.clauses.map(realizeClause);
    return clauses.every(Boolean) ? { text: clauses.join(' '), rule: 'english.clauses' } : null;
  }
  if (attribute.startsWith('medication.') && value) {
    const text = finish(realizeMedication(value, attribute));
    return text ? { text, rule: 'english.medication' } : null;
  }
  const pattern = englishRules[attribute];
  if (!pattern || !isComplete(value, attribute)) return null;
  const text = finish(pattern(value, question.target, intent));
  return text ? { text, rule: `english.${attribute}` } : null;
}
