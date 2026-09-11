# Chest point and posterior-view update

## What changed
- adjusted the anterior chest hotspot placement on the realistic Peter image
- refined cardiac auscultation targets: aortic, pulmonic, Erb's, tricuspid, and mitral/apical
- widened and slightly lowered anterior lung-field points so they sit more naturally over the photographed thorax
- added a dedicated photorealistic posterior-view file for Peter Novak
- switched posterior examination mode from the old vector body to the new posterior photo asset
- recalibrated posterior lung and sacral points for the new back-view image

## New asset
- `assets/peter_novak_back_52.png`

## Updated body rendering
- front view uses `peter_novak_front_52.png`
- posterior view now uses `peter_novak_back_52.png`
- both views retain the same hotspot engine and deterministic examination logic
