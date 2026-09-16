# Patient Trainer

Standalone development build for the Medical Dictionary Patient Trainer.

## Current source layout

```text
src/
├── cases/                  Patient-specific facts and case configuration
│   ├── peterNovak.js
│   ├── janaKovacova.js
│   └── index.js
├── data/
│   ├── interviewSchema.js  Shared intents/question areas
│   ├── physicalExamMap.js
│   └── examSoundLibrary.js
├── dialogue/
│   └── responseTemplates.js  Reusable patient wording with placeholders
├── ui/
│   ├── clinicalEncounterPanels.js
│   ├── ecgLeadPlacement.js
│   └── interactivePhysicalExam.js
├── main.js
├── patientEngine.js
├── monitorWaveforms.js
└── vitalsMonitor.js
```

Patient-specific values belong in `src/cases/`. Reusable English phrasing does not.

Example:

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

The shared dialogue layer renders those values using templates such as:

```js
identity_dob: 'I was born on {identity.dob}.'
```

Clinical narrative that genuinely belongs to a particular case can stay as patient-ready text
inside that case file.

## Adding a case

1. Copy an existing file in `src/cases/`.
2. Change the case `id` and patient-specific data.
3. Add the new export to `src/cases/index.js`.
4. Do not add patient-specific facts to `interviewSchema.js`, `patientEngine.js`, or the shared
   response template file.

The integrated Medical Dictionary build follows the same case/template layout under
`anamnesis-training/src/`.

## Validation

Run:

```bash
npm test
```

The current test suite covers case/template rendering, debrief regression, the interactive
physical examination, ECG lead placement, and monitor waveforms.
