# Patient character production sources

The `sources/` folder contains eight editable character `.blend` files and three editable hospital room `.blend` files. Each character includes its skinned anatomical mesh, 53-bone deformation skeleton, individual fingers, fitted ward clothing, hair, eyes, teeth, tongue, embedded materials, 27 face/viseme shape keys on the body and matching propagated shape keys on relevant child meshes. Fifteen NLA animation tracks are included. The anatomical base mesh, fitted assets, age/identity modeling targets and skin maps are from MakeHuman/MPFB's CC0 core asset library, not the supplied procedural Peter model.

The files are suitable for continued modeling and animation work in Blender 4.5. The character's identity has been baked into its geometry; the parameter definitions and build script can recreate or change that identity from the original core assets. The exported GLBs flatten only identity rig parents for portability; the `.blend` source keeps Blender's conventional armature parenting.

## Rebuilding

`asset-provenance.json` pins the MPFB source commit and records exact source bundle URLs, SHA-256 digests and sizes. Blender is a production dependency; it is not required by the browser app or deployed preview. The scripts require Python supplied by Blender, including its NumPy installation. No commercial character-generation service is required.

After preparing the pinned MPFB repository and extracting the MakeHuman system, faceunits01 and visemes02 asset bundles into one assets directory:

```bash
blender --background --factory-startup --python build_characters.py -- \
  --mpfb-root /path/to/mpfb2 --asset-root /path/to/mhassets \
  --output /path/to/generated --source-output /path/to/editable-sources
blender --background --factory-startup --python build_environments.py -- \
  --output /path/to/generated/environments --source-output /path/to/editable-sources
python combine_scenes.py --assets /path/to/clinical-assets \
  --definitions character-definitions.json
```

Copy generated character GLBs into `clinical-assets/patients/` and room GLBs into `clinical-assets/environments/` before combining. `render_exported.py` reimports finished GLBs, poses their exported NLA tracks and renders actual geometry for QA. `finalize_glb.py` can apply the portability cleanup to an earlier build without changing mesh indices, bone hierarchy, inverse bind matrices or animation target nodes.

## Material repair and audit

The repaired assets use opaque, front-facing skin, iris/sclera, teeth, tongue and shoes. Hair, brows and lashes use a .34 alpha mask. `PatientEyeCorneaClear` applies a fully clear .34 mask only to the high-poly eye's outer shell, whose UVs occupy the blue atlas corner. The original eye atlas was converted to JPEG in the earlier pipeline, losing that shell's alpha. The iris and sclera retain their original image and UVs. Future image conversion preserves eye alpha with PNG.

The earlier generated skin and cotton normal images were RGB black. Changing a generated image's color space after writing its pixels cleared its data. The generator now sets Non-Color before filling pixels; a saved neutral-normal check decoded to RGB (128,128,255). Existing bad normal links are removed from GLBs and disconnected in the eight patient sources. Original packed source image bytes remain available for inspection.

Run these from the repository root to repair an earlier export without rebuilding a patient:

```bash
python tools/character-pipeline/repair_materials.py \
  --assets anamnesis-training/assets/3d/clinical \
  --report tools/character-pipeline/material-repair-report.json
python tools/character-pipeline/repair_eye_cornea.py \
  --assets anamnesis-training/assets/3d/clinical \
  --report tools/character-pipeline/cornea-repair-report.json
blender --background --python tools/character-pipeline/repair_blend_materials.py -- \
  --sources tools/character-pipeline/sources \
  --report tools/character-pipeline/source-cornea-repair-report.json
node tools/character-pipeline/validate_assets.mjs
```

The two GLB reports form a hash chain from the earlier files to the final repaired assets. The cornea report verifies exact oriented triangle multisets and shared vertex/morph attribute bytes, allowing only primitive/material regrouping. Rig, animation and original albedo bytes stay exact. Room assets and room sources are excluded. Khronos rows contain final file hashes; unused UV informational messages remain because UVs are preserved after invalid normal maps are removed.

`bedding-repair-report.json` records a separate 35 mm elevation of only the `FoldedCover` node in three rooms and eight combined scenes, plus the corresponding three room sources. The original cover wave dipped about 3 mm into the mattress; its final minimum clearance is about 32 mm. `repair_bedding.py` preserves every GLB binary byte, and `repair_room_bedding.py` changes only that source object transform. Patient files remain unchanged. The room generator creates the same offset. Refresh only those conformance rows with `node tools/character-pipeline/validate_assets.mjs --folders environments,scenes`.

`render_runtime_material_qa.py` accepts CPU-deformed mesh snapshots from the actual renderer and uses their camera values. It obtains materials from final GLBs, retains flat room bedding and renders those exact world-space vertices. These are Cycles renders with recomputed smooth normals and different lighting. They complement loader, material and occlusion checks; they are not WebGL screenshots. The earlier Cycles overview failed to reveal the browser's transparent-depth sorting failure, so that overview alone cannot establish raster correctness.

## Animation contract

- `PositionStanding`, `PositionSeated`, `PositionReclined`: root, pelvis and legs.
- `RestArms`, `ChestPain`, `AbdominalGuard`, `FlankGuard`, `Headache`: arm/hand/finger layers. Arm layers can crossfade; runtime posture changes apply immediately to keep the body above its supporting furniture. Held symptom postures remain stable while breathing and face layers play.
- `IdleBreathing`, `RespiratoryEffort`: independent thoracic motion.
- `Fatigue`: restrained head posture/motion.
- `Blink`, `PainExpression`, `Talking`, `EyeMovement`: face shape-key tracks, including relevant eyelash, eyebrow, eye, teeth, tongue and hair deformation.

The app uses speech-boundary events and a restrained text-based viseme cadence. It is approximate lip synchronization, not phoneme-aligned audio analysis or motion capture. Clinical animation amplitudes are cosmetic; they do not introduce measured findings or diagnoses into source case data. Unspecified hair, body proportions and clothing are artistic choices rather than clinical case facts.

## Quality boundary

These are real, textured, skinned and animated 3D assets with anatomically continuous human meshes. They are a maintained browser-simulation asset foundation, not photorealistic human scans, MetaHumans or AAA production characters. Hair cards, fabric deformation, finger contact, sweat rendering and facial expressions need further art refinement for that quality level. Deformation and supporting furniture are checked using rendered geometry; collision-free contact through every possible blended pose is not guaranteed. New clinical cases should add a registry entry and case-specific motion controls rather than reuse another patient's identity.

To reproduce the runtime geometry evidence from the application module:

```sh
node tools/character-pipeline/export_runtime_evidence.mjs /tmp/patient-runtime-evidence
```

Use the resulting JSON with `render_runtime_material_qa.py`. Its meshes and camera
come from the real renderer; the render uses Blender lighting and is not a
WebGL screenshot. See the release validation report for the current evidence.
