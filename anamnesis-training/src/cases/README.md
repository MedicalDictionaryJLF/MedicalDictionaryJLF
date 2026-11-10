# Adding a Patient Trainer case

Patient-specific facts belong in this folder. Reusable patient wording belongs in
`../dialogue/responseTemplates.js`.

For identity fields, store values rather than complete English sentences:

```js
identity: {
  name: 'Peter Novak',
  age: 58,
  dob: '14 March 1968',
  sex: 'male',
  residence: 'Martin',
  occupation: 'a bus driver'
}
```

The dialogue layer renders these values with shared templates such as
`My name is {identity.name}.` and `I was born on {identity.dob}.`

Clinical narrative that is genuinely specific to a case (HPI, ROS, medication,
family history, examination findings, labs, etc.) can remain as patient-ready
text in the case file.

## Authoring and validating interview answers

Use existing case fields for simple patient-ready answers. The engine reads the
authored case, so an omitted answer never inherits a generic negative from scene
defaults. For precise wording or explicit uncertainty, use a structured override
keyed by the shared interview intent and question facet.

```js
conversationFacts: {
  allergies: { overview: { state: 'unknown' } },
  ros_dyspnea: { overview: { state: 'absent', text: 'I have not felt short of breath.' } }
}
```

An omitted fact means unavailable. An explicit unknown means the patient is
unsure. Use an authored negative only when the case establishes it. For
generated wording, existing structured facet values and clause lists still work.
Overrides apply per facet and keep other authored facets available.

A family-history overview can assemble existing atomic answers from
`familyDetails` and structured facts. Use `familyOverviewTopics` to specify which
topics the patient discloses in an open answer. Without a selection, cases with
no legacy `familyHistory` text can use their authored family topics. Credit is
based on the facts actually rendered in the reply.

Run `npm run validate:patient-conversation -- --json` after adding or editing a
case. The report identifies missing graded answers, unknown facts, and the source
fields for each gap. Invalid structured answers and broken topic references fail
validation. Review coverage gaps separately before publishing the case.

## Extending the question bank

Add complete student utterances to `../data/questionVariants.js` and map each
one to its existing intent. Patient-specific answers stay in the case records.
For a short follow-up, list the preceding intents that make its meaning clear.
Run `npm run test:patient-trainer-conversation` to check the bank against all
patients and modes, including follow-ups with the wrong preceding topic.

## Subject-specific details

For a symptom other than the presenting complaint, add a case-authored
`subjectHistory` entry keyed by its review-of-systems intent. Use a facet key
such as `onset.time` or `timing.duration` to supply the relevant answer.

```js
subjectHistory: {
  ros_back_pain: { 'onset.time': 'My usual back pain started last winter.' }
}
```

If a future case needs extra wording for that subject, set
`subjectAliases.ros_back_pain` to an object with a display `name` and an array
of lowercase `aliases`. For a recent meal or fluid intake, set
`intake.lastMeal` or `intake.recentFluids` when the station specifies it.

## Follow-up pilot

Use one previously tested case and one new case. Ask students to switch between
two symptoms, follow with “When did it start?”, correct the subject if needed,
and open the answer from the coverage panel. Repeat separately in Teaching,
Practice, and Exam, and in the examination workflow. In Exam, look for the
transcript links after submission.

Record clarifications, unavailable case details, and AI requests separately.
Review a sample of fluent replies against the intended subject, the authored
case fact, and the resulting coverage. Count wrong-topic replies, unsupported
facts, and wrong coverage as distinct errors, even when the reply reads well.
