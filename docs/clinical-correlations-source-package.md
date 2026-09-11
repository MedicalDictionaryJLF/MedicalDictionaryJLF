# Codex Task: Add Synonyms and Misspelling-Tolerant Search for Clinical Correlations

Use these files:

```text
clinical_correlations_logic_synonymized.json
clinical_correlation_synonyms.json
clinical_query_normalization_rules.json
clinical_correlation_search_algorithm.js
clinical_correlation_synonyms.schema.json
clinical_correlations_synonyms_flat.csv
```

## Goal

Upgrade the clinical correlations logic layer so students can search messy anatomical questions naturally.

The user may type things like:

```text
greater curvature artery
inferior side stomach vessel
gastroepiploic artery stomach
posterior duodenal ulcer bleeding
water under the bridge
funny bone nerve
CN6 palsy
ophtalmic fissure contents
foramen spinozum
```

The app should still find the correct correlation when safe.

## Recommended paths

```text
data/anatomy/clinical_correlations_logic.json
data/anatomy/clinical_correlation_synonyms.json
data/anatomy/clinical_query_normalization_rules.json
data/schemas/clinical_correlation_synonyms.schema.json
assets/js/anatomy/clinical-correlation-search.js
```

The synonymized JSON may replace the old clinical correlations file, but do not delete old data until validation passes.

## Search algorithm requirements

Implement or adapt `clinical_correlation_search_algorithm.js`.

Required pipeline:

1. Unicode normalization and diacritic removal
2. lowercase/casefold
3. hyphen and punctuation normalization
4. protect cranial nerve numerals and abbreviations
5. abbreviation expansion
6. synonym expansion
7. tokenization
8. stopword removal
9. bounded Damerau-Levenshtein fuzzy matching
10. safety filtering
11. weighted ranking
12. ambiguity detection
13. result formatting with matched fields

## Protected matching rules

Do not fuzzy-match these dangerously:

- left ↔ right
- greater ↔ lesser
- artery ↔ vein
- gastric ↔ gastro-omental/gastroepiploic
- CN III ↔ CN IV ↔ CN VI
- V1 ↔ V2 ↔ V3

If a query is ambiguous, show ranked suggestions instead of forcing one answer.

## Result UI

For each result show:

- subject
- relation type
- answer
- clinical relevance
- exam traps
- matched fields
- review status
- confidence/direct-answer badge

Example:

```text
Query: inferior side stomach artery
Result: stomach greater curvature → right and left gastro-omental arteries
Matched in: synonym, question template, answer
Trap: right and left gastric arteries follow the lesser curvature.
```

## Build validation

Add validation for:

- synonym JSON parses
- synonym schema validates
- each `correlation_query_support.correlation_id` exists in clinical correlations
- no duplicate synonym support entries
- every correlation has `query_support`
- algorithm imports without syntax error
- expected queries return expected IDs

Expected query tests:

```text
greater curvature artery -> cc_stomach_greater_curvature_gastro_omental
inferior side stomach vessel -> cc_stomach_greater_curvature_gastro_omental
gastroepiploic -> cc_stomach_greater_curvature_gastro_omental
lesser curvature artery -> cc_stomach_lesser_curvature_gastric
posterior duodenal ulcer bleeding -> cc_duodenal_ulcer_gastroduodenal
foramen spinosum contents -> cc_middle_meningeal_foramen_spinosum
cavernous sinus CN VI -> cc_cavernous_sinus_contents
funny bone nerve -> cc_medial_epicondyle_ulnar
carpal tunnel nerve -> cc_carpal_tunnel_contents
femoral triangle NAVL -> cc_femoral_triangle_navl
water under the bridge -> cc_ureter_under_uterine_artery
CN III ptosis pupil -> cc_cranial_nerve_iii_pupil_ptosis
bitemporal hemianopia -> cc_visual_pathway_optic_chiasm
```

## Safety

This is educational anatomy support. Keep the badge:

```text
Seed record – review recommended
```

Do not let fuzzy search create a clinical fact. It only retrieves existing curated records.
