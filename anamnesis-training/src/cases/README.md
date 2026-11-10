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
