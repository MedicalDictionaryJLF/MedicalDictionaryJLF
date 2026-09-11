# PT-v5 posterior-view fix

This remains a **standalone Patient Trainer only**. It is not merged into Medical Dictionary.

## What was changed
- The anterior examination coordinates were deliberately left unchanged from PT-v4.
- Front and posterior photographs are now both inserted into the Examination DOM at the same time.
- The Posterior button toggles the already-loaded posterior image immediately, before any panel rerender.
- Patient image URLs are resolved relative to `interactivePhysicalExam.v5.js` with `new URL(..., import.meta.url)`, so nested page paths cannot redirect the back-image request to the wrong folder.
- The module chain is renamed again (`interactivePhysicalExam.v5.js`, `physicalExamMap.v5.js`, `clinicalEncounterPanels.v5.js`) to avoid stale v4 browser modules.
- The UI displays `Posterior image ready` in the examination toolbar.
- If Posterior is selected, `ui.view` remains `back` and posterior hotspots are filtered from the same deterministic examination map.

## Assets
- `assets/peter_novak_front_52_v5.png`
- `assets/peter_novak_back_52_v5.png`
