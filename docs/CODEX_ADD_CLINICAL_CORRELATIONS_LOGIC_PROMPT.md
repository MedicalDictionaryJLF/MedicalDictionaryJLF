# Codex Task: Add Clinical Correlations Logic Layer

Use these files:

```text
clinical_correlations_logic.json
clinical_correlations.schema.json
clinical_correlations_flat.csv
```

## Goal

Add a clinical-correlation logic layer on top of the Anatomy Structures v2 database. This should allow the app to answer, search and quiz clinically relevant anatomical relationships such as:

- Which artery runs along the greater curvature of the stomach?
- Which artery is endangered by posterior duodenal ulcer?
- What passes through foramen spinosum?
- Which nerve is injured at the neck of the fibula?
- What is the order of contents in the femoral triangle?
- What structures are related to the cavernous sinus?

This is not a replacement for the Anatomy Structures database. It is a reasoning/query layer above it.

## Recommended paths

```text
data/anatomy/clinical_correlations_logic.json
data/schemas/clinical_correlations.schema.json
data/anatomy/clinical_correlations_flat.csv
```

## Required implementation

1. Validate the JSON during build.
2. Add a `clinicalCorrelationService` that can:
   - load correlations lazily
   - index by subject, target, relation_type, category, tags, course_tags and free text
   - search by natural wording such as “artery inferior greater curvature stomach”
   - return short and expanded exam answers
   - expose review/evidence status
3. Add search integration:
   - global search should show clinical correlations as their own result group
   - anatomy detail pages should show related clinical correlations
   - course week pages should show correlations matching that week’s course tags
4. Add quiz adapters:
   - structure → related artery/nerve/vein
   - injury site → vulnerable structure
   - foramen/canal/space → contents
   - clinical vignette → anatomical relation
   - ordered contents questions
5. Add an answer formatter.

## Answer format

A clinical correlation answer should include:

```text
Direct answer
Relation explanation
Why it matters clinically
Common trap
Review status
```

Example:

```text
Direct answer: right and left gastro-omental arteries.
Relation: they run along the greater curvature of the stomach, between layers of the greater omentum.
Clinical relevance: important during gastric surgery and bleeding along the greater curvature.
Trap: right and left gastric arteries follow the lesser curvature, not the greater curvature.
Status: seed record, review recommended.
```

## Matching logic

Support query normalization:

- lowercase
- remove diacritics
- remove filler words
- map synonyms:
  - gastroepiploic = gastro-omental
  - stomach lower border = greater curvature when context supports it
  - neck of fibula = fibular neck
  - funny bone = ulnar nerve behind medial epicondyle
  - water under bridge = ureter under uterine artery
  - LAD = anterior interventricular artery
  - CN = cranial nerve

## Safety and evidence

All records are educational seed entries. Show:

```text
Seed correlation – review recommended
```

Do not label them as faculty-reviewed until reviewed.

Do not use AI to invent missing relations. AI may only rephrase retrieved correlation records.

## Build validation

Validate:

- JSON parses
- schema passes
- all IDs are unique
- every correlation has at least one question template
- every correlation has a non-empty answer
- every query example maps to existing correlation IDs
- record count is 40

## UI placement

Add clinical correlations to:

- Anatomy search result cards
- Anatomy structure detail pages
- Course week pages
- Quiz generator
- Oral exam mode
- Dashboard weak-topic recommendations
