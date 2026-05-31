export const responseTemplates = {
  uncertain: [
    'I am not sure what you mean. Could you ask that more directly?',
    'Could you clarify what you are asking about?',
    'I am not sure I understood. Could you ask that another way?'
  ],
  vaguePain: [
    'I am not sure what you mean. Could you ask that another way?',
    'Could you ask me that more directly?'
  ],
  repeated: [
    'As I said, {answer}',
    'I already mentioned this: {answer}',
    'It is the same as I told you earlier: {answer}'
  ],
  guardedSensitive: [
    'Not much, really.',
    'Only occasionally.',
    'I would rather not go into that unless it is important.'
  ],
  transition: [
    'Also, {answer}',
    'And {answer}',
    '{answer}'
  ],
  anxiousAdditions: [
    'It worries me.',
    'I am a bit scared by it.',
    'I was frightened enough to come in.'
  ],
  lowReliability: [
    'I think {answer}',
    'If I remember correctly, {answer}',
    'I am not completely sure, but {answer}'
  ],
  openingAcknowledgement: [
    'All right.',
    'Okay.',
    'Yes, doctor.'
  ]
};

export const layReplacements = {
  retrosternal: 'in the middle of my chest',
  dyslipidemia: 'high cholesterol',
  hypertension: 'high blood pressure',
  dyspnea: 'shortness of breath',
  myocardial: 'heart',
  exacerbation: 'flare-up',
  sputum: 'phlegm',
  syncope: 'fainting'
};
