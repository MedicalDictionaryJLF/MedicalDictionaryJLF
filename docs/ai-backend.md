# AI Backend

## Base URL

Production backend:

```text
https://medical-dictionary-jlf.vercel.app
```

The GitHub Pages frontend resolves AI endpoints through `src/ai/client.js`:

- `/api/ai-health`
- `/api/intent-rescue`
- `/api/context-resolve`
- `/api/patient-phrasing`
- `/api/learning-events`

## Health Check

```bash
curl https://medical-dictionary-jlf.vercel.app/api/ai-health
```

Expected JSON:

```json
{
  "success": true,
  "configured": true,
  "model": "gemini-2.5-flash",
  "runtime": "vercel-serverless"
}
```

If `GEMINI_API_KEY` is missing, `configured` is `false`. The endpoint never returns key material.

## CORS Tests

```bash
curl -i -X OPTIONS \
  -H "Origin: https://medicaldictionaryjlf.github.io" \
  -H "Access-Control-Request-Method: POST" \
  https://medical-dictionary-jlf.vercel.app/api/intent-rescue
```

Expected headers include:

- `Access-Control-Allow-Origin: https://medicaldictionaryjlf.github.io`
- `Access-Control-Allow-Methods: POST, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type`

## Endpoint Tests

```bash
curl -i https://medical-dictionary-jlf.vercel.app/api/ai-health
curl -i -X POST -H "Content-Type: application/json" \
  -d "{\"question\":\"By which mode of transport did you get to the hospital?\",\"intents\":[{\"id\":\"administrative_arrival_method\",\"description\":\"Arrival method\"}]}" \
  https://medical-dictionary-jlf.vercel.app/api/intent-rescue
curl -i -X POST -H "Content-Type: application/json" \
  -d "{\"question\":\"When exactly?\",\"conversation\":[],\"context\":{},\"intents\":[{\"id\":\"administrative_admission_time\",\"description\":\"Admission time\"}]}" \
  https://medical-dictionary-jlf.vercel.app/api/context-resolve
curl -i -X POST -H "Content-Type: application/json" \
  -d "{\"deterministicAnswer\":\"My wife drove me here.\",\"audience\":\"patient\"}" \
  https://medical-dictionary-jlf.vercel.app/api/patient-phrasing
curl -i -X POST -H "Content-Type: application/json" \
  -d "{\"studentQuestion\":\"test\",\"aiAvailable\":true}" \
  https://medical-dictionary-jlf.vercel.app/api/learning-events
```
