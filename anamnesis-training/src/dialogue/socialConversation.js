// Social clauses belong to the consultation without contributing clinical facts.
const acts = [
  ['introduction', /^(?:(?:hello|hi|hey|good morning|good afternoon) )?(?:(?:my name is|im|i am) [a-z]+(?: [a-z]+){0,3} (?:and )?)?(?:i am |im |iam |ill be |i will be )?(?:going to be )?(?:your|a|the) (?:medical student|nursing student|student nurse|student doctor|nurse|doctor|student)(?: looking after you| taking care of you)?(?: for today| today)?$/],
  ['introduction', /^(?:(?:hello|hi|hey|good morning|good afternoon) )?my name is [a-z]+(?: [a-z]+){0,2}$/],
  ['introduction', /^(?:hello|hi|hey) (?:im|i am) [a-z]+(?: [a-z]+)?$/],
  ['introduction', /^(?:im|i am) here to ask you (?:a few |some )?questions$/],
  ['greeting', /^(?:hello|hi|hey|good morning|good afternoon|good evening)(?: there)?$/],
  ['check_in', /^(?:(?:hello|hi|hey) )?how are you(?: doing)?(?: today)?$/],
  ['permission', /^(?:is it (?:okay|alright) if i (?:ask|speak)|(?:can|may|could) i ask|would you mind if i asked)(?: you)? (?:a few |some )?questions(?: about (?:your health|what happened|how youre feeling))?$/],
  ['empathy', /^(?:(?:im|i am) sorry (?:to hear that|youre going through (?:that|this)|youve been through that)|that sounds (?:hard|difficult|frightening|scary|upsetting|painful|uncomfortable)|i can see (?:this|that) has been (?:hard|difficult|frightening|upsetting))$/],
  ['reassurance', /^(?:we can take (?:our|your) time|take your time|theres no rush|we can pause (?:if you need|for a moment))$/],
  ['thanks', /^(?:(?:okay|ok|alright) )?(?:thanks|thank you)(?: very much| so much| for (?:telling me|your time|explaining|letting me know|sharing that|answering (?:my|the) questions))?$/],
  ['closing', /^(?:goodbye|bye(?: for now)?|take care|i(?:ll| will) (?:be back (?:soon|shortly)|come back later)|thats all(?: for now| from me)?|were done for now)$/],
  ['acknowledgment', /^(?:okay|ok|alright|all right|right|yes|no|i see|i understand|got it|that makes sense|fair enough|(?:okay |ok )?thats (?:fine|helpful|good|amazing)|(?:okay |ok )?that is (?:fine|helpful|good|amazing))$/]
];

const replies = {
  introduction: 'Hello. Nice to meet you.',
  greeting: 'Hello.',
  check_in: 'I’m glad we can talk.',
  permission: 'Yes, of course. Go ahead.',
  empathy: 'Thank you. I appreciate that.',
  reassurance: 'Thank you. That helps.',
  thanks: 'You’re welcome.',
  closing: 'Thank you for your time.',
  acknowledgment: 'All right.'
};

export function getSocialAct(normalized) {
  return acts.find(([, pattern]) => pattern.test(normalized))?.[0] ?? null;
}

export function socialReply(act) {
  return replies[act];
}
