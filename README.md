# Medical Dictionary JLF

Medical Dictionary JLF is a static, browser-based medical education application. It includes a multilingual terminology dictionary, search, quizzes, flashcards, muscle and laboratory training, pharmacology search, and anamnesis training. The frontend is deployable to GitHub Pages; Gemini-assisted anamnesis endpoints run separately as Vercel serverless functions.

## Prerequisites

- Node.js 22 LTS (minimum `22.13.0`; Node 24 is also supported)
- npm, using the committed `package-lock.json`

Install exactly the locked dependencies from a clean checkout:

```bash
npm ci
```

Do not commit `node_modules/` or `dist/`.

## Development

```bash
npm run dev
```

Vite listens on all local interfaces. The default URL is `http://localhost:5173/`.

## Verification commands

```bash
npm run lint
npm run format:check
npm run validate
npm run validate:structure
npm run validate:data
npm test
npm run test:unit
npm run test:anamnesis-ui
npm run test:anamnesis-simulation
npm run test:api
npm run test:smoke
npm run ci
```

`npm test` runs all automated logic, UI-regression, simulation, and API-contract tests without opening a browser or calling live Google or Gemini services. `npm run test:smoke` builds the application, starts a temporary local static server, verifies every route under root and GitHub Pages-style paths, and always closes the server.

`npm run ci` is the complete non-interactive sequence used by GitHub Actions.

> Current stabilization blocker: six declared terminology CSV files are header-only (`anatomy`, `diagnostic_methods`, `disease_and_symptoms`, `microorganisms`, `physiology`, and `procedures`). `validate:data`, `build`, `test:smoke`, and `ci` therefore fail deliberately until reviewed records are supplied or the dataset declarations are changed by an authorized content decision. The validator does not invent medical records or treat empty files as valid.

## Production build and preview

```bash
npm run build
npm run preview
```

The build validates repository structure and bundled data before invoking Vite. It writes the static frontend to `dist/`, copies runtime-loaded datasets, and validates route entries, local asset references, anamnesis images, datasets, and accidental frontend credentials.

The default Vite base is relative, so one build works at `/` and at `/MedicalDictionaryJLF/`. To test an explicit deployment base:

```bash
VITE_BASE_PATH=/MedicalDictionaryJLF/ npm run build
```

In PowerShell:

```powershell
$env:VITE_BASE_PATH = "/MedicalDictionaryJLF/"
npm run build
Remove-Item Env:VITE_BASE_PATH
```

## Project structure

- `index.html` — shared Medical Dictionary application shell.
- `<route>/index.html` — multi-page route entries built by Vite.
- `assets/js/` — browser modules for routing, data, search, quiz, sync, and pharmacology.
- `assets/css/` and `assets/` — application styling and static images.
- `data/` — bundled terminology CSV files and the pharmacology JSON database.
- `anamnesis-training/` — standalone anamnesis trainer and deterministic simulation engine.
- `api/` — CommonJS Vercel serverless handlers; these are not part of the GitHub Pages bundle.
- `scripts/` — validation, build-output, simulation, and smoke-test runners.
- `test/` — Node unit and serverless contract tests.
- `docs/` — deployment and development guidance.

## Frontend and backend deployment

GitHub Pages serves only the static frontend produced in `dist/`. Vercel must deploy from the repository root so the `api/` handlers remain available. The frontend can operate in deterministic static mode, but live AI assistance requires server-side environment variables configured in Vercel.

Copy `.env.example` only for local serverless development and never place its values in frontend `VITE_*` variables. In particular, `GEMINI_API_KEY`, `GOOGLE_PRIVATE_KEY`, and service-account credentials must never be embedded in browser files.

See [development guidance](docs/development.md) and [deployment guidance](docs/deployment.md) for details.
