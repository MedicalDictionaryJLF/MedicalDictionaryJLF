# Patient Trainer + Anamnesis fix notes

## Patient Trainer question wording
Removed label-derived teaching questions such as `Can you tell me about name?` and `Can you tell me about chief complaint?`.

The active Patient Trainer now uses explicit patient-facing model questions for every non-objective interview intent. Examples:
- Name -> `What is your name?`
- Chief complaint -> `What brought you to hospital today?` / `What is bothering you most?`
- Medication -> `Do you take any regular medicines?`
- Social history -> `Who do you live with?` / `What is your home situation like?`
- Smoking -> `Do you smoke or vape?`

The generic question fallback was removed from the teaching companion, teaching-mode layout, checklist variants, and debrief prompt helper.

## SPTF correction in anamnesis-taking module
The previous Social/Occupational/Toxicological/Pharmacological interpretation was incorrect and its unused CSS and translation entries have been removed.
Added a dedicated **SPTF · Orthopaedic SPL finding** entry inside adult **Status Praesens Localis**, adjacent to the spine examination. It records examination status (not examined by default), anatomic site/laterality, and the finding. The abbreviation is deliberately not expanded because its full clinical wording was not verified; do not claim a particular orthopedic test or diagnosis based on the acronym alone.

## Cache/version bump
- Main app assets: v85
- Patient Trainer module assets: v135
- Patient Trainer client version: 2.5.1-anamnesis-engine-v85

## Validation performed
- `npm run test:anamnesis-ui` -> PASS
- Patient Trainer interview/question smoke test -> PASS
- `npm run build` -> PASS

Two pre-existing test failures remain outside this change:
- `anamnesis-training/tests/anamnesis_mode.test.mjs`: expects an explicit interview-language control independent of UI language.
- `scripts/patient-trainer-anamnesis-tests.mjs`: fails the existing patient-personality-variation assertion before reaching the question tests.
