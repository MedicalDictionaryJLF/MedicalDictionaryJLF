# Deployment

## Runtime targets

- GitHub Pages frontend: `https://medicaldictionaryjlf.github.io/MedicalDictionaryJLF/`
- Vercel serverless backend: `https://medical-dictionary-jlf.vercel.app`

Vercel must deploy from the repository root. Setting its Root Directory to `anamnesis-training` excludes the root `api/` handlers.

## Static frontend

Create the validated frontend bundle with:

```bash
npm ci
npm run build
```

The output is `dist/`. Vite uses relative asset paths by default, allowing the same output to work at the domain root and beneath the GitHub Pages repository path. `npm run test:smoke` verifies both path styles.

If a host requires an explicit base, set `VITE_BASE_PATH=/MedicalDictionaryJLF/` while building. A blank page or 404 after direct nested-route navigation usually means the host published the wrong directory, omitted a route `index.html`, or used a base that does not match the repository path. Inspect the generated route HTML and verify that its script and stylesheet URLs resolve beneath the deployed base.

Preview a completed build locally with:

```bash
npm run preview
```

## Anamnesis backend configuration

`anamnesis-training/index.html` enables AI support and points to the Vercel API base. Browser code builds endpoint URLs through `src/ai/client.js`; it does not contain server credentials.

Required Vercel variable for AI routes:

- `GEMINI_API_KEY`

Optional variables for learning-event Google Drive uploads:

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_DRIVE_FOLDER_ID`

Define Preview and Production values separately in Vercel. Do not expose them through `VITE_*` variables or commit a populated `.env` file.

## CORS

The API allows the production GitHub Pages origin and the local Vite origins documented in `api/_cors.js`. It does not reflect arbitrary origins.

## Static mode

The core frontend and deterministic anamnesis engine remain usable without server credentials. Gemini helpers, the AI health check, and Google Drive learning-event upload require the Vercel backend. Automated tests mock those external services and never depend on live credentials.
