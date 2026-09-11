# Anatomy Foundation v2.1

## What changed

The Anatomy database is now the canonical source for skeletal muscles as well as the existing bones, joints, ligaments, vessels, nerves, organs and CNS structures.

- Core concepts before: 311
- Canonical muscle concepts added: 225
- Unified Anatomy concepts: 536
- Relationships before: 256
- Conservative muscle-derived relationships added: 386
- Unified relationships: 642
- Muscle concepts with at least one explicit graph relation: 184 / 225 (81.8%)
- Clean legacy muscle rows retained for compatibility: 226

## Data corrections

- Repaired the malformed `Musculus epicranius` CSV row so every muscle row has the full 14-column schema.
- Removed one exact duplicate `Lateral pterygoid muscle` row.
- Represented `Palatopharyngeus muscle` as one canonical concept with two curricular classification contexts instead of two anatomy concepts.
- Slovak and German region/category labels are no longer used as if they were translations of the muscle itself.

## Canonical muscle model

Each muscle is now an Anatomy structure with:

- stable `muscle_*` ID
- English preferred name
- Latin preferred name
- nullable Slovak/German preferred names pending reviewed terminology
- normalized region and `muscular` system
- source classifications in EN/SK/DE
- parts
- origin
- insertion
- innervation
- blood supply
- actions
- evidence/review metadata

The original `terminology/muscles.csv` remains as a cleaned legacy/editorial source, but the runtime Anatomy browser and Muscle Training derive muscle records from the canonical Anatomy database.

## Graph relations added

The migration creates only conservative relations where an existing Anatomy concept can be matched directly from source text:

- `innervated_by`: 132
- `originates_from`: 108
- `supplied_by`: 92
- `inserts_on`: 54

These are marked `migrated_from_legacy_muscles_csv_needs_review`, so generated links do not pretend to be faculty-verified.

## Quality gate

New command:

```bash
npm run validate:anatomy-data
```

It validates IDs, parents, relation endpoints/types, muscle structure, CSV width, exact duplicates, flat-export parity and guards against the previous category-as-translation bug.

`npm run build` now runs this validator automatically and fails if Anatomy integrity is broken.

## Current review queue

The biggest remaining content gap is multilingual terminology:

- EN preferred names: 536 / 536
- LA preferred names: 536 / 536
- SK preferred names: 0 / 536
- DE preferred names: 0 / 536

41 / 225 muscle concepts currently have structured OINA data but no graph target that could be matched conservatively against the existing 311 core structures. This is mostly because the target anatomy concept is not yet represented at sufficient granularity.

## Recommended Anatomy v2.2 work

1. Add reviewed Slovak and German preferred terms and aliases.
2. Expand bones/landmarks, fasciae, aponeuroses, tendons and smaller nerve/artery branches needed by the 41 unlinked muscle concepts.
3. Normalize legacy relationship types such as `part_or_branch_of` and `passes_through_or_lies_in` into a controlled relation vocabulary.
4. Add explicit muscle subregions (hand, foot, larynx, pharynx, abdominal wall, etc.) independently from translated display labels.
5. Build deterministic relation questions such as “Which muscles are innervated by the axillary nerve?” directly from the graph.
6. Add a review workflow so generated/seed data can progress to `reviewed` and later `faculty_verified` field by field.
