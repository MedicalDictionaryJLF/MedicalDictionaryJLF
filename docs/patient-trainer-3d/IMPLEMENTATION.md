# Patient Trainer 3D upgrade

The existing MedicalDictionaryJLF application now selects a separate skinned GLB
for each of its eight cases. `patient3DRenderer.js` remains the public entry point;
`clinicalRenderer.js` implements the new Three.js scene and `patientAssets.js`
maps unchanged case IDs to their characters and hospital rooms.

## Working components

- Eight anatomical character GLBs, each with a 53-joint deformation skeleton,
  articulated fingers, embedded textures and 27 facial deformation targets on
  the body. Relevant targets also deform the eyes, brows, lashes, teeth and hair.
- Fifteen independently named clips per character: three positions, relaxed arms,
  chest discomfort, abdominal protection, flank discomfort, headache, ordinary
  breathing, increased respiratory effort, fatigue, blinking, pain expression,
  talking and eye movement.
- Three reusable hospital sets: acute assessment, internal medicine and general
  examination. Only the selected patient and room are loaded.
- Orbit, pan, zoom, face/patient/room framing, keyboard camera shortcuts, expanded
  viewing, inspection points, resting previews, symptom previews and position
  previews. Preview controls do not change the clinical record or scoring.
- Dialogue uses the existing interview engine. Browser speech word-boundary
  events drive restrained viseme animation. The visual speech cadence is an
  approximation, not recorded phoneme alignment.
- Existing patient-state subscriptions drive clinical appearance and equipment.
  Inspection points route to the existing examination actions and scoring.
  Undocumented vital signs remain blank on the 3D monitor.
- Local Three.js dependencies, embedded GLB images and binary data, bounded pixel
  ratio, a mobile setting with shadows disabled, offscreen rendering suspension,
  and disposal of scene resources when cases change.
- Separate `3d-preview/` workspace with direct clip playback and interview
  questions. Existing anamnesis, coaching, notes and educational flows are retained.

## Rendering repair in Clinical 3D 2

Solid anatomy writes to the depth buffer; hair, brows and lashes use alpha
cutouts. The outer corneal shell is clear while iris/sclera remain opaque.
Invalid black skin/cloth normal maps were removed, and the source
pipeline sets image color space before filling pixels. Posture changes apply
atomically with furniture placement; the camera frames current deformed bounds
for the viewport. The bedspread stays below the clothed patient. See the
validation report and `material-repair-report.json` for the defect evidence.

## Files

- `anamnesis-training/assets/3d/clinical/patients/`: individual patient GLBs.
- `anamnesis-training/assets/3d/clinical/environments/`: reusable room GLBs.
- `anamnesis-training/assets/3d/clinical/scenes/`: patient plus room GLBs.
- `tools/character-pipeline/sources/`: editable character and environment `.blend` files.
- `tools/character-pipeline/`: generation, finalisation, scene assembly and rendering scripts.
- `anamnesis-training/3d-preview/validate.html`: GLTFLoader, skinning and animation verification.
- `scripts/validate-patient-assets.mjs`: Khronos glTF conformance and asset contract checks.

## Boundaries

These are functional, anatomically based browser character assets. They do not
reach the requested AAA or scanned-human level of realism. Hair is made with
textured game meshes; clothing and hand placement can still need artistic
refinement during unusual combinations of pose and gesture. No claim of
production readiness, clinical validation or exact lip synchronisation is made.

The source case data has a standing/sitting inconsistency for Peter: the patient
card says sitting upright, while the simulation initial state explicitly says
standing. The renderer follows that simulation state; seated preview remains
available without changing the record. Six history-focused cases contain generic
factory examination/vital defaults. Their documented symptoms guide visual
animation; additional examination findings are not invented.

Private static hosting runs the local deterministic interview engine. Existing
optional AI/server endpoints require their original backend configuration; this
release does not supply API credentials or port those endpoints to a new backend.

GPU/browser rendering and hardware performance limits are recorded separately in
the final validation report.
