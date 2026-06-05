# Repository Structure

This repository is currently a static-first medical study app with Vercel serverless API helpers. Root page folders are intentionally preserved because the current routing and static HTML paths depend on them.

## Current Active Structure

- `index.html` is the main shell for Medical Dictionary.
- Root page folders provide stable direct routes: `entry/`, `main/`, `menu/`, `search/`, `quiz/`, `flashcards/`, `muscles/`, `latin-terminology/`, `lab-parameters/`, `pharmacology/`, `biophysics/`, `courses/`, `feedback/`, and `anamnesis/`.
- `assets/` contains app images, SVG icons, CSS, and browser modules.
- `assets/js/` contains the main app orchestration modules.
- `assets/js/core/` contains route and path helpers.
- `assets/js/services/` contains reusable data, search, quiz, and CSV services.
- `data/` contains terminology CSV datasets, app-language CSV datasets, and pharmacology JSON/TXT datasets.
- `api/` contains Vercel serverless functions for secure Gemini helper calls.
- `src/ai/` contains frontend API client helpers that call only the serverless `/api/*` routes.
- `anamnesis-training/` contains the hidden internal avatar anamnesis simulator, deterministic cases, avatar, ECG asset, monitor, and AI support glue.
- `scripts/` contains build validation scripts.
- `docs/` contains repository, deployment, cleanup, and AI learning-event documentation.

## Proposed Future Structure

A future migration can make the repo easier to reason about:

- `app/pages/` for route pages currently at the root.
- `modules/` for feature modules such as dictionary, quiz, pharmacology, and anamnesis training.
- `shared/` for reusable UI, routing, storage, and data helpers.
- `server/api/` for backend source if Vercel routing is explicitly configured.
- `data/` for datasets that must remain stable and directly fetchable.
- `docs/` for operational and architecture documentation.
- `scripts/` for validation, data checks, and maintenance tasks.

## Migration Warning

Do not move root page folders yet unless every link, static fetch path, Vercel route, and browser import is updated and tested. The current folder layout is intentionally conservative because static hosting and route-loader paths rely on predictable relative URLs.

## Preserved Suspicious Files

- Image assets with similar logo names are preserved because no duplicate deletion was performed without hash comparison and reference updates.
- The application data folders are preserved even when individual filenames are historical or verbose.
- `MedicalDictionaryJLF.rar` is already deleted in the working tree before this cleanup pass. That change was not made here and was not reverted.
