# AI Backend

## Principle: deterministic first, AI only as fallback

Medical Dictionary does not send every search or patient-trainer action to AI.

The frontend first attempts the deterministic local engines:

- terminology and multilingual datasets
- unified Anatomy structures + muscles
- Anatomy movement/group queries
- clinical-correlation fuzzy search
- Pharmacology class/search index
- laboratory-range, abbreviation, translation and definition lookups

For the global Search screen, `/api/search-answer` is called only after those local resolvers have insufficient confidence. Local search remains available when AI is unavailable or the usage allowance is exhausted.

The patient trainer uses the same quota layer for its AI-assisted intent rescue, context resolution and patient phrasing endpoints.

## Base URL

Production backend:

```text
https://medical-dictionary-jlf.vercel.app
```

The GitHub Pages frontend resolves AI endpoints through `src/ai/client.js`.

AI endpoints:

- `/api/ai-health`
- `/api/ai-session`
- `/api/search-answer`
- `/api/intent-rescue`
- `/api/context-resolve`
- `/api/patient-phrasing`
- `/api/learning-events`

## AI usage identity and limits

### Anonymous visitors

The browser creates a stable random visitor ID in local storage. The server combines this with a one-way hash of the request IP. This gives two layers of abuse control:

1. per browser/IP visitor allowance;
2. a separate per-IP daily ceiling.

Deleting browser storage can change the visitor ID, but it does not reset the IP ceiling. This is deliberately stronger than a client-only counter while still allowing the site to be used without registration.

### Signed-in visitors

After Google sign-in, the frontend sends the short-lived Google access token once to `/api/ai-session`. The backend verifies the Google account through the Drive API and returns a signed 12-hour Medical Dictionary AI session token. AI requests use the signed subject rather than trusting an email/user ID supplied by the browser.

Signed-in users receive a larger allowance than anonymous users.

### Default allowances

Defaults are intentionally conservative and can be changed without rebuilding the frontend:

```text
AI_DAILY_LIMIT_ANON=20
AI_HOURLY_LIMIT_ANON=10
AI_DAILY_LIMIT_USER=60
AI_HOURLY_LIMIT_USER=30
AI_DAILY_LIMIT_IP=120
```

These count backend AI calls, not ordinary local searches. Local deterministic features are unlimited.

## Durable rate-limit storage

For reliable production enforcement across multiple Vercel instances, configure Upstash Redis:

```text
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

When Redis is configured, counters survive serverless instance changes. Without it, the backend falls back to an in-process counter. That fallback is useful for local development but should not be treated as authoritative production rate limiting.

## Required/recommended secrets

```text
GEMINI_API_KEY=...
AI_SESSION_SECRET=<long random secret>
```

`AI_SESSION_SECRET` is used to sign the short-lived app session. If it is absent, the backend falls back to `GEMINI_API_KEY` as the signing secret, but a dedicated secret is recommended.

## Health Check

```bash
curl https://medical-dictionary-jlf.vercel.app/api/ai-health
```

The endpoint never returns secret material.

## Search fallback example

A query such as:

```text
What are the abductors of the arm?
```

is resolved locally from the muscle movement dataset and does not consume AI quota.

A classification query such as:

```text
What are the 3rd generation beta-blockers?
```

falls through to AI when that generation classification is not encoded reliably in the local pharmacology dataset. The AI receives relevant local candidate records as context and the UI marks the answer as AI-assisted.

## CORS Tests

```bash
curl -i -X OPTIONS \
  -H "Origin: https://medicaldictionaryjlf.github.io" \
  -H "Access-Control-Request-Method: POST" \
  https://medical-dictionary-jlf.vercel.app/api/search-answer
```

Expected headers include the permitted origin, `POST, OPTIONS`, and `Content-Type`.
