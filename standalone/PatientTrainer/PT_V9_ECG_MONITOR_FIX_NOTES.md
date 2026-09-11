# PT-v9 ECG placement + live monitor update

## ECG placement
- fixed the placed-electrode vertical positioning bug (`top` now uses `%`)
- corrected lower-limb side mapping: green right leg on patient right / viewer-left, black left leg on patient left / viewer-right
- limb leads now render as clip-style electrodes in the tray and as clip-style hardware on the patient
- limb lead choices expose colour only, not RA/LA/RL/LL labels
- chest lead choices expose only numbers 1–6
- recalibrated V1–V6 onto the photographed thorax
- enlarged the patient stage and reduced marker size to make placement more precise

## Investigations layout
- the anamnesis/patient progress rail and coach rail are hidden during Investigations
- initial Investigations view shows only Monitor and ECG choices
- ECG placement appears only after ECG is selected
- the monitor appears only after Monitor is selected

## Live monitor
- embedded live bedside monitor using the existing waveform engine
- live ECG, plethysmography and respiratory traces
- continuously updating HR, RR, SpO2 and temperature
- intermittent NIBP with a functioning manual Measure NIBP control
- Pause/Resume control
- NIBP trend reset control
