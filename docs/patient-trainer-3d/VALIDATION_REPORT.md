# Patient Trainer 3D: rendering repair

## Clinical 3D 3 · bedside interaction addition · 4 November 2026

All eight shipped patient GLBs now support model-anchored inspection,
auscultation, palpation and percussion at 19 anatomical points, plus ten ECG
lead targets. Wrong ECG positions are rejected and completion requires ten
correct placements. The renderer sends site-specific actions into the existing
encounter notes and, when the source case has a documented finding, its scoring
group. The 3D Studio shows the same interactions for every patient. The
interface change is confined to the 3D toolbar and a compact site/lead tray.

**Checks:** eight real GLBs × three postures × 29 moving markers passed the
CPU geometry bounds check. Four techniques and ten correct ECG placements per
patient passed; one intentionally wrong lead was rejected for each. The
112-pose rendering regression, Phase 1, eight-case/141-intent anamnesis,
UI v2 and nine standalone tests passed. See `BEDSIDE_INTERACTIONS.md` for
the interaction contract and limits.

Only Peter and Jana have source-authored exam findings. Six other cases report
that no case-specific finding is documented. Audio is a generated educational
cue, not a patient recording. Lead placement is possible for all eight;
case-specific tracing display remains available only where a recording exists.
This environment cannot create WebGL, so actual browser GPU interaction and
physical-phone playback remain unverified.

**Release:** Clinical 3D 2 · 3 November 2026

The first release had visible rendering defects despite passing glTF file
validation. Solid skin, eyes, teeth, tongue and shoes were incorrectly exported
with alpha blending, which disabled depth writes in Three.js. Far-side skin and
internal features could draw over the front of a face. The skin and cloth normal
maps were also entirely black, producing invalid tangent-space normals and dark,
flat shading. The earlier checks did not catch these appearance failures.

The repaired release uses opaque, depth-writing anatomy and alpha-masked hair,
brows and lashes. A separate outer eye shell had lost its alpha during JPEG
conversion and covered the irises with blue disks; that shell now has a clear
masked material, while the iris and sclera remain opaque. Every original eye
triangle is retained, with only its material grouping changed. It removes three invalid normal-map references per patient
from each individual and combined GLB. The exporter and eight editable patient
sources are corrected. Mesh positions, morph targets, weights, bind matrices,
animation samples, case identities and albedo image bytes are preserved.

Position selection now applies the pose and furniture together before framing
the camera. Framing uses the posed body bounds and the current viewport aspect.
The reclined face view looks down toward the face; the bedspread clears the mattress and stays below
the clothed patient instead of being arched through the torso and neck. Explicit
module and asset versions request the corrected files after an update.

| Check | Result |
| --- | --- |
| glTF conformance | **19/19 GLBs: 0 errors, 0 warnings.** The three reusable rooms and combined scenes include a 35 mm bedspread elevation to clear the mattress. |
| Browser loader | **8/8 patients passed** actual GLTFLoader image decoding, material depth policy, skinning, facial animation and room structure checks. Eight embedded texture references decoded per patient. |
| Runtime regression | **8/8 passed**, with 14 rapid posture changes per patient, one active posture at a time, immediate reclined alignment, unchanged bedspread vertices and portrait/landscape framing. |
| Resting face occlusion | All sampled teeth are behind opaque facial skin in the runtime face view: 30/30 samples for each patient. |
| Education regressions | Phase 1, eight-case anamnesis/141-intent regression, and legacy speech/affect/rapport and 3D asset contracts passed. Original case files remain unchanged. |
| Rendered evidence | Three Blender renders use the actual Three.js-deformed vertices and camera values: Jana’s reclined face and body, and Peter standing. These are mesh renders, not generated illustrations or browser screenshots. |

## Verification limits

The cloud browser still cannot create a WebGL context. **GPU-rendered browser
playback, physical-phone appearance/performance, and live camera/inspection
interaction in a rendered browser scene remain unverified.** CPU geometry,
material semantics, browser image decoding and Blender renders are separate
forms of evidence; they do not establish successful playback on the user’s phone.

The assets remain below the requested AAA/photorealistic standard. Hair, clothing,
facial nuance and contact still need professional art refinement. Collision-free
motion through every gesture combination is not certified. Speech uses approximate
visemes, and clinical motions have not been independently medically validated.
Optional AI endpoints retain their original backend requirements; the private
static preview uses the existing deterministic interview engine.

## Evidence

- `rendering-regression.json`: actual renderer CPU checks and face occlusion.
- `browser-validation.json`: current eight-patient loader checks; earlier release
  interview/UI observations are explicitly marked as prior-release evidence.
- `asset-validation.json`: current conformance summary and character hashes.
- `../../tools/character-pipeline/material-repair-report.json`: before/after hashes,
  material changes and preservation of anatomy, animation and albedo data.
- `../../tools/character-pipeline/cornea-repair-report.json`: eye-shell material
  grouping and preservation of all original eye triangles and attributes.
- `../../tools/character-pipeline/bedding-repair-report.json`: bedding clearance and
  metadata-only room/combined-scene changes.
- `../../tools/character-pipeline/asset-validation.json`: full conformance messages.
- `renders/`: the three corrected runtime-geometry views.
