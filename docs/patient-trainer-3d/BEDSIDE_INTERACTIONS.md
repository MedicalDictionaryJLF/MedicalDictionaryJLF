# Bedside interactions: Clinical 3D 3

**4 November 2026**

The 3D Studio and the integrated Patient Trainer use the same eight skinned
patient models and the same `Patient3DRenderer`. The small **Examine** control
opens five techniques: inspect, auscultate, palpate, percuss and ECG leads.
Nineteen body sites and ten ECG targets are parented to anatomical skeleton
bones; markers therefore follow standing, seated and reclined animation.
Posterior lung and renal-angle points can be reached by orbiting the patient
or by the accessible site buttons. On a phone, tap the lead chip then the
marker or labeled target button. Wrong lead-to-target matches do not advance.

## Clinical data and availability

- Each exam site resolves its finding from the active case's existing `exam`
  field. A documented case finding can update the existing examination notes
  and scoring group in a full encounter.
- Peter and Jana have authored examination findings. The other six cases still
  contain only generic source placeholders. For these, the interaction logs
  the technique and explicitly states that no case-specific finding was
  documented. It does not substitute Peter's normal findings.
- Auscultation and percussion play short locally synthesized educational cues.
  These cues do not encode case pathology or reproduce patient recordings.
- Lead placement is available for every model. Completing all ten attaches
  ECG equipment to the simulation. The tracing viewer opens only if that
  case already supplies a tracing; no tracing is fabricated for other cases.
- The standalone two-case bundle retains its original photograph examination
  and ECG exercise as a legacy fallback; its 3D view also has the model-bound
  controls and records their case-specific actions.

## Verification

`node scripts/patient-bedside-regression.mjs` loads each shipped patient GLB
through Three.js, creates the actual renderer's 19 examination markers and ten
lead markers, and checks each marker remains within the posed body bounds in
all three postures. It triggers all four techniques for each case, rejects an
incorrect lead, places all ten on every case and checks exactly one completion
event. All eight pass. The prior 112-pose rendering regression, Phase 1,
eight-case anamnesis (141 intents), UI v2 and nine standalone tests also pass.

The regression runs on CPU with image decoding stubbed. This environment cannot
create a browser WebGL context, so a visual interaction run on a physical
phone and GPU sound/marker placement were not verified here. Anatomical
landmark positions and generated audio are educational approximations, not
independently clinically validated examination or ECG acquisition.
