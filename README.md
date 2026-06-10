# Medical Dictionary

## Structure

- `assets/js/app.js` keeps DOM wiring, screen orchestration, and feature bootstrapping.
- `assets/js/core/app-paths.js` centralizes route handling and bundled resource resolution.
- `assets/js/services/csv-utils.js` contains reusable CSV parsing helpers.
- `assets/js/services/data-repository.js` owns terminology dataset loading/indexing.
- `assets/js/pharmacology/pharmacology-service.js` owns the JSON pharmacology database, search index, filters, ATC hierarchy, comparison data, and AI-ready retrieval.
- `assets/js/services/search-service.js` contains the main search ranking and aggregation logic.
- `assets/js/services/quiz-service.js` contains reusable quiz session logic for question generation, scoring, answer checking, and mistake tracking.

## Notes

This repository currently contains the application and bundled datasets. The separate upgraded working copy also includes additional development assets such as tests and generated output files that are not present here.
