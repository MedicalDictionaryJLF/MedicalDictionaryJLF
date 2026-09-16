// Shared patient-language templates.
// Case files contain patient-specific values. Keep reusable wording here.

export const RESPONSE_TEMPLATES = Object.freeze({
  identity_name: 'My name is {identity.name}.',
  identity_age: 'I am {identity.age} years old.',
  identity_dob: 'I was born on {identity.dob}.',
  identity_sex: 'I am {identity.sex}.',
  identity_residence: 'I live in {identity.residence}.',
  identity_occupation: 'I work as {identity.occupation}.',
  administrative_admission_time: 'I came to the hospital {administrative.admissionTime}.'
});

export const SHARED_PATIENT_PHRASES = Object.freeze({
  uncertain: [
    'I am not sure what you mean. Could you ask that more directly?',
    'Could you clarify what you are asking about?',
    'I am not sure I understood. Could you ask that another way?'
  ],
  repeated: [
    'As I said, {answer}',
    'I already mentioned this: {answer}',
    'It is the same as I told you earlier: {answer}'
  ]
});

export function getCaseValue(patientCase, path) {
  return String(path || '')
    .split('.')
    .filter(Boolean)
    .reduce((value, key) => value == null ? undefined : value[key], patientCase);
}

export function renderTemplate(template, patientCase, extraValues = {}) {
  return String(template || '').replace(/\{([^}]+)\}/g, (_match, token) => {
    const key = String(token || '').trim();
    const value = Object.prototype.hasOwnProperty.call(extraValues, key)
      ? extraValues[key]
      : getCaseValue(patientCase, key);
    return value == null ? '' : String(value);
  }).replace(/\s+([,.!?;:])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

export function renderIntentAnswer(intentId, patientCase, answerKeys = []) {
  const template = RESPONSE_TEMPLATES[intentId];
  if (template) {
    const rendered = renderTemplate(template, patientCase);
    if (rendered && !/\{[^}]+\}/.test(rendered)) return rendered;
  }

  return answerKeys
    .map((path) => getCaseValue(patientCase, path))
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value) => value !== undefined && value !== null && value !== '')
    .map(String)
    .join(' ')
    .trim();
}
