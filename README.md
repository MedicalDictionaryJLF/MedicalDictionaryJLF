# Medical Dictionary

Medical-study workspace with multilingual terminology, unified Anatomy, Pharmacology, laboratory references, quizzes, flashcards, courses, anamnesis tools and patient-interview training.

## Current architecture

- `assets/js/app.js` keeps DOM wiring, screen orchestration and feature bootstrapping.
- `assets/js/core/app-paths.js` centralizes route handling and bundled resource resolution.
- `assets/js/services/csv-utils.js` contains reusable CSV parsing helpers.
- `assets/js/services/data-repository.js` owns terminology dataset loading/indexing.
- `assets/js/services/search-service.js` contains main search ranking and aggregation.
- `assets/js/search/smart-search.js` contains deterministic question resolvers used before AI fallback.
- `assets/js/anatomy/anatomy-structure-service.js` indexes Anatomy Structures v2 and relationships.
- `assets/js/anatomy/clinical-correlation-service.js` exposes clinical correlations to global Search.
- `assets/js/pharmacology/pharmacology-service.js` owns the pharmacology index, filters and retrieval.
- `src/ai/client.js` is the shared frontend AI client used by Search and patient training.
- `api/_ai-limit.js` provides shared anonymous/signed-in AI quotas with optional Redis persistence.
- `api/search-answer.js` is the low-confidence Smart Search AI fallback.

## Smart Search policy

Local structured data is always attempted first. AI is used only when a question-like query cannot be answered with sufficient deterministic confidence. Ordinary local search is not rate limited and continues to work when AI is unavailable or its quota has been reached.

See `docs/ai-backend.md` and `UI_PHASE1_8_SMART_SEARCH_NOTES.md` for deployment details and the AI limiter design.
