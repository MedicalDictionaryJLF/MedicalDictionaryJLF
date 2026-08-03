# Development and continuous integration

## What CI verifies

GitHub Actions runs `npm ci` and `npm run ci` on pushes to `main`, pull requests targeting `main`, and manual dispatches. The sequence checks:

1. JavaScript lint rules for browser modules, Node scripts, and CommonJS serverless handlers.
2. formatting of maintained infrastructure and touched source files;
3. repository structure, route mappings, local imports, HTML asset references, and dependency-lock hygiene;
4. terminology CSV and pharmacology JSON structure and quality metadata;
5. unit, anamnesis UI-regression, deterministic simulation, and mocked API-contract tests;
6. a real Vite multi-page build and post-build asset/credential validation;
7. HTTP smoke tests for every route at root and `/MedicalDictionaryJLF/` paths.

Dataset and build summaries are written to `.artifacts/` and uploaded by CI for a short retention period. The directory is ignored locally.

## Planned terminology datasets

The repository currently declares six terminology CSV sources that contain headers but no records:

- `data/terminology/anatomy.csv`
- `data/terminology/diagnostic_methods.csv`
- `data/terminology/disease_and_symptoms.csv`
- `data/terminology/microorganisms.csv`
- `data/terminology/physiology.csv`
- `data/terminology/procedures.csv`

These sources are marked `status: "planned"` in `TERMINOLOGY_SOURCES`. Their lack of usable records is reported as a warning so unfinished future content does not block CI. This exception applies only to record count: planned files must still be readable UTF-8 with a valid, unique, non-empty header and structurally valid CSV. Any malformed planned file fails validation, as does any active dataset with no usable records. Repository tooling never fabricates placeholder medical content.

## Adding tests

- Put browser-independent logic tests in `test/unit/*.test.mjs` and use Node's built-in `node:test` API.
- Put Vercel handler contracts in `test/api/*.test.mjs`. Replace `global.fetch` with a deterministic mock and restore it in `finally`; never call live services.
- Extend `scripts/anamnesis-ui-tests.mjs` only for the existing lightweight UI regression surface.
- Add deterministic simulation fixtures to `anamnesis-training/src/simulationTests.js`. Use an existing case ID and intent ID; fixture validation rejects unknown IDs before any test runs.

Random behavior must accept an injected random function in tests. Do not make timing or network availability part of a passing assertion.

## Adding or changing datasets

Terminology sources used by the application are declared in `assets/js/services/data-repository.js`. Add the CSV file beneath `data/`, declare its path where appropriate, and run:

```bash
npm run validate:structure
npm run validate:data
```

The CSV validator requires valid UTF-8, unique non-empty headers, parseable rows, and an identity value for every usable record. Active datasets require at least one usable record. A deliberately unfinished source may be marked `status: "planned"`; an empty planned file emits a warning, but all structural checks remain strict. Remove the planned status when reviewed content becomes active. The validator also reports row counts, missing translations, exact duplicates, Unicode replacement characters, and likely mojibake. Fix structural errors without changing medical meaning.

The pharmacology validator reads the data path and the service-configured expected count, but it does not hard-code 1,000 records as a generic rule. It reports the actual count, configured expectation, mismatch status, duplicate IDs, ATC shape, major service-used fields, data-quality metadata, and the number of records requiring human review.

## Running anamnesis simulations

```bash
npm run test:anamnesis-simulation
```

The runner validates the complete active fixture set before constructing an engine. It fails unknown cases or intents, setup errors, missing/forbidden text mismatches, scope mismatches, unexpected clarification, internal-label leakage, or an unusable response. The separate modular case/fixture architecture under `anamnesis-training/src/data/` remains intentionally unmerged during repository stabilization.

## Route entries and base paths

`vite.config.mjs` builds `index.html` plus every route listed in `scripts/project-config.mjs`. Standard application routes load the shared shell and then dynamically import the application module; the anamnesis trainer remains its own entry.

The default Vite base is `./`. Runtime route and data URL helpers derive the application base from the browser pathname, so `/search/` resolves data beneath `/data/`, while `/MedicalDictionaryJLF/search/` resolves it beneath `/MedicalDictionaryJLF/data/`.

If a GitHub Pages deployment has missing assets:

1. run `npm run test:smoke` locally;
2. confirm the published directory is `dist/`;
3. confirm the failing route has `dist/<route>/index.html`;
4. inspect the generated HTML asset URLs;
5. rebuild with `VITE_BASE_PATH=/MedicalDictionaryJLF/` only if the host cannot serve relative assets.
