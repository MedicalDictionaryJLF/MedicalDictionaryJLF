# Worksheet content and checkbox interaction

Follow-up to merged PR #20, based on the supplied `ANAMNESIS_Gynaecology.pdf` and `ANAMNESIS_Obstetrics.pdf`.

## Behaviour

- General gynaecology is available alongside antenatal and postpartum within the existing combined module. The existing two header builders remain unchanged.
- Structured single-answer questions use visible, labelled checkboxes. Checking a new choice clears the previous choice; unchecking the selected choice leaves the answer not recorded. Existing select values remain the canonical stored representation so saved records, conditional display, summaries and repeaters continue to work.
- Symptom and examination checklists allow multiple selections. An unchecked symptom is not treated as a negative finding. Explicit negatives and not-assessed details have a separate notes field.
- Worksheet additions cover SOCRATES details, menstrual and sexual history, gynaecological conditions, screening, family/social history, ROS, SPG, measured values, gynaecological examination, antenatal care/examination, postpartum assessment and student documentation review.
- Medications, allergies and procedures/hospitalisations have repeatable structured entries; legacy narrative fields remain intact.
- The additive worksheet schema is separate from rendering logic. English/Slovak labels and stable IDs are provided. The saved schema marker advances to 3 without renaming existing keys.
- All pathway answers remain stored when switching. Reports include the active pathway and shared data only. Consent, observed findings and clinician assessments are labelled separately.

## Validation

- `npm run test:obstetric`: structural checks plus 34 DOM assertions. New assertions exercise real checkbox input events, mutually exclusive choices, clearing, multi-select symptoms, saved-value restoration, medication rows, general gynaecology reports and pathway preservation.
- Existing `npm run test:anamnesis-ui` regression suite passed.
- `npm run build`, JavaScript syntax checks and `git diff --check` passed.
- Visual desktop/mobile browser testing remains outstanding because Chromium cannot run in this environment. The changes reuse existing layout styles with scoped checkbox wrapping rules; DOM tests are not pixel-layout verification.

The PDFs remain reference material and are not added to the public repository. No changes to patient data or automatic diagnostic decisions are introduced.
