# Standalone Patient Trainer — Interactive Physical Examination Lab

## Scope

This build was extracted from Medical Dictionary Phase 1.10 and is intentionally developed as a **standalone Patient Trainer**. Nothing in this package needs to be merged into Medical Dictionary until the physical-examination design is accepted.

## Current case

Only Peter Novak is exposed to the user. The deterministic acute chest-pain / inferior STEMI case remains the development case.

## Interactive examination

The old examination checklist is replaced by a full-body interactive avatar. The student selects:

- Inspect
- Auscultate
- Palpate
- Percuss

and then acts on a specific anatomical hotspot on the anterior or posterior patient view.

Current body map: **38 hotspots**.

### Cardiovascular

- five conventional cardiac auscultation sites
- bilateral carotids
- bilateral radial pulses
- precordial palpation
- chest-wall palpation
- JVP
- hand/peripheral perfusion

### Respiratory / airway

- dedicated tracheal/upper-airway site
- six anterior lung comparison points
- six posterior lung comparison points
- lung auscultation and percussion

### Abdomen

- RUQ, LUQ, RLQ, LLQ
- inspection
- auscultation
- palpation
- percussion

### Peripheral examination

- calves
- ankles / edema
- sacral edema
- general inspection
- lips / central cyanosis

## Avatar changes

The exam avatar is a purpose-built inline SVG with:

- front and back views
- breathing movement
- blink animation
- pointer-following examination tool
- persistent marker after instrument placement
- hotspot labels on hover/focus
- visual-sign overlays driven by case data

Peter currently displays subtle pallor and diaphoresis. The same mechanism is ready for cyanosis, jaundice, rash, bruising, scars, swelling and other future visual signs.

## Audio architecture

The sound registry now contains:

- **8 open clinical recordings** (normal heart, SVT heart sounds, wheeze, pneumonia crackles, IPF fine crackles, stridor, carotid bruit, SBO bowel sounds)
- **5 published reference simulations** for future cardiac cases (MVP, aortic stenosis, pulmonary stenosis, Tetralogy of Fallot example, VSD)
- local educational synthesis for normal vesicular breathing, normal bowel activity and percussion notes

Every sound has provenance metadata. Published simulations and locally generated sounds are never labelled as patient recordings.

Peter only hears findings that are true for Peter. For example, placing the stethoscope on his carotid does **not** play a bruit merely because a bruit recording exists in the atlas.

See `docs/SOUND_SOURCES.md` for attribution and source details.

## Validation

- JavaScript syntax: PASS
- static local import graph: PASS
- duplicate HTML IDs: none
- interactive exam test: PASS
  - 38 hotspots
  - 5 cardiac auscultation areas
  - 12 lung sites
  - all sound references valid
  - preferred audio hotspots valid
  - legacy click-to-reveal exam UI absent
- existing conversation simulation regressions: **31/31 PASS**
