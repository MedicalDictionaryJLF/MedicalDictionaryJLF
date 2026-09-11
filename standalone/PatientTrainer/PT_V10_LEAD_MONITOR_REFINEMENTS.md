# PT-v10 lead + monitor refinements

## ECG lead placement fixes
- Recalibrated anterior ECG placement targets.
- Adjusted wrist/ankle limb target positions so the clips sit on the limbs rather than floating.
- Applied the user-requested lower-limb orientation update:
  - green lower-limb clip on viewer-right
  - black lower-limb clip on viewer-left
- Shifted V6 laterally so it sits more realistically on the left lateral chest.
- Slightly refined V1–V5 spacing so the precordial row is more anatomically coherent.
- Kept chest leads displayed as numbers only (1–6).
- Kept limb leads colour-only in the tray.
- Limb leads remain rendered as clip-style hardware rather than sticker dots.

## Monitor refinements
- Refurbished the embedded live monitor to look more like a real bedside monitor.
- Added a darker integrated monitor chassis/bezel.
- Added a proper screen grid to the waveform display.
- Removed the redundant bright white value-card strip below the screen so the monitor feels less like a dashboard and more like a real monitor.
- Kept live waveform animation, live values, and the working controls:
  - Pause / Resume
  - Measure NIBP
  - Reset NIBP trend

## Validation
- Existing PT test suite passes after the refinements.
