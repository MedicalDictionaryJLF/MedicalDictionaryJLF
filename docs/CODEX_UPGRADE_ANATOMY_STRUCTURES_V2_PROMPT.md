# Codex Task: Replace Anatomy Structures Seed With Elaborated v2 Database

Use these files:

```text
anatomy_structures_core_elaborated.json
anatomy_structures_v2.schema.json
anatomy_structures_core_elaborated_flat.csv
anatomy_structures_question_bank_seed.json
anatomy_structures_oral_rubrics_seed.json
anatomy_structures_clinical_bridges_seed.json
```

## Goal

Upgrade the previous core anatomy-structures seed to a richer v2 database. This is still meant to complement the existing muscle CSV/JSON, not replace it.

## Recommended paths

```text
data/anatomy/anatomy_structures_core_elaborated.json
data/schemas/anatomy_structures_v2.schema.json
data/anatomy/anatomy_structures_core_elaborated_flat.csv
data/anatomy/anatomy_structures_question_bank_seed.json
data/anatomy/anatomy_structures_oral_rubrics_seed.json
data/anatomy/anatomy_structures_clinical_bridges_seed.json
```

## Data summary

- Structure records: 311
- Relationships: 256
- Question seeds: 10
- Oral rubrics: 4
- Clinical bridge cases: 5

## Requirements

1. Replace the old `anatomy_structures_core.json` loader target with `anatomy_structures_core_elaborated.json`.
2. Keep the old file only if needed for migration tests; do not load both simultaneously in production UI.
3. Validate the v2 schema at build time.
4. Validate that every relationship source and target ID exists.
5. Add this database to global search with matched-field labels.
6. Add filtering by `type`, `region`, `system`, `course_tags`, and `exam_importance`.
7. Render a structured detail page with:
   - English and Latin terms
   - type badge
   - region/system
   - key features
   - details table
   - clinical notes
   - relationship graph
   - oral exam prompts
   - common confusions
   - quiz actions
   - review status badge
8. Integrate question-bank seed into the generic quiz engine as draft/review content.
9. Integrate oral rubrics into oral exam mode.
10. Integrate clinical bridge cases into anatomy course pages and review sessions.
11. Mark all records as educational seed requiring review until verified.
12. Do not overwrite or remove the muscles dataset.
13. Use relationships to support graph navigation, not just text display.
14. Ensure the app remains static-host compatible.

## Important UI wording

Show a small badge on unreviewed records:

```text
Seed anatomy record – review recommended
```

Do not present this database as faculty-reviewed until review status changes.

## Suggested search test queries

```text
median nerve
nervus medianus
foramen ovale
middle meningeal artery
cavernous sinus
femoral triangle
dorsalis pedis
pituitary gland
visual pathway
thoracic duct
```

## Acceptance criteria

- All v2 JSON files parse.
- Structure record count is 311.
- Relationship count is 256.
- No duplicate structure IDs.
- All relationship endpoints resolve.
- Global search returns anatomy structures.
- Detail pages render for a bone, artery, vein, nerve, foramen, organ and pathway.
- Quiz seeds can be previewed without being treated as reviewed faculty content.
- Oral rubrics and clinical bridge cases appear in the relevant anatomy course tools.
