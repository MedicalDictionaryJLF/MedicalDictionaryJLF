# Deployment

## Runtime Targets

- Static hosting remains supported for deterministic Medical Dictionary features.
- Vercel deployment supports root `api/` serverless functions.
- `anamnesis-training/` is a hidden internal route and is not linked from the main menu.

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

In static mode, Gemini helper calls are skipped by the anamnesis trainer and deterministic matching remains available.

## Environment Variables

- `GEMINI_API_KEY`: required in Vercel for Gemini helper routes.

Do not expose Gemini keys in frontend code. Browser code must call only `/api/intent-rescue`, `/api/context-resolve`, and `/api/patient-phrasing`.

## Hidden Route

Open the anamnesis trainer directly:

```text
/anamnesis-training/
```

No visible main-menu route is intentionally added yet.
