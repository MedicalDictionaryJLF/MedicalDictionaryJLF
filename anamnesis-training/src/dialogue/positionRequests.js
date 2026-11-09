const REQUEST_PREFIX = /^(?:(?:could|can|would|will) you (?:be able to )?|are you able to |(?:i(?:'d| would) like you to|i need you to) )?(?:please )?/;
const STAND = /^(?:stand(?: up| upright)?|(?:get|rise) to your feet)(?: (?:for me|please))?$/;
const SIT = /^(?:sit(?: (?:down|up|upright|back(?: down)?))?|take a seat)(?: (?:on|in) (?:(?:a|the|your|this|that) )?chair)?(?: (?:for me|please))?$/;
const LIE = /^(?:lie|lay|lye)(?: down)?(?: flat)?(?: on your back| supine)?(?: on (?:the )?(?:bed|exam(?:ination)? table|couch))?(?: (?:for me|please))?$/;
const BEND_KNEES = /^(?:slightly )?(?:bend|flex) (?:both your |both |your )?knees(?: (?:slightly|a little|for me|please))*$/;

export function getPositionRequest(message, currentPosition) {
  const text = String(message || '').toLowerCase().replaceAll('’', "'")
    .replace(/,/g, ' ').replace(/\s+/g, ' ').trim().replace(/[?!.]+$/, '')
    .replace(/^(?:hello|hi|hey)[!?.]? /, '').replace(/^please /, '').replace(REQUEST_PREFIX, '');
  if (STAND.test(text)) return 'standing';
  if (SIT.test(text)) return 'seated';
  if (LIE.test(text)) return 'reclined';

  const [first, second, ...rest] = text.split(/(?: and | with (?:your )?)/);
  if (!rest.length && LIE.test(first) && second &&
      (BEND_KNEES.test(second) || /^(?:your )?knees (?:slightly )?(?:bent|flexed)(?: slightly)?(?: please)?$/.test(second))) {
    return 'abdominal';
  }
  if (BEND_KNEES.test(text)) {
    return ['reclined', 'abdominal'].includes(currentPosition) ? 'abdominal' : 'needs-reclining';
  }
  return null;
}
