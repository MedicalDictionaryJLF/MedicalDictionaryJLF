# Gynaecological and obstetric anamnesis update

Extends the existing obstetric workflow; the shared identification and chief-complaint builders and established field keys remain unchanged.

## Behaviour

- Antenatal/postpartum switching preserves both pathways in the existing obstetric record bucket. Collapsible sections retain scope metadata and translated titles.
- Conditional delivery fields, positive-answer follow-ups, repeatable previous pregnancies, fetuses, newborns, dated encounters and investigation results remain structured.
- Added pregnancy risk documentation, parity convention, prior pregnancy count, previous birth weights, planned/emergency Caesarean status, hypertension follow-up, psychological symptoms, clinical-source sections and optional section notes.
- Investigations record name, date, result, units, reference information and follow-up. Newborn measurements are labelled by entry in reports.
- LMP-based estimates are separated from clinically accepted dates. Future LMP values do not generate estimates. Accepted EDD can supply a separate gestational-age estimate. Manual dating fields are retained.
- Empty answers remain not recorded; explicit negative, unknown, not asked and not applicable choices remain distinct. Section badges distinguish unanswered, partially documented and documented sections.
- Breast-health questions remain accessible after pregnancy loss. Explicitly recorded urgent symptoms produce educational prompts, not diagnoses.
- Reports identify the correct pathway in English/Slovak, include derived intervals and retain the existing editable report/copy workflow.
- Removed repeatable entries no longer reappear after save/reopen. Unknown future-schema keys remain preserved. Existing flat field names are retained; an additive `ob_schema_version` marks the updated data.

## Verification

`npm run test:obstetric`: structural checks and 22 DOM interaction assertions, including real application report/collection/enhancement helpers.

`npm run test:anamnesis-ui`: existing regression suite passed.

`npm run build`: static build and anatomy-data validation passed.

`git diff --check` and JavaScript syntax checks passed.

Browser visual QA could not run: Chromium was blocked by the execution environment's socket restriction. DOM tests do not establish pixel appearance, mobile layout or full application end-to-end behaviour.

## Dating reference

ACOG Committee Opinion 700, Methods for Estimating the Due Date:
https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2017/05/methods-for-estimating-the-due-date

The LMP estimate uses 280 days and does not replace the clinically established dating basis.
