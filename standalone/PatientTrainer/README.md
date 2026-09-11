# Patient Trainer Lab — standalone interactive physical examination prototype

This directory is intentionally **separate from Medical Dictionary**. Do not merge it back into the main application until the physical-examination interaction model is approved.

## Current development case

Only **Peter Novak**, a 58-year-old man with an acute chest-pain / inferior STEMI station, is exposed in the standalone UI.

## What changed

The physical examination no longer uses a checklist of reveal buttons. The student:

1. chooses a technique — **Inspect, Auscultate, Palpate, Percuss**;
2. chooses **Anterior / Posterior** view;
3. places the selected instrument/action directly on one of the anatomical hotspots on the full-body avatar;
4. receives only the finding for that technique at that point;
5. hears point-specific sound when that finding has audio;
6. builds a chronological physical-examination log that remains compatible with the existing scoring layer.

The current body map contains 38 targeted sites after adding the tracheal/upper-airway point, including the five standard cardiac auscultation areas, bilateral lung comparison fields, carotids, pulses, chest wall, abdomen and peripheral examination sites.

## Avatar

The examination avatar is a new inline SVG rather than the old decorative interview avatar. It supports:

- anterior and posterior views
- breathing motion and blinking
- pointer-following examination instrument
- persistent placed-instrument marker
- hover/focus anatomical labels
- case-defined visual overlays
- current Peter overlays for subtle pallor and diaphoresis

The overlay model is deliberately extensible for later cyanosis, jaundice, rash, bruising, scars, local swelling, edema and other visible signs.

## Audio

See [`docs/SOUND_SOURCES.md`](docs/SOUND_SOURCES.md). The registry distinguishes real clinical recordings, published reference simulations and locally synthesized educational audio. Sound provenance/license is shown in the UI whenever applicable.

## Validation

Run:

```bash
npm test
```

The standalone test validates hotspot uniqueness, standard cardiac/lung coverage, sound references, licensing metadata and removal of the legacy click-to-reveal examination panel.
