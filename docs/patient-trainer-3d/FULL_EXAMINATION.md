# Patient Trainer: Anamnesis + 3D Examination

The regular setup now offers the full encounter alongside Anamnesis only. This change builds on the eight existing characters and the Anamnesis Debrief merged in [PR #6](https://github.com/MedicalDictionaryJLF/MedicalDictionaryJLF/pull/6). No model, production API, Apps Script property, Vercel configuration, storage key, or consent requirement changes.

## From the 3D patient to the record

- `scene/clinicalRenderer.js` owns the WebGL canvas, orbit controls, posture, audio controls, and 24 bone-anchored examination sites. The examination toolbar and keyboard site picker operate on the same renderer. Posterior sites face the back of the patient; the Back control seats a reclined patient to make posterior access possible. Pointer movement and multi-touch do not count as an examination.
- `scene/bedsideInteractions.js` validates techniques and landmarks. The 12-lead ECG procedure uses ten electrodes. Arm and leg markers are above the wrists and ankles. V3 follows the midpoint of V2 and V4; V5 and V6 share V4's transverse level. The landmark placements are educational approximations on clothed models; they are not a model of individual rib spacing. The [SCST ECG placement guidance](https://criticalcaretraining.ie/wp-content/uploads/2022/04/SCST_ECG_Recording_Guidelines_2017am-2.pdf) and [AHA cardiac auscultation guide](https://www.heart.org/en/-/media/Files/Professional/Quality-Improvement/HVD-Education-and-Awareness/Auscultation-Guide/Heart-Valve-Auscultation-Guide_FINAL.pdf) informed the site labels and laterality.
- `main.js` accepts examination and electrode events only for the active encounter while the renderer is ready. `clinicalEncounter.js` resolves case evidence independently of the event's text. Its examination record contains the case, technique, site, input method, posture, timestamp, result availability, and repeat flag. Notes and the debrief use those records. Completion is derived from defined site/technique steps; one heart or lung site cannot complete the whole procedure. Each required group earns credit once.
- Incorrect electrodes are recorded as attempts and never count toward placement. Ten correct placements record completion once. Reset clears current placements and leaves historical completion intact. Only the authored Peter ECG is available. A missing tracing never substitutes another patient's ECG.
- Local session restoration rehydrates the encounter, notes, handover draft, and partial ECG placements. Restoration and renderer retry do not replay actions. Final records include history, examination, investigations, differential, management, and handover. Upload still uses the original opt-in payload and API response contract.

## Authoring case findings and assessment

Define each supported physical finding in `src/cases/examinationFindings.js` or the case's `examinationFindings` map. The key is `technique:site-id`; the definition references a documented case fact with `source` and sets `availability: 'authored'`. Use `classification`, optional text that narrows a source to its actual site, `response`, and `sound` as appropriate. Add a completion rule in `clinicalEncounter.js` when an assessment requires multiple steps. Do not derive an objective result from a reported symptom or expected diagnosis. The right flank reaction in Lucia's case is explicitly derived from her report of pain on tapping and remains distinct from an unavailable objective percussion finding.

| Case data | Current objective evidence |
|---|---|
| Peter and Jana | Documented physical findings and measured vitals; case-supported laboratory tests. Jana's RUQ tenderness and Murphy manoeuvre are separate from other quadrants. |
| Milan, Lucia, Karol, Eva, Zuzana, Nina | All 3D techniques and ECG practice work. Source cases contain history and presentation cues but no authored current physical findings, measured vitals, lab results, or tracings. The interface records valid procedures and marks unavailable results explicitly. |
| Sound | Normal heart, clear breath, and present bowel-sound findings for the two authored cases can play labeled local approximations. There are no patient recordings or authored percussion sounds. Unavailable sounds do not generate generic audio. |

The debrief reuses the anamnesis report and separates simulator recognition from clinical omissions. Applicable scores are weighted: interview 60%, examination 15%, reasoning 15%, and handover 10%. Handover covers presentation, case-supported investigation selection/interpretation, and management proposals. Unauthored domains are excluded and the applicable weights are normalized. Exam mode does not show required sites, diagnoses, or graded coverage before submission. The rubric uses authored terms and events; it does not independently judge free-form clinical reasoning.

## Failure handling and retry

`avatarAnimator.js` owns loading, ready, and unavailable states. Missing, corrupt, or slow assets, WebGL initialization failure, context loss, and rendering errors remove the canvas and disable 3D-dependent controls. The only replacement is **3D environment cannot be loaded.** and a retry button. Technical details go to the console. Retry rebuilds only the renderer with the current case and saved placements; interview, notes, and encounter state stay intact. An unassessable examination at submission is identified in the report without adding completion credit.

## Verification

| Check | Result |
|---|---|
| `npm run build`, JS syntax, `git diff --check` | Passed. |
| `scripts/patient-rendering-regression.mjs` | All eight assets, 112 posture changes, material depth, and portrait/landscape framing passed. CPU geometry regression, not a visual test. |
| `scripts/patient-bedside-regression.mjs` and `scripts/patient-trainer-phase1-tests.mjs` | All eight skeletons, 24 exam sites, four techniques, front/back selection, ten electrodes, distinct site rules, unavailable results, scoring, record restore, and failure gating passed. |
| Anamnesis, UI, session-store, and upload relay regressions | Passed. Anamnesis covers eight cases and 141 intents. Upload tests exercise the existing relay and receiver with mocked storage; no production upload was attempted. |
| `scripts/patient-trainer-browser-tests.mjs` | Chromium software WebGL: actual desktop canvas examination and electrode placement; mobile touch and all four techniques, three positions, posterior access, and all ten electrodes on all eight characters. Desktop context loss and retry kept notes, interview and partial ECG state. Reload restored the encounter; handover and saved report worked. Missing/corrupt models and retry recovery passed on a 390 px dark layout. |
| Browser without WebGL | Exact message shown with no SVG, image or canvas, no examination credit, and disabled dependent controls. Retry preserved the existing session. |

Actual rendered evidence: [desktop examination](renders/clinical-exam-desktop.jpg), [mobile examination](renders/clinical-exam-mobile.jpg), [desktop context loss](renders/clinical-exam-failure-desktop.jpg), [mobile dark load failure](renders/clinical-exam-failure-mobile-dark.jpg).

Software rendering and a touch-enabled mobile viewport do not verify hardware GPU performance, physical-phone ergonomics, or audio through real speakers. The browser suite uses the tracked static app with isolated storage and mocked network responses. Run it with `node scripts/patient-trainer-browser-tests.mjs` and a test installation of Playwright/Chromium; `PT_SCREENSHOT_DIR` optionally writes evidence. Set `PT_PLAYWRIGHT_PATH` or `PT_CHROMIUM_HELPER` if the test runtime is outside the checkout.
