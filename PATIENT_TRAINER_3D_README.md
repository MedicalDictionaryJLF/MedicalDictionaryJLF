# Medical Dictionary: Patient Trainer 3D upgrade

**Clinical 3D 3 · 4 November 2026:** The 3D view now offers 19 skeleton-attached
examination sites for inspection, auscultation, palpation and percussion, plus
all ten 12-lead ECG electrode positions. Select **Examine** in the 3D toolbar,
choose a technique, and click a marker or its accessible site button. For ECG,
select each electrode and then its anatomical target. Incorrect targets are
rejected. The same controls work across all eight patient characters and their
standing, seated and reclined poses. The interface retains its existing layout.

The physical findings use the case's documented `exam` data. The six cases
without case-specific physical findings explicitly say so rather than borrowing
another patient's result. Auscultation/percussion audio is a short, locally
generated educational cue, not a patient recording. All eight patients allow
lead placement; only a case with a supplied ECG tracing can display that
tracing after completion. See `docs/patient-trainer-3d/BEDSIDE_INTERACTIONS.md`.

**Clinical 3D 2 · 3 November 2026:** repairs transparent anatomy, invalid
normal-map shading, reclining-camera framing and bedding intersections. The
validation report describes the verified fixes and remaining GPU/device limits.

This package contains the upgraded MedicalDictionaryJLF repository and actual
animated 3D assets. Open the private preview link supplied with the release to
use the patient studio without conversion or modeling steps.

- Main application: `anamnesis-training/index.html`.
- Interactive 3D studio: `anamnesis-training/3d-preview/index.html`.
- Eight individual patients: `anamnesis-training/assets/3d/clinical/patients/`.
- Three reusable rooms: `anamnesis-training/assets/3d/clinical/environments/`.
- Eight patient/room scenes: `anamnesis-training/assets/3d/clinical/scenes/`.
- Eleven editable Blender files: `tools/character-pipeline/sources/`.
- Generation, finalisation, combination and rendering scripts: `tools/character-pipeline/`.
- Results and limitations: `docs/patient-trainer-3d/VALIDATION_REPORT.md`.

The character and room GLBs embed their textures and binary data. The application
vendors Three.js locally. Existing terminology, quiz, anamnesis and educational
source files remain in the repository. The legacy standalone bundle also uses
the new renderer while preserving its original case selection and extra tools.

Developers can use the repository’s existing `npm run dev` workflow. Browser 3D
requires WebGL 2; `file://` URLs are not a supported way to load web modules or
GLBs. The online preview is provided for direct use.

This is a working anatomical 3D upgrade with documented art and verification
limits. It is not a claim of AAA realism, production readiness, exact speech
alignment or clinical validation. Read the short validation report before
relying on those qualities.
