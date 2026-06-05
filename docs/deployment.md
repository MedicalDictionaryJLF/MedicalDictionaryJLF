# Deployment

## Runtime Targets

- GitHub Pages frontend: `https://medicaldictionaryjlf.github.io/MedicalDictionaryJLF/anamnesis-training/`
- Vercel backend: `https://medical-dictionary-jlf.vercel.app`
- Vercel must deploy from the repository root so `api/*` serverless functions remain available.
- Do not set the Vercel Root Directory to `anamnesis-training`; that excludes the root `api/` directory.

## Frontend Configuration

`anamnesis-training/index.html` sets:

```html
window.ANAMNESIS_AI_ENABLED = true;
window.ANAMNESIS_API_BASE_URL = "https://medical-dictionary-jlf.vercel.app";
```

The value has no trailing slash. Browser code must call Vercel through `buildApiUrl()` from `src/ai/client.js`, never a hard-coded `/api/*` URL.

## CORS

Vercel API routes allow these origins:

- `https://medicaldictionaryjlf.github.io`
- `http://localhost:5173`
- `http://127.0.0.1:5173`

Production does not use `Access-Control-Allow-Origin: *`.

## Environment Variables

Required for AI routes:

- `GEMINI_API_KEY`

Optional for learning-event Google Drive uploads:

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_DRIVE_FOLDER_ID`

Preview and Production deployments should define their own values in Vercel. Do not place Gemini or Google credentials in frontend code.

## Static Mode

The static frontend can still run from GitHub Pages. Serverless AI helpers, health checks, and learning-event upload require the Vercel backend URL configured above.

## Commands

```bash
npm.cmd install
npm.cmd run dev
npm.cmd run build
```

Static smoke testing can still use:

```bash
python -m http.server
```
