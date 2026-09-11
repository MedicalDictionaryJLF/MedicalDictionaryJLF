# Anatomy v2.2 — Terminology + Graph Precision

## Scope

This patch implements the first three Anatomy follow-up items after v2.1. Patient Trainer files are intentionally excluded.

1. Slovak and German preferred terminology, aliases and explicit terminology review provenance.
2. Supporting anatomical structures and relationships needed to eliminate the 41 previously unlinked canonical muscles.
3. Replacement of broad/vague legacy relationship labels with a controlled, defined relationship vocabulary.

## Result snapshot

- Anatomy concepts: **601** (v2.1: 536)
- New support concepts: **65**
- Canonical muscles: **225**
- Muscles with at least one explicit graph relation: **225/225** (v2.1: 184/225)
- Unlinked muscles: **0** (v2.1: 41)
- Relationships: **855** (v2.1: 642)
- Muscle-derived relationship records: **572**
- Semantic duplicate relationship triples removed during QA: **11**
- Legacy vague relation records normalized from v2.1: **160**
- Active controlled relation types: **25**

## 1. Terminology layer

Preferred-term coverage is now complete at the data-model level:

| Language | Preferred terms | Source-backed | Review-queued |
|---|---:|---:|---:|
| English | 601/601 | base/canonical | — |
| Latin | 601/601 | base/canonical | — |
| Slovak | 601/601 | 97 | 504 |
| German | 601/601 | 10 | 591 |

**Important:** populated does not mean faculty-verified. Every Slovak/German term carries a terminology status: `source_backed` or `seed_needs_review`. The UI may use the preferred term, while the data layer preserves how confident we are about it. The review queue is exported to `docs/ANATOMY_V2_2_TERMINOLOGY_REVIEW_QUEUE.csv`.

Examples tightened during nomenclature QA include:

- `articulatio sacroiliaca` → `krížovobedrový kĺb`
- `truncus pulmonalis` → `pľúcnicový kmeň` (aliases include `pľúcnica`, `pľúcny kmeň`)
- `foramen infraorbitale` → `podočnicový otvor`
- `canalis adductorius` → `adduktorový kanál`
- `ductus thoracicus` → `hrudníkový miazgovod`
- `musculus soleus` → `šikmý lýtkový sval`
- `plexus brachialis` → `ramenná spleť` with source/course variants retained as aliases

Latin abbreviations remain searchable aliases (`M.`, `N.`, `A.`, `V.`, etc.) rather than replacing full preferred Latin names.

### Terminology sources used for source-backed/cross-checked entries

- Comenius University Bratislava, Faculty of Pharmacy — *Terminologia Anatomica* Slovak/Latin teaching handout.
- UPJŠ medical teaching material for cardiovascular terminology (including `truncus pulmonalis`).
- Slovak medical/anatomical terminology cross-checks for selected structures.
- Kenhub / AMBOSS German anatomical terminology for explicitly source-backed German muscle names.
- DocCheck/Kenhub German anatomical nomenclature used for selected synonym checks.

The rest deliberately stays `seed_needs_review`; the patch does not convert a plausible translation into a fake verified fact.

## 2. Support anatomy for the previously unlinked muscles

The patch adds **65** canonical support concepts. They cover the missing granularity that previously prevented conservative graph linking, including:

- fascia/aponeurosis/membrane structures;
- bony attachment landmarks (processes, crests, tuberosities, trochanter, ischial landmarks);
- costal/laryngeal/auditory-tube cartilages;
- smaller nerve branches, nerve groups and plexuses;
- smaller arterial branches;
- selected oral/pharyngeal structures;
- foot-specific attachment structures.

Notable additions include `fascia_thoracolumbar`, `aponeurosis_palatine`, `plexus_ansa_cervicalis`, `nerve_medial_plantar`, `nerve_lateral_plantar`, `artery_ascending_cervical`, `landmark_calcaneal_tuberosity`, `landmark_greater_trochanter`, and `ligament_plantar_mtp`.

The result is strict graph coverage of **225/225 canonical muscles**. The validator now fails the build if any canonical muscle becomes graph-orphaned.

## 3. Controlled relationship vocabulary

The v2.1 graph contained 160 records using broad legacy labels such as:

- `part_or_branch_of`
- `gives_branch_or_continues_as`
- `passes_through_or_lies_in`
- `related_to`
- `innervates_or_related_to`
- `includes_or_uses`
- `anatomically_related_to`
- `participates_in`

All are gone. Generic `includes` was also replaced by `contains_pathway_component`.

The active vocabulary now contains **25** explicitly defined relation types. `relationship_definitions` records the semantics, symmetry and inverse relation where applicable. Examples include:

- `branch_of` ↔ `gives_branch_to`
- `innervated_by` ↔ `innervates`
- `supplied_by` ↔ `supplies`
- `part_of` ↔ `has_part`
- `originates_from`
- `inserts_on`
- `passes_through`
- `located_in`
- `continues_as`
- `bifurcates_into`
- `joins_to_form`
- `forms_part_of_joint`
- `contains_pathway_component`

This is intentionally directional. It gives later question generation enough semantics to distinguish “branch of”, “passes through”, “located in” and “part of” instead of treating them as varieties of “somehow related”. Humanity has suffered enough from that relationship type already.

## QA / build guards

The Anatomy validator now checks:

- expected schema version;
- dataset counts and per-type counts;
- structure ID uniqueness;
- parent/relationship endpoint integrity;
- relationship ID uniqueness;
- semantic relationship triple uniqueness (`source + relation + target`);
- controlled relation-definition coverage;
- absence of old vague relation types;
- SK/DE preferred term presence and terminology provenance;
- muscle schema integrity;
- the historical category-as-translation regression;
- legacy muscle CSV width/duplicates;
- canonical flat-export parity;
- strict 225/225 muscle graph coverage.

Final verification on 2026-08-24:

- `npm run validate:anatomy-data` — PASS
- `npm run test:anatomy-packages` — PASS
- `npm run test:smart-search` — PASS
- `npm run test:clinical-correlations` — PASS
- `npm run test:ai-limit` — PASS
- `npm run build` — PASS
- JavaScript syntax checks for `app.js`, anatomy structure service and Smart Search — PASS

One Node warning remains in Smart Search tests about package module type. It predates this patch and is not an Anatomy data failure.
