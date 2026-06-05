# AI Learning Events

The anamnesis trainer records sanitized intent and AI-helper diagnostics and uploads them to the Vercel backend when AI is enabled.

## Endpoint

Frontend calls:

```text
https://medical-dictionary-jlf.vercel.app/api/learning-events
```

The frontend must use `buildApiUrl("/api/learning-events")`; do not call `fetch("/api/learning-events")` directly from GitHub Pages.

## Event Shape

`anamnesis-training/src/aiSupport.js` sends:

- `studentQuestion`
- `deterministicIntentGuess`
- `deterministicConfidence`
- `aiAvailable`
- `aiAttempted`
- `aiSucceeded`
- `aiRescueUsed`
- `aiSelectedIntent`
- `aiConfidence`
- `aiEndpoint`
- `aiHttpStatus`
- `aiContentType`
- `aiError`
- `finalResolutionSource`
- `resolvedIntent`
- `fallbackUsed`
- `patientPhrasingUsed`
- `errors`
- `recordedAt`

`finalResolutionSource` is one of `direct`, `deterministic`, `context-ai`, `intent-rescue-ai`, or `fallback`.

## Google Drive Flow

`api/learning-events.js` accepts `POST` and `OPTIONS`. It applies the shared CORS allowlist and, when Google Drive environment variables are configured, uploads the sanitized JSON event from Vercel server-side code.

Required Drive variables:

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_DRIVE_FOLDER_ID`

If those values are missing, the endpoint returns JSON with `stored: false` and logs the sanitized event server-side. It does not reveal the folder ID, service-account values, Gemini key, or partial secrets.

Do not upload full conversations automatically. At interview end, the trainer still asks whether the user wants to anonymously contribute the conversation summary payload.
