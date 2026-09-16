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
