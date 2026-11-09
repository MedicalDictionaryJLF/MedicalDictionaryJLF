// English command and response data shared by the position matcher and patient dialogue.
export const POSITIONING_COMMANDS = {
  seated: {
    intent: 'position.sit',
    commands: ['Can you sit on a chair?', 'Please sit up.', 'Could you take a seat?', 'Please sit back in the chair.'],
    pattern: '^(?:sit(?: (?:down|up|upright|back(?: down)?))?|take a seat)(?: (?:on|in) (?:(?:a|the|your|this|that) )?chair)?(?: (?:for me|please))?$',
    reply: 'Of course. I’ll sit upright.'
  },
  standing: {
    intent: 'position.stand',
    commands: ['Please stand up.', 'Could you get to your feet, please?', 'Could you stand upright?'],
    pattern: '^(?:stand(?: up| upright)?|(?:get|rise) to your feet)(?: (?:for me|please))?$',
    reply: 'Of course. I’ll stand up.'
  },
  reclined: {
    intent: 'position.lie_flat',
    commands: ['Could you lie down on the bed?', 'Please lie supine.', 'Hello, would you be able to lie down for me?', 'Can you lye down on the bed for me?'],
    pattern: '^(?:lie|lay|lye)(?: down)?(?: flat)?(?: on your back| supine)?(?: on (?:the )?(?:bed|exam(?:ination)? table|couch))?(?: (?:for me|please))?$',
    reply: 'Of course. I’ll lie on my back.'
  },
  abdominal: {
    intent: 'position.lie_with_knees_bent',
    commands: ['Could you lie on your back and bend your knees slightly?', 'Please lie on the bed with your knees flexed slightly.', 'Could you bend your knees a little?'],
    pattern: '^(?:slightly )?(?:bend|flex) (?:both your |both |your )?knees(?: (?:slightly|a little|for me|please))*$',
    descriptivePattern: '^(?:your )?knees (?:slightly )?(?:bent|flexed)(?: slightly)?(?: please)?$',
    allowedStartingPoses: ['reclined', 'abdominal'],
    reply: 'Of course. I’ll lie on my back with my knees slightly bent.'
  }
};

export const POSITIONING_REPLIES = {
  needsReclining: 'Would you like me to lie down first?',
  teachingOnly: 'Position requests are available in Teaching mode.',
  viewUnavailable: 'I can’t change position while the 3D view is unavailable.'
};
