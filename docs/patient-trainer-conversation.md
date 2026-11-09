# Patient Trainer conversation engine

The web trainer at `anamnesis-training/` runs the English conversation in the browser. It uses the existing 141-intent interview schema for routing and assessment. The standalone snapshot is a separate entry point and is outside this change.

## Turn processing

1. `questionAnalysis.js` splits explicit multi-question turns, identifies the requested facet, and extracts question form, anatomical target, negation, and symptom or medication references. Established intent rules and keyword matching remain available for other curriculum questions. Explicit topic changes retire symptom and medication context. Matching confidence is a rule-strength or ranking signal, not a calibrated probability.
2. `clinicalFacts.js` retrieves typed facts with a case ID, source field, and documentation state. `conversationFacts.js` contains reviewed transcriptions from the repository's runtime cases. It includes presenting symptoms and HPI facets for all eight patients, selected structured facts across the other interview domains, and medication details where the source identifies the exact drug.
3. `responseTemplates.js` realizes the facts in English. Rules assemble clauses, coordinated lists, anatomical phrases, dose and time expressions, and patient-facing negatives. Value checks gate numeric and anatomical construction. Sensitive information follows the existing rapport and difficulty policy. The language layer can be extended independently from the case records.
4. The engine records attempted, recognized, withheld, answered, and unresolved outcomes separately. The debrief can credit a clinically identifiable attempt without counting it as an answered topic. Compound replies are deduplicated, and the discovered-facts summary uses the parts actually disclosed. Existing saves can resume without the new fields.

## Compatibility and authoring

Existing case narrative fields are retained. The adapter exposes authored narrative where a field has not been transcribed into typed facts, and preserves it for broad questions when it contains more detail. An optional case-local `conversationFacts` object can supply a typed fact by intent and facet. An explicit unknown or missing narrow facet yields an uncertainty response unless the corresponding authored field already answers that specific question. Template defaults inherited by the six factory-created cases are excluded from dialogue fact retrieval. They are not documented negatives.

The runtime cases are the clinical source for this change. The eight separate JSON authoring files were absent from the repository. Examination findings were kept out of the conversation data migration. Narrow onset character, episode frequency, and individual medication schedules are examples of fields that still need case-author review. Use the completeness report to see individual gaps and their existing source fields.

```sh
npm run validate:patient-conversation
npm run validate:patient-conversation -- --json
```

## Rescue policy

Ordinary interview turns, recognized follow-ups, and local clarification do not call an AI endpoint. Rescue requires an unresolved clinical rephrase after a local clarification, subject overlap with that clarification, and independently supported local candidates. Only the short question and allowed intent descriptions go to the existing intent-rescue endpoint. Only an eligible intent, locally permitted interpretation, and sufficient confidence are accepted. The browser still retrieves the facts and generates the reply. The session budget is two requests, with normalized rephrase caching and backoff for endpoint failure, timeout, and quota errors. Budget reservations are saved before requesting rescue.

## Diagnostics and verification

In a non-exam full encounter, open **Coach**, unlock **Details**, and expand **Conversation Diagnostics**. For anamnesis-only sessions, open the trainer with `?conversationDiagnostics=1` and use **Details** in the anamnesis companion. Each turn shows the normalized question, requested facets, context, clinical fact IDs, realization rules, the actual reply, and rescue status and request count. The panel is local developer UI and does not authenticate users or protect data shipped to the browser.

```sh
npm run test:patient-trainer-conversation
npm run test:patient-trainer-anamnesis
npm run test:anamnesis-ui
npm run test:patient-rendering
npm run test:patient-bedside
node scripts/patient-trainer-session-store-tests.mjs
node scripts/patient-trainer-log-tests.cjs
node scripts/patient-trainer-browser-tests.mjs
npm run build
```

The conversation suite exercises ten onset formulations for each of the eight cases, 35 existing simulations, and an intercepted network path. The Playwright suite requires an installed Chromium with WebGL and covers both trainer modes, session resume and report reopening, and all eight patients' 3D examination and ECG workflows. Upload behavior is covered with mocked storage. Live Gemini and Google Apps Script calls are outside the test run.
