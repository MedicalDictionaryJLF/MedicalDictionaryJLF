# PT-v11 ECG + bedside monitor rebuild

## ECG placement
- Recalibrated all 10 electrode targets against the actual Peter Novak photograph.
- Arm clips moved onto the distal forearm/wrist instead of floating lateral to the arms.
- Locked the requested IEC limb colour mapping to patient anatomy:
  - Red = right arm
  - Yellow = left arm
  - Green = right leg
  - Black = left leg
- Green is therefore on patient-right / viewer-left; black is patient-left / viewer-right.
- Refined the precordial sequence:
  - V1 / V2 at the sternal borders
  - V3 between V2 and V4
  - V4 in the left midclavicular region
  - V5 progressing to the anterior axillary region
  - V6 moved medially enough to remain on the lateral thorax rather than the arm
- Limb hardware remains clip-style; chest leads remain numbered 1–6.
- `PT_V11_ECG_PLACEMENT_VERIFICATION.png` is generated from the exact coordinate values used by the code.

## Monitor layout
- Rebuilt the live bedside monitor to fit within a typical laptop viewport without requiring the user to scroll just to operate it.
- Responsive monitor canvas is constrained by viewport height.
- Removed fake canvas-drawn control buttons.
- Real clickable HTML controls now sit immediately below the monitor:
  - Pause / Resume
  - Start NIBP
  - Clear NIBP history
- NIBP history has a dedicated strip inside the display and remains visible at the bottom of the screen.
- NIBP is treated as an intermittent cuff measurement rather than a continuously changing value.
- Monitor screen now uses a compact generic bedside-monitor layout instead of a dashboard card layout.

## Waveform engine
Added `src/monitorWaveforms.v11.js`.

The waveform engine is parameter-driven rather than case-specific drawing code.
Supported ECG rhythm profiles currently include:
- sinus rhythm / sinus tachycardia / sinus bradycardia through HR input
- atrial fibrillation
- ventricular tachycardia
- periodic PVCs
- asystole

ECG parameters can separately control:
- HR
- PR interval
- QRS duration
- QT duration
- P, R and T amplitudes
- ST displacement and ST slope
- baseline wander and noise

Pleth parameters include perfusion amplitude and pulse rate. Respiration is independently driven by respiratory rate and pattern, with regular, irregular, Cheyne-Stokes and apnoea-ready profiles.

Peter Novak currently uses a regular lead-II profile with a modest positive ST displacement consistent with the case's inferior STEMI context.

## Validation
The existing physical-examination / posterior-view tests, ECG placement tests and new waveform-engine tests all pass in PT-v11.
