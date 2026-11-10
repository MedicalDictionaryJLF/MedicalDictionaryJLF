import { POSITIONING_COMMANDS } from '../data/positioningCommands.js?v=2';

const REQUEST_PREFIX = /^(?:(?:could|can|would|will) you (?:be able to )?|are you able to |(?:i(?:'d| would) like you to|i need you to) )?(?:please )?/;
const posePatterns = Object.fromEntries(Object.entries(POSITIONING_COMMANDS)
  .map(([pose, command]) => [pose, new RegExp(command.pattern)]));
const bentKnees = new RegExp(POSITIONING_COMMANDS.abdominal.descriptivePattern);

export function getPositionRequest(message, currentPosition) {
  const text = String(message || '').toLowerCase().replaceAll('’', "'")
    .replace(/,/g, ' ').replace(/\s+/g, ' ').trim().replace(/[?!.]+$/, '')
    .replace(/^(?:hello|hi|hey)[!?.]? /, '').replace(/^please /, '').replace(REQUEST_PREFIX, '');
  const [first, second, ...rest] = text.split(/(?: and | with (?:your )?)/);
  if (!rest.length && second && posePatterns.reclined.test(first) &&
      (posePatterns.abdominal.test(second) || bentKnees.test(second))) {
    return 'abdominal';
  }

  const pose = Object.entries(posePatterns).find(([, pattern]) => pattern.test(text))?.[0];
  if (pose && POSITIONING_COMMANDS[pose].allowedStartingPoses &&
      !POSITIONING_COMMANDS[pose].allowedStartingPoses.includes(currentPosition)) {
    return 'needs-reclining';
  }
  return pose ?? null;
}
